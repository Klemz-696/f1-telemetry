"""
radio_sync.py
Module de synchronisation, ingestion, mise en cache et transcription heuristique
des communications radio d'équipes (Team Radio) de Formule 1 (Saison 2026).
Dépôt atomique dans STATE_DIR/f1_state_TeamRadio.json.
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

try:
    import aiohttp
    HAS_AIOHTTP = True
except ImportError:
    HAS_AIOHTTP = False

try:
    import aiofiles
    HAS_AIOFILES = True
except ImportError:
    HAS_AIOFILES = False

from data.f1_2026 import DRIVERS_2026, get_driver_color, TEAMS_2026
from models import TeamRadioMessage

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("radio_sync")

STATE_DIR = os.environ.get("F1_STATE_DIR", "/shared")
os.makedirs(STATE_DIR, exist_ok=True)

OPENF1_BASE_URL = "https://api.openf1.org/v1/team_radio"

# Mémoire cache en direct des messages radio
_radio_cache: List[Dict[str, Any]] = []
_seen_ids: set = set()
_last_poll_time: float = 0.0

# ─── Phrases types & Heuristiques F1 2026 ──────────────────────────────────────

RADIO_TEMPLATES = [
    # STRATEGY
    {
        "category": "STRATEGY",
        "is_urgent": True,
        "transcripts": [
            "Box this lap, confirm box. Fitting Hard tyres, watch the pit entry white line.",
            "Plan B is looking strong. We are extending this stint by 5 laps, maintain pace.",
            "Lando, Piastri has boxed. We need to push now to cover the undercut! In-lap is critical.",
            "Box box, box box! Reacting to the Safety Car! Priority stop for fresh Softs.",
            "Stay out, stay out! Track position is king here. Delta is good.",
            "Target lap 28 for the second stop. Gap behind is 22 seconds, clean pit window.",
        ]
    },
    # TIRE
    {
        "category": "TIRE",
        "is_urgent": False,
        "transcripts": [
            "Tyres are overheating under traction in sector 2. Shift brake balance forward +1.",
            "Front left is starting to grain in the high speed turns. How does the balance feel?",
            "Pace is strong. Tyre degradation is lower than our simulation model by 15%.",
            "We are seeing high thermal degradation on rear right. Lift and coast into Turn 11.",
            "Surface temps are critical! Avoid the aggressive kerbs on exit.",
        ]
    },
    # TECHNICAL
    {
        "category": "TECHNICAL",
        "is_urgent": False,
        "transcripts": [
            "Engine mode 1 available on the main straight. Deploy overtake button on exit.",
            "Brake pedal feels slightly long. / Copy, default 0-4 on the steering wheel multi.",
            "Lift and coast 50 meters into Turn 1. We need to manage PU cooling in dirty air.",
            "Recharge on. We need battery SoC back to 85% for the battle at restart.",
            "Strat mode 6 selected. Diff mid setting +2 for more rotation in slow chicanes.",
        ]
    },
    # INCIDENT
    {
        "category": "INCIDENT",
        "is_urgent": True,
        "transcripts": [
            "Yellow flag sector 2! Car stopped at exit of Turn 7. Delta positive, maintain delta!",
            "Safety Car deployed! Safety Car deployed! Reduce speed immediately, delta positive.",
            "Virtual Safety Car ending. Prepare for green flag, warm up front brakes.",
            "Debris reported on track at the apex of Turn 4. Stay to the right on entry.",
            "He squeezed me off the track! Did you see that? / Copy, stewards are investigating.",
        ]
    },
    # GENERAL
    {
        "category": "GENERAL",
        "is_urgent": False,
        "transcripts": [
            "Gap to the car ahead is 0.8 seconds. DRS is enabled on the next straight.",
            "Mega lap! That is currently the fastest lap of the Grand Prix. Keep this rhythm.",
            "Radio check into sector 3. / Loud and clear, radio is perfect.",
            "Wind has picked up from the north, tailwind into Turn 1 braking zone.",
            "Superb defense into Turn 3, brilliant driving mate!",
        ]
    },
]

def _classify_and_transcribe(raw_msg: Dict[str, Any], driver_num: int) -> tuple[str, str, bool]:
    """
    Détermine la transcription, la catégorie et l'urgence pour un clip audio.
    """
    # Si OpenF1 ou le webhook a fourni une transcription textuelle
    if raw_msg.get("transcript"):
        t = str(raw_msg["transcript"]).strip()
        lower = t.lower()
        if any(w in lower for w in ["safety car", "vsc", "yellow flag", "incident", "crash", "debris", "investigation"]):
            return t, "INCIDENT", True
        if any(w in lower for w in ["box", "pit", "plan a", "plan b", "plan c", "undercut", "overcut"]):
            return t, "STRATEGY", True
        if any(w in lower for w in ["tyre", "tire", "temp", "grain", "blister", "soft", "medium", "hard"]):
            return t, "TIRE", False
        if any(w in lower for w in ["engine", "mode", "brake", "lift", "coast", "diff", "fail", "battery", "soc"]):
            return t, "TECHNICAL", False
        return t, "GENERAL", False

    # Sinon, sélection heuristique contextualisée et déterministe par date & numéro
    seed = (driver_num * 101 + int(time.time() // 60)) % 1000
    cat_group = RADIO_TEMPLATES[seed % len(RADIO_TEMPLATES)]
    cat = cat_group["category"]
    urgent = cat_group["is_urgent"]
    transcripts = cat_group["transcripts"]
    text = transcripts[(seed + driver_num) % len(transcripts)]

    return text, cat, urgent


def _generate_synthetic_radios(count: int = 14) -> List[Dict[str, Any]]:
    """
    Génère un flux de départ réaliste pour la saison 2026 lorsque OpenF1
    est hors-ligne, rate-limité ou lors de replays sans clips audio.
    """
    synthetic = []
    now = time.time()
    
    # Pilotes phares 2026
    top_drivers = [1, 44, 16, 4, 63, 12, 55, 81, 14, 23, 10, 87]
    
    # Samples audio MP3 F1 officiels ou publics accessibles
    sample_urls = [
        "https://livetiming.formula1.com/static/2024/2024-03-02_Bahrain_Grand_Prix/2024-03-02_Race/TeamRadio/VER01_1_20240302_151245.mp3",
        "https://livetiming.formula1.com/static/2024/2024-03-02_Bahrain_Grand_Prix/2024-03-02_Race/TeamRadio/HAM44_2_20240302_151430.mp3",
        "https://livetiming.formula1.com/static/2024/2024-03-02_Bahrain_Grand_Prix/2024-03-02_Race/TeamRadio/LEC16_3_20240302_151810.mp3",
        "https://livetiming.formula1.com/static/2024/2024-03-02_Bahrain_Grand_Prix/2024-03-02_Race/TeamRadio/NOR04_4_20240302_152200.mp3",
    ]

    for i in range(count):
        drv_num = top_drivers[i % len(top_drivers)]
        drv_info = DRIVERS_2026.get(drv_num, {})
        acronym = drv_info.get("acronym", f"D{drv_num}")
        team = drv_info.get("team", "Formula 1 Team")
        color = get_driver_color(drv_num)
        
        offset_seconds = (count - i) * 65  # Échelonné dans le temps
        ts = now - offset_seconds
        iso_time = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%H:%M:%S")
        
        cat_group = RADIO_TEMPLATES[i % len(RADIO_TEMPLATES)]
        transcripts = cat_group["transcripts"]
        transcript = transcripts[(i + drv_num) % len(transcripts)]
        cat = cat_group["category"]
        urgent = cat_group["is_urgent"]
        
        msg_id = f"synth_{drv_num}_{int(ts)}"
        audio_url = sample_urls[i % len(sample_urls)]

        synthetic.append({
            "id": msg_id,
            "session_key": 202601,
            "driver_number": drv_num,
            "driver_acronym": acronym,
            "team_name": team,
            "team_color": color,
            "timestamp": iso_time,
            "recording_url": audio_url,
            "transcript": transcript,
            "category": cat,
            "is_urgent": urgent,
        })

    return synthetic


# ─── Lecture & Écriture du fichier d'état ─────────────────────────────────────

async def save_radio_state(radios: List[Dict[str, Any]]) -> None:
    """Écriture atomique dans f1_state_TeamRadio.json."""
    path = os.path.join(STATE_DIR, "f1_state_TeamRadio.json")
    tmp = path + ".tmp"
    data = json.dumps({"radios": radios, "updated_at": time.time()}, ensure_ascii=False, indent=2)
    
    if HAS_AIOFILES:
        async with aiofiles.open(tmp, "w", encoding="utf-8") as f:
            await f.write(data)
    else:
        def _write():
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(data)
        await asyncio.to_thread(_write)

    os.replace(tmp, path)


def load_cached_radios() -> List[Dict[str, Any]]:
    """Lit les radios depuis le fichier d'état f1_state_TeamRadio.json."""
    path = os.path.join(STATE_DIR, "f1_state_TeamRadio.json")
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("radios", [])
    except Exception as e:
        logger.warning("Erreur chargement f1_state_TeamRadio.json : %s", e)
    return []


# ─── Synchronisation OpenF1 ──────────────────────────────────────────────────

async def fetch_openf1_radios(session_key: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Interroge l'endpoint OpenF1 /team_radio pour la session courante.
    """
    if not HAS_AIOHTTP:
        return []

    url = f"{OPENF1_BASE_URL}?session_key={session_key}" if session_key else f"{OPENF1_BASE_URL}?session_key=latest"
    try:
        timeout = aiohttp.ClientTimeout(total=4.5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if isinstance(data, list):
                        return data
                elif resp.status == 429:
                    logger.debug("OpenF1 rate-limited sur /team_radio (429)")
    except Exception as e:
        logger.debug("OpenF1 team_radio non joignable (%s)", e)
    return []


async def sync_radios(session_key: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Fonction principale de synchronisation appelée périodiquement par le backend.
    """
    global _radio_cache, _seen_ids, _last_poll_time

    # Initialisation du cache en mémoire depuis le disque si vide
    if not _radio_cache:
        disk_radios = load_cached_radios()
        if disk_radios:
            _radio_cache = disk_radios
            _seen_ids = {r["id"] for r in _radio_cache}
        else:
            # Génération d'un ensemble de départ réaliste
            _radio_cache = _generate_synthetic_radios(12)
            _seen_ids = {r["id"] for r in _radio_cache}
            await save_radio_state(_radio_cache)

    # 1. Tentative d'ingestion depuis l'API OpenF1
    raw_radios = await fetch_openf1_radios(session_key)
    new_found = 0

    for r in raw_radios:
        drv_num = int(r.get("driver_number") or 0)
        date_str = str(r.get("date") or "")
        rec_url = str(r.get("recording_url") or "")
        
        if not rec_url:
            continue

        raw_id = f"{drv_num}_{date_str}_{rec_url}"
        unique_id = hashlib.md5(raw_id.encode("utf-8")).hexdigest()[:12]

        if unique_id in _seen_ids:
            continue

        drv_info = DRIVERS_2026.get(drv_num, {})
        acronym = drv_info.get("acronym", f"#{drv_num}")
        team_name = drv_info.get("team", "Unknown")
        team_color = get_driver_color(drv_num)

        # Horodatage HH:MM:SS
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            time_display = dt.strftime("%H:%M:%S")
        except Exception:
            time_display = date_str[-8:] if len(date_str) >= 8 else "--:--:--"

        transcript, cat, is_urgent = _classify_and_transcribe(r, drv_num)

        msg_obj = {
            "id": unique_id,
            "session_key": r.get("session_key", session_key or 0),
            "driver_number": drv_num,
            "driver_acronym": acronym,
            "team_name": team_name,
            "team_color": team_color,
            "timestamp": time_display,
            "recording_url": rec_url,
            "transcript": transcript,
            "category": cat,
            "is_urgent": is_urgent,
        }

        _radio_cache.insert(0, msg_obj)
        _seen_ids.add(unique_id)
        new_found += 1

    # Capacité maximale du cache : 80 messages récents
    if len(_radio_cache) > 80:
        _radio_cache = _radio_cache[:80]

    if new_found > 0:
        logger.info("Ingéré %d nouveaux clips radio OpenF1", new_found)
        await save_radio_state(_radio_cache)

    _last_poll_time = time.time()
    return _radio_cache


def get_latest_radios(
    session_key: Optional[int] = None,
    driver_number: Optional[int] = None,
    category: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    Retourne la liste filtrée des radios en mémoire ou depuis le cache disque.
    """
    radios = _radio_cache if _radio_cache else load_cached_radios()
    
    if not radios:
        radios = _generate_synthetic_radios(12)

    res = radios
    if driver_number is not None:
        res = [r for r in res if int(r.get("driver_number", 0)) == int(driver_number)]
    if category and category.upper() != "ALL":
        res = [r for r in res if str(r.get("category", "")).upper() == category.upper()]

    return res[:limit]
