"""
main.py
Middleware FastAPI / Uvicorn ASGI.

Routes :
  GET  /health      → healthcheck Docker
  GET  /static      → dictionnaire 2026 (pilotes, équipes, calendrier)
  WS   /ws          → flux de télémétrie temps réel (500ms)

Architecture interne :
  - ConnectionManager   : gestion des clients WebSocket connectés
  - broadcast_loop()    : boucle asynchrone 2 Hz alimentant tous les clients
  - assemble_payload()  : requête InfluxDB + enrichissement dictionnaire → BroadcastPayload
"""

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Optional

import orjson
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from data.f1_2026 import get_static_payload, DRIVERS_2026, TEAMS_2026, DRIVERS_STANDINGS_2026, TEAMS_STANDINGS_2026, get_driver_color
from influx_client import query_latest_state, get_client, close_client
from models import (
    BroadcastPayload,
    DriverTelemetry,
    RaceControlMessage,
    SessionState,
    WeatherState,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("api")

# Répertoire partagé avec consumer (volume Docker f1_state)
STATE_DIR = os.environ.get("F1_STATE_DIR", "/shared")

# Origines autorisées pour l'API (sécurisée — CORS n'est plus "*").
# Nginx reste le seul point d'entrée externe ; la liste vient du .env.
API_ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("API_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Remplace @app.on_event('startup') : démarre la boucle ET ferme Influx."""
    await get_client()  # chauffe le client singleton
    task = asyncio.create_task(broadcast_loop())
    logger.info("Lifespan : broadcast_loop démarrée")
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        await close_client()
        logger.info("Lifespan : client Influx fermé")

app = FastAPI(title="F1 Telemetry API", docs_url=None, redoc_url=None, lifespan=lifespan)

# CORS interne uniquement (Nginx fait office de seul point d'entrée externe).
# Si API_ALLOWED_ORIGINS n'est pas configuré, on reste permissif pour le dev local,
# mais en prod la liste doit être renseignée (cf. docker-compose.yml).
app.add_middleware(
    CORSMiddleware,
    allow_origins=API_ALLOWED_ORIGINS or ["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ─── Connection Manager ───────────────────────────────────────────────────────

class ConnectionManager:
    """Maintient la liste des clients WebSocket actifs. Thread-safe via asyncio."""

    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.append(ws)
        logger.info("Client connecté — total : %d", len(self.active))

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.active:
            self.active.remove(ws)
        logger.info("Client déconnecté — total : %d", len(self.active))

    async def broadcast(self, data: bytes) -> None:
        """Diffuse en parallèle vers tous les clients. Purge les sockets mortes."""
        dead = []
        for ws in self.active:
            try:
                await ws.send_bytes(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()

# Dernier état connu : utilisé comme fallback si InfluxDB ne répond pas
_last_payload: Optional[bytes] = None

# ─── Assemblage du payload ────────────────────────────────────────────────────

async def _read_state_file(topic: str) -> dict:
    """Lit le fichier d'état JSON déposé par consumer.py (hors event loop)."""
    path = os.path.join(STATE_DIR, f"f1_state_{topic}.json")
    def _load():
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
    return await asyncio.to_thread(_load)


def _lap_time_to_secs(s: str) -> Optional[float]:
    """Convertit "1:23.456" (ou "23.456") en secondes. None si non parsable."""
    s = (s or "").strip()
    if not s:
        return None
    try:
        if ":" in s:
            m, sec = s.split(":", 1)
            return float(m) * 60 + float(sec)
        return float(s)
    except ValueError:
        return None


def _parse_race_control(raw) -> list[dict]:
    """
    Normalise le payload RaceControlMessages F1 :
      - archive : {"Messages": [ {Utc, Category, Message, Flag}, … ]}
      - live    : {"Messages": { "1": {...}, "2": {...}, … }} (dict indexé)
    Retourne les 15 plus récents triés par Utc décroissant.
    """
    if isinstance(raw, dict):
        msgs = raw.get("Messages", raw)
    else:
        msgs = raw
    if isinstance(msgs, dict):
        msgs = list(msgs.values())
    if not isinstance(msgs, list):
        return []
    out = []
    for m in msgs:
        if not isinstance(m, dict):
            continue
        out.append({
            "Utc":      str(m.get("Utc", "")),
            "Category": str(m.get("Category", "")),
            "Message":  str(m.get("Message", "")),
            "Flag":     str(m.get("Flag", "")),
        })
    out.sort(key=lambda x: x["Utc"], reverse=True)
    return out[:15]


async def assemble_payload() -> BroadcastPayload:
    """
    Construit le payload complet en fusionnant :
      - Points InfluxDB (car_data, position, stint)
      - Fichiers d'état déposés par consumer.py (TimingData, WeatherData, RaceControlMessages…)
      - Dictionnaire statique 2026 (couleurs, acronymes)
    """
    # Requête InfluxDB (fenêtre 5 secondes) — peut retourner liste vide sans lever d'exception
    try:
        influx_rows = await query_latest_state(window_seconds=5)
    except Exception as e:
        logger.warning("InfluxDB indisponible : %s — données télémétriques omises", e)
        influx_rows = []

    # Race Control : désormais lu depuis le fichier d'état (A1 — ferme la boucle
    # consumer→fichier→main ; la measurement Influx fantôme est supprimée).
    # Tous les fichiers d'état sont lus concurremment hors event loop.
    timing, weather_raw, track_raw, session_info, lap_count, extrap_clock, rc_raw = \
        await asyncio.gather(
            _read_state_file("TimingData"),
            _read_state_file("WeatherData"),
            _read_state_file("TrackStatus"),
            _read_state_file("SessionInfo"),
            _read_state_file("LapCount"),
            _read_state_file("ExtrapolatedClock"),
            _read_state_file("RaceControlMessages"),
        )

    # Index par pilote — une seule ligne complète par driver (pivot corrigé, B1)
    by_driver: dict[str, dict] = {}
    for row in influx_rows:
        drv = str(row.get("driver_number", ""))
        if drv:
            by_driver.setdefault(drv, {}).update(row)

    # Fusion avec TimingData (classement, gaps, secteurs)
    timing_lines = timing.get("Lines", {})

    # Météo (B4) depuis le fichier d'état. Correctif rainfall : int() au lieu de bool(),
    # car bool("0") == True → affichait de la pluie quand Rainfall="0" (string F1).
    def _to_float(v, default=0.0):
        try:
            return float(v)
        except (TypeError, ValueError):
            return default
    weather = WeatherState(
        air_temp=_to_float(weather_raw.get("AirTemp", 0)),
        track_temp=_to_float(weather_raw.get("TrackTemp", 0)),
        humidity=_to_float(weather_raw.get("Humidity", 0)),
        wind_speed=_to_float(weather_raw.get("WindSpeed", 0)),
        rainfall=bool(int(weather_raw.get("Rainfall", 0) or 0)),
    )

    # Session
    track_status = track_raw.get("Status", "1")

    # Extraction des métadonnées de session
    circuit_info = session_info.get("Circuit", {})
    meeting      = session_info.get("Meeting", {})
    country_info = meeting.get("Country", {})

    # Temps restant : LapCount fournit Current + Total, ou ExtrapolatedClock
    time_remaining = ""
    if extrap_clock:
        time_remaining = extrap_clock.get("Remaining", "")
    elif isinstance(lap_count, dict):
        cur  = int(lap_count.get("CurrentLap", 0) or 0)
        tot  = int(lap_count.get("TotalLaps",  0) or 0)
        if tot > 0 and cur > 0:
            left = tot - cur
            time_remaining = f"Tour {cur}/{tot} (−{left})"

    session = SessionState(
        session_name=session_info.get("Name", ""),
        session_type=session_info.get("Type", ""),
        track_status=track_status,
        safety_car=track_status == "4",
        virtual_safety_car=track_status == "6",
        lap_current=int(lap_count.get("CurrentLap", 0) or 0) if isinstance(lap_count, dict) else 0,
        lap_total=int(lap_count.get("TotalLaps", 0) or 0)    if isinstance(lap_count, dict) else 0,
        time_remaining=time_remaining,
        circuit_name=circuit_info.get("ShortName", meeting.get("Name", "")),
        country=country_info.get("Name", ""),
        country_code=country_info.get("Code", ""),
        gmt_offset=session_info.get("GmtOffset", ""),
        meeting_key=int(session_info.get("Meeting", {}).get("Key", 0) or 0),
        session_key=int(session_info.get("Key", 0) or 0),
    )

    # Construction des standings triés par position en piste
    # A5 : best_lap — calculé en comparant last_lap_time de chaque pilote ;
    #      le détenteur du meilleur tour de la session reçoit best_lap=True.
    standings: list[DriverTelemetry] = []
    best_lap_secs: Optional[float] = None
    best_lap_driver: Optional[str] = None
    # 1er passage : déterminer le meilleur tour
    for drv_num_int in DRIVERS_2026:
        drv_str = str(drv_num_int)
        t_line  = timing_lines.get(drv_str, {})
        last_lap_raw = t_line.get("LastLapTime", "")
        if isinstance(last_lap_raw, dict):
            last_lap = str(last_lap_raw.get("Value", ""))
        else:
            last_lap = str(last_lap_raw)
        secs = _lap_time_to_secs(last_lap)
        if secs is not None and (best_lap_secs is None or secs < best_lap_secs):
            best_lap_secs = secs
            best_lap_driver = drv_str

    # 2e passage : construction des objets DriverTelemetry
    for drv_num_int, driver_info in DRIVERS_2026.items():
        drv_str  = str(drv_num_int)
        influx   = by_driver.get(drv_str, {})
        t_line   = timing_lines.get(drv_str, {})

        color = get_driver_color(drv_num_int)

        # Récupération secteurs (TimingData retourne une liste ou un dict selon la version)
        sectors = t_line.get("Sectors", [])
        def get_sector(idx: int) -> str:
            if isinstance(sectors, list) and len(sectors) > idx:
                return str(sectors[idx].get("Value", ""))
            if isinstance(sectors, dict):
                s = list(sectors.values())
                return str(s[idx].get("Value", "")) if len(s) > idx else ""
            return ""

        # Temps au tour : peut être un dict {"Value": "1:23.456"} ou une str directe
        last_lap_raw = t_line.get("LastLapTime", "")
        if isinstance(last_lap_raw, dict):
            last_lap = str(last_lap_raw.get("Value", ""))
        else:
            last_lap = str(last_lap_raw)

        d = DriverTelemetry(
            driver_number = drv_num_int,
            acronym       = driver_info["acronym"],
            team          = driver_info["team"],
            team_color    = color,
            position      = int(t_line.get("Position", 0) or 0),
            gap_to_leader = str(t_line.get("GapToLeader", "")),
            last_lap_time = last_lap,
            sector_1      = get_sector(0),
            sector_2      = get_sector(1),
            sector_3      = get_sector(2),
            best_lap      = (drv_str == best_lap_driver),
            compound      = str(influx.get("compound", "UNKNOWN")),
            tyre_age      = int(influx.get("tyre_age_at_start", 0) or 0),
            speed         = int(influx.get("speed", 0) or 0),
            rpm           = int(influx.get("rpm", 0) or 0),
            gear          = int(influx.get("gear", 0) or 0),
            throttle      = int(influx.get("throttle", 0) or 0),
            brake         = int(influx.get("brake", 0) or 0),
            drs           = int(influx.get("drs", 0) or 0) > 8,
            in_pit        = bool(t_line.get("InPit", False)),
            retired       = bool(t_line.get("Retired", False)),
            x             = float(influx.get("x", 0.0) or 0.0),
            y             = float(influx.get("y", 0.0) or 0.0),
        )
        standings.append(d)

    # Tri par position (0 en dernier)
    standings.sort(key=lambda d: d.position if d.position > 0 else 999)

    # Race Control (15 derniers messages) depuis le fichier d'état (A1)
    rc_list = _parse_race_control(rc_raw)
    rc_messages = [
        RaceControlMessage(
            timestamp=m["Utc"],
            category=m["Category"],
            message=m["Message"],
            flag=m["Flag"],
        )
        for m in rc_list
    ]

    return BroadcastPayload(
        server_ts=time.time(),
        session=session,
        standings=standings,
        weather=weather,
        race_control=rc_messages,
    )

# ─── Boucle de diffusion (Broadcast Loop) ────────────────────────────────────

async def broadcast_loop() -> None:
    """
    Boucle asynchrone cadencée à 500ms (2 Hz).
    Récupère l'état InfluxDB, assemble le payload Pydantic,
    le sérialise via orjson et diffuse en binaire vers tous les clients WebSocket.
    """
    global _last_payload
    logger.info("Broadcast loop démarrée (2 Hz)")

    while True:
        await asyncio.sleep(0.5)
        if not manager.active:
            continue  # pas de client connecté, rien à calculer

        try:
            payload = await assemble_payload()
            data = orjson.dumps(payload.model_dump())
            _last_payload = data
        except Exception as e:
            logger.error("Erreur assemblage payload : %s", e)
            data = _last_payload  # fail-safe : dernier état connu

        if data:
            await manager.broadcast(data)

# ─── Routes HTTP ──────────────────────────────────────────────────────────────

async def _get_live_standings() -> tuple[list, list]:
    """
    Lit les classements dynamiques depuis standings_sync.py (via STATE_DIR).
    Fallback sur les données statiques f1_2026.py si le fichier n'existe pas encore.
    """
    drivers_file, teams_file = await asyncio.gather(
        _read_state_file("DriversStandings"),
        _read_state_file("TeamsStandings"),
    )

    drivers = drivers_file.get("standings", []) if isinstance(drivers_file, dict) else []
    teams   = teams_file.get("standings", [])   if isinstance(teams_file, dict)   else []

    if not drivers:
        drivers = DRIVERS_STANDINGS_2026
        logger.info("Standings pilotes : fallback données statiques f1_2026.py")
    if not teams:
        teams = TEAMS_STANDINGS_2026
        logger.info("Standings équipes : fallback données statiques f1_2026.py")

    return drivers, teams


@app.get("/health")
async def health():
    return {"status": "ok", "clients": len(manager.active)}


@app.get("/static")
async def static_data():
    """
    Retourne le dictionnaire complet 2026 (pilotes, équipes, calendrier)
    + classements dynamiques depuis standings_sync ou fallback statique.
    Appelé une seule fois par le frontend au chargement du DOM.
    """
    payload = get_static_payload()
    drivers_standings, teams_standings = await _get_live_standings()
    payload["drivers_standings"] = drivers_standings
    payload["teams_standings"]   = teams_standings

    # Métadonnées du dernier GP pour enrichir l'affichage
    last_race, season_results = await asyncio.gather(
        _read_state_file("LastRaceResult"),
        _read_state_file("SeasonResults"),
    )
    if isinstance(season_results, dict):
        payload["season_results"] = season_results.get("races", [])
    if last_race:
        payload["last_race"] = last_race

    return JSONResponse(content=payload)

# ─── Route WebSocket ──────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        # Envoi immédiat du dernier payload connu (affichage instantané)
        if _last_payload:
            await ws.send_bytes(_last_payload)
        # Maintien de la connexion ouverte, la broadcast_loop se charge de l'envoi
        while True:
            await ws.receive_text()  # écoute les éventuels messages client (ping)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(ws)