"""
consumer.py
Ingestion double-mode :
  - Mode ARCHIVE : poll des fichiers JSON statiques (aucun token requis)
  - Mode LIVE    : flux SignalR Core (token F1 TV requis)
Bascule automatique selon StreamingStatus.json
"""

import asyncio
import json
import logging
import os
import time

import aiohttp

from decoder import decode_f1_z_payload, filter_position
from influx_client import write_car_data, write_positions  # write_weather retiré (B4) — météo via fichier d'état

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("consumer")

F1_STATIC_BASE  = "https://livetiming.formula1.com/static"
NEGOTIATE_URL   = "https://livetiming.formula1.com/signalrcore/negotiate"
WS_BASE_URL     = "wss://livetiming.formula1.com/signalrcore"
F1_AUTH_TOKEN   = os.environ.get("F1_AUTH_TOKEN", "")
RS              = "\x1e"

# Répertoire partagé entre consumer et api (volume Docker f1_state)
STATE_DIR = os.environ.get("F1_STATE_DIR", "/shared")
os.makedirs(STATE_DIR, exist_ok=True)

# Chemin de session forcé : Mettre à None pour rétablir la découverte automatique
FORCED_SESSION_PATH = os.environ.get("F1_FORCED_SESSION_PATH", None)

# session_key réel (entier F1) mis en cache à la réception du topic SessionInfo.
# Injecté comme tag sur chaque point Influx (B5) pour permettre l'historique par course.
_current_session_key: str = "latest"

TOPICS = [
    "CarData.z", "Position.z", "TimingData", "TimingAppData",
    "SessionInfo", "SessionStatus", "WeatherData",
    "RaceControlMessages", "TrackStatus",
    "LapCount", "ExtrapolatedClock",
]

HANDSHAKE_MSG = json.dumps({"protocol": "json", "version": 1}) + RS
SUBSCRIBE_MSG = json.dumps({
    "type": 1, "invocationId": "0",
    "target": "Subscribe", "arguments": [TOPICS],
}) + RS


# ─── Utilitaires ─────────────────────────────────────────────────────────────

async def write_state_file(topic: str, payload) -> None:
    """Écriture atomique (tmp + rename) — cohérente avec standings/results_sync."""
    import aiofiles
    path = os.path.join(STATE_DIR, f"f1_state_{topic}.json")
    tmp = path + ".tmp"
    async with aiofiles.open(tmp, "w") as f:
        await f.write(json.dumps(payload))
    os.replace(tmp, path)


async def get_session_path(session: aiohttp.ClientSession) -> str | None:
    """
    Retourne le chemin de la session courante.
    Si FORCED_SESSION_PATH est défini, le retourne directement (mode hors-live).
    Sinon, tente la découverte dynamique depuis SessionInfo.json.
    Note : encoding="utf-8-sig" indispensable — l'API F1 préfixe les fichiers JSON
    d'un BOM UTF-8 (\xef\xbb\xbf) qui fait planter json.loads() avec le codec par défaut.
    """
    if FORCED_SESSION_PATH:
        logger.info("Chemin de session forcé : %s", FORCED_SESSION_PATH)
        return FORCED_SESSION_PATH

    url = f"{F1_STATIC_BASE}/SessionInfo.json"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as r:
            if r.status != 200:
                return None
            # encoding="utf-8-sig" : supprime le BOM UTF-8 de l'API F1
            text = await r.text(encoding="utf-8-sig")
            try:
                data = json.loads(text)
            except json.JSONDecodeError as e:
                logger.error("JSONDecodeError SessionInfo.json : %s", e)
                return None
            return data.get("Path")
    except Exception as e:
        logger.error("Erreur get_session_path : %s", e)
        return None


async def is_live(session: aiohttp.ClientSession) -> bool:
    """
    Vérifie StreamingStatus.json pour savoir si une session live est active.
    encoding="utf-8-sig" : contourne le BOM UTF-8 de l'infrastructure F1.
    """
    url = f"{F1_STATIC_BASE}/StreamingStatus.json?rnd={int(time.time())}"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as r:
            # encoding="utf-8-sig" : supprime le BOM UTF-8 de l'API F1
            text = await r.text(encoding="utf-8-sig")
            try:
                data = json.loads(text)
            except json.JSONDecodeError as e:
                logger.warning("JSONDecodeError StreamingStatus.json : %s", e)
                return False
            status = data.get("Status", "Offline")
            logger.info("StreamingStatus : %s", status)
            return status in ("Online", "Available")
    except Exception:
        return False


# ─── MODE ARCHIVE & POLLING OPTIMISÉ ──────────────────────────────────────────

FAST_TOPICS = [
    "TimingData", "TimingAppData", "CarData.z", "Position.z",
]

SLOW_TOPICS = [
    "SessionInfo", "SessionStatus", "WeatherData",
    "RaceControlMessages", "TrackStatus", "LapCount", "ExtrapolatedClock",
]

ARCHIVE_TOPICS = FAST_TOPICS + SLOW_TOPICS


async def update_ingestion_status(
    mode: str,
    status_label: str,
    latency_ms: int = 0,
    transport: str = "http_polling",
    active_session: str = "",
) -> None:
    """Publie l'état d'ingestion pour le backend FastAPI et le frontend."""
    tok = (F1_AUTH_TOKEN or "").strip()
    status = {
        "mode": mode,
        "has_token": bool(tok),
        "status_label": status_label,
        "latency_ms": max(0, int(latency_ms)),
        "last_sync": time.time(),
        "transport": transport,
        "active_session": active_session,
    }
    await write_state_file("IngestionStatus", status)


async def fetch_single_topic(session: aiohttp.ClientSession, base: str, topic: str) -> None:
    """Récupère un topic de manière isolée avec gestion 429 / 502."""
    url = f"{base}{topic}.json?rnd={int(time.time()*1000)}"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=4, connect=2)) as r:
            if r.status == 429:
                retry_after = int(r.headers.get("Retry-After", 10) or 10)
                logger.warning("F1 Static API 429 (Rate Limit) sur %s — temporisation %ds", topic, retry_after)
                await asyncio.sleep(min(retry_after, 30))
                return
            if r.status in (502, 503, 504):
                logger.warning("F1 Static API %d temporaire sur %s", r.status, topic)
                return
            if r.status != 200:
                return

            text = await r.text(encoding="utf-8-sig")
            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                return

            await dispatch_static(topic, payload)

    except asyncio.TimeoutError:
        logger.debug("Timeout (4s) sur le topic %s", topic)
    except Exception as e:
        logger.debug("Erreur fetch archive %s : %s", topic, e)


async def poll_archive(session: aiohttp.ClientSession, path: str, is_session_live: bool = False) -> None:
    """
    Poll concurrent optimisé :
      - Topics haute fréquence (Timing, Positions, CarData) à cadence rapide (~1s)
      - Topics basse fréquence (Météo, Race Control, SessionInfo) toutes les ~4 secondes
      - Requêtes concurrentes via asyncio.gather pour éliminer la latence cumulée
      - Gestion fine des codes 429 et 502
    """
    mode = "live_polling" if is_session_live else "archive"
    label = "En direct (Délai API OpenF1)" if is_session_live else "Mode Archive (Session passée)"
    logger.info("Mode %s activé — path : %s", mode.upper(), path)

    base = f"{F1_STATIC_BASE}/{path}"
    tick_counter = 0

    while True:
        # Revérifier si le live officiel démarre (sauf si chemin forcé)
        if not FORCED_SESSION_PATH and await is_live(session):
            logger.info("Session live officielle détectée — basculement mode LIVE SignalR")
            return

        t0 = time.time()
        tick_counter += 1

        # 1. Topics rapides exécutés en parallèle
        fast_tasks = [fetch_single_topic(session, base, topic) for topic in FAST_TOPICS]

        # 2. Topics lents toutes les 4 itérations (~3.5-4s)
        slow_tasks = []
        if tick_counter % 4 == 1:
            slow_tasks = [fetch_single_topic(session, base, topic) for topic in SLOW_TOPICS]

        # Exécution concurrente
        await asyncio.gather(*fast_tasks, *slow_tasks, return_exceptions=True)

        latency_ms = int((time.time() - t0) * 1000)

        # Mettre à jour l'état d'ingestion toutes les 2 itérations
        if tick_counter % 2 == 0:
            await update_ingestion_status(
                mode=mode,
                status_label=label,
                latency_ms=latency_ms,
                transport="http_polling",
                active_session=path,
            )

        # Attente adaptative : cible ~900ms entre ticks pour une fluidité maximale
        elapsed = time.time() - t0
        sleep_time = max(0.2, 0.9 - elapsed)
        await asyncio.sleep(sleep_time)


async def dispatch_static(topic: str, payload) -> None:
    """Traite les payloads provenant des fichiers statiques d'archiveou du flux live."""
    global _current_session_key
    try:
        if topic == "CarData.z":
            raw = payload if isinstance(payload, str) else ""
            if not raw:
                return
            decoded = decode_f1_z_payload(raw)
            frames = decoded.get("Entries", [])
            if isinstance(frames, dict):
                frames = [frames]
            points = []
            for frame in frames:
                for drv, vals in frame.get("Cars", {}).items():
                    points.append({"driver_number": drv,
                                   "session_key": _current_session_key, **vals})
            if points:
                await write_car_data(points)

        elif topic == "Position.z":
            raw = payload if isinstance(payload, str) else ""
            if not raw:
                return
            decoded = decode_f1_z_payload(raw)
            positions = decoded.get("Position", [])
            valid = []
            for frame in positions:
                for drv, coords in frame.get("Entries", {}).items():
                    if filter_position(coords):
                        valid.append({"driver_number": drv,
                                      "session_key": _current_session_key, **coords})
            if valid:
                await write_positions(valid)

        elif topic == "SessionInfo":
            # Mise à jour du session_key réel pour les écritures Influx (B5)
            if isinstance(payload, dict):
                key = payload.get("Key")
                if key not in (None, ""):
                    _current_session_key = str(key)
            await write_state_file(topic, payload)

        elif topic == "WeatherData":
            # Météo servie au frontend via le fichier d'état (B4) — pas d'écriture Influx.
            await write_state_file(topic, payload)

        else:
            # RaceControlMessages, TrackStatus, LapCount, ExtrapolatedClock,
            # TimingData, TimingAppData, SessionStatus → fichier d'état.
            await write_state_file(topic, payload)

    except Exception as e:
        logger.error("Erreur dispatch_static %s : %s", topic, e)


# ─── MODE LIVE (SignalR) ──────────────────────────────────────────────────────

async def handle_message(raw: str) -> None:
    for frame in raw.split(RS):
        frame = frame.strip()
        if not frame:
            continue
        try:
            msg = json.loads(frame)
        except json.JSONDecodeError:
            continue

        if msg.get("type") == 6:
            continue
        if msg.get("type") == 1:
            target  = msg.get("target", "")
            args    = msg.get("arguments", [{}])
            payload = args[0] if args else {}
            await dispatch_static(target, payload)
        elif msg.get("type") == 7:
            logger.warning("Connexion fermée par F1 : %s", msg.get("error"))


async def run_live(session: aiohttp.ClientSession) -> bool:
    """Connexion SignalR Core. Retourne False si impossible (ex: pas de token)."""
    tok = (F1_AUTH_TOKEN or "").strip()
    if not tok:
        logger.warning("F1_AUTH_TOKEN absent — mode live SignalR impossible, bascule en polling")
        return False

    # Diagnostic sans révéler le secret : longueur, préfixe, et forme JWT
    # (le token F1 est un JWT d'entitlement F1TV — RS256, 3 segments séparés par '.').
    logger.info("F1_AUTH_TOKEN présent — len=%d prefix=%r jwt_shape=%s",
                len(tok), tok[:10], "JWT" if tok.count(".") == 2 else "NON-JWT (soupçon : mauvais type de token)")

    headers = {"Authorization": f"Bearer {tok}"}

    # Étape protocolaire OBLIGATOIRE qui manquait : les endpoints F1 sont derrière
    # un ALB AWS qui pose un cookie AWSALBCORS (anti-bot / stickiness) sur un OPTIONS.
    # Sans lui, le negotiate est souvent rejeté à l'EDGE (403) AVANT que le token ne
    # soit évalué — se manifeste exactement comme « le token ne marche pas » et reste
    # insensible à toute rotation de token. On reproduit le preflight OPTIONS que fait
    # fastf1.livetiming. aiohttp stocke le cookie dans son CookieJar et le renvoie
    # automatiquement sur le negotiate + le WS upgrade (même domaine).
    try:
        async with session.options(NEGOTIATE_URL) as o:
            albcors = o.cookies.get("AWSALBCORS")
            logger.info("Preflight OPTIONS HTTP %d — AWSALBCORS=%s",
                        o.status, "capturé" if albcors else "ABSENT (F1 pourrait bloquer)")
    except Exception as e:
        logger.warning("Preflight OPTIONS échoué : %s — on tente quand même", e)

    async with session.post(NEGOTIATE_URL, headers=headers) as resp:
        if resp.status != 200:
            # Avant, seul le code HTTP était logué → diagnostic impossible.
            # On capture le corps : F1 y explique pourquoi (expired / audience /
            # entitlement / geo / blocked). Tronqué à 500 caractères.
            try:
                body = (await resp.text())[:500]
            except Exception:
                body = "<corps illisible>"
            logger.error("Négociation échouée HTTP %d — corps: %s", resp.status, body)
            # Cartographie pour le diagnostic :
            #   401 → token invalide/expiré/mauvaise audience (le JWT F1TV est requis)
            #   403 → edge AWS/WAF (cookie AWSALBCORS absent, ou restriction F1 dure)
            #   404/5xx → endpoint indispo ou problème réseau
            return False
        data    = await resp.json(content_type=None)
        token   = data.get("connectionToken") or data.get("connectionId")

    ws_url = f"{WS_BASE_URL}?id={token}"
    async with session.ws_connect(ws_url, headers=headers, heartbeat=30, max_msg_size=0) as ws:
        logger.info("WebSocket SignalR connectée")
        await update_ingestion_status(
            mode="live_signalr",
            status_label="En direct officiel (Token actif)",
            latency_ms=15,
            transport="websocket",
            active_session="live_signalr",
        )
        await ws.send_str(HANDSHAKE_MSG)
        await ws.receive_str()
        await ws.send_str(SUBSCRIBE_MSG)
        logger.info("Souscription live envoyée")

        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                await handle_message(msg.data)
            elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED):
                break
    return True


# ─── Boucle principale ────────────────────────────────────────────────────────

async def run() -> None:
    backoff = 1
    async with aiohttp.ClientSession(
        headers={"User-Agent": "Mozilla/5.0 (compatible; F1Dashboard/1.0)"}
    ) as session:
        while True:
            try:
                live = await is_live(session)
                signalr_success = False
                if live and not FORCED_SESSION_PATH:
                    signalr_success = await run_live(session)
                
                # Si non-live, ou chemin forcé, ou erreur SignalR (pas de token) -> fallback Polling optimisé
                if not signalr_success:
                    path = await get_session_path(session)
                    if path:
                        logger.info("Basculement sur le polling concurrent de %s (live=%s)", path, live)
                        await poll_archive(session, path, is_session_live=live)
                    else:
                        logger.info("Aucune session disponible — attente 30s")
                        await update_ingestion_status(
                            mode="standby",
                            status_label="En attente de session",
                            latency_ms=0,
                            transport="http_polling",
                            active_session="",
                        )
                        await asyncio.sleep(30)
                backoff = 1
            except Exception as e:
                logger.error("Erreur boucle principale : %s — retry dans %ds", e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 64)


if __name__ == "__main__":
    asyncio.run(run())