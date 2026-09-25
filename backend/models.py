"""
models.py
Schémas Pydantic v2 validant les payloads sortants vers le frontend.
Toute donnée manquante reçoit une valeur par défaut pour garantir la continuité visuelle.
"""

from pydantic import BaseModel, Field
from typing import Optional


class DriverTelemetry(BaseModel):
    driver_number: int
    acronym: str = "---"
    team: str = "Unknown"
    team_color: str = "#FFFFFF"
    position: int = 0
    gap_to_leader: str = ""
    last_lap_time: str = ""
    sector_1: str = ""
    sector_2: str = ""
    sector_3: str = ""
    best_lap: bool = False
    compound: str = "UNKNOWN"
    tyre_age: int = 0
    speed: int = 0
    rpm: int = 0
    gear: int = 0
    throttle: int = 0
    brake: int = 0
    drs: bool = False
    in_pit: bool = False
    retired: bool = False
    x: float = 0.0
    y: float = 0.0


class WeatherState(BaseModel):
    air_temp: float = 0.0
    track_temp: float = 0.0
    humidity: float = 0.0
    wind_speed: float = 0.0
    rainfall: bool = False


class RaceControlMessage(BaseModel):
    timestamp: str = ""
    category: str = ""
    message: str = ""
    flag: str = ""


class SessionState(BaseModel):
    session_name: str = ""
    session_type: str = ""          # "Race" | "Qualifying" | "Sprint" | "Practice 1" …
    track_status: str = "1"         # 1=Vert, 2=Jaune, 4=SC, 5=Rouge, 6=VSC
    safety_car: bool = False
    virtual_safety_car: bool = False
    lap_current: int = 0
    lap_total: int = 0
    time_remaining: str = ""        # "1:23:45" ou "—"
    circuit_name: str = ""
    country: str = ""
    country_code: str = ""          # ISO-2 pour affichage du drapeau emoji
    gmt_offset: str = ""            # "+09:00" (fuseau du circuit)
    meeting_key: int = 0
    session_key: int = 0


class IngestionStatus(BaseModel):
    mode: str = "archive"               # "live_signalr" | "live_polling" | "archive" | "simulation"
    has_token: bool = False
    status_label: str = "Mode Archive"  # "En direct officiel (Token actif)", "En direct (Délai API OpenF1)", etc.
    latency_ms: int = 0
    last_sync: float = 0.0
    transport: str = "http_polling"    # "websocket" | "http_polling"
    active_session: str = ""


class NewsArticle(BaseModel):
    id: str
    title: str
    summary: str
    image_url: Optional[str] = None
    link: str
    source: str = "F1"
    published_at: str = ""
    category: str = "Général"


class TeamRadioMessage(BaseModel):
    """Message radio d'équipe avec transcription textuelle et URL audio OpenF1."""
    id: str
    session_key: int = 0
    driver_number: int
    driver_acronym: str = "---"
    team_name: str = "Unknown"
    team_color: str = "#FFFFFF"
    timestamp: str = ""
    recording_url: str = ""
    transcript: str = ""
    category: str = "GENERAL"  # "STRATEGY" | "TIRE" | "TECHNICAL" | "INCIDENT" | "GENERAL"
    is_urgent: bool = False


class BroadcastPayload(BaseModel):
    """Payload complet diffusé toutes les 500ms via WebSocket vers les clients."""
    server_ts: float
    session: SessionState = Field(default_factory=SessionState)
    standings: list[DriverTelemetry] = Field(default_factory=list)
    weather: WeatherState = Field(default_factory=WeatherState)
    race_control: list[RaceControlMessage] = Field(default_factory=list)
    ingestion_status: IngestionStatus = Field(default_factory=IngestionStatus)
    team_radios: list[TeamRadioMessage] = Field(default_factory=list)


class TelemetryTrace(BaseModel):
    driver_number: int
    acronym: str = "---"
    team: str = "Unknown"
    team_color: str = "#FFFFFF"
    lap_number: int = 0
    lap_time_str: str = ""
    speed: list[float] = Field(default_factory=list)
    throttle: list[float] = Field(default_factory=list)
    brake: list[float] = Field(default_factory=list)
    gear: list[int] = Field(default_factory=list)
    drs: list[int] = Field(default_factory=list)
    rpm: list[int] = Field(default_factory=list)


class TelemetryCompareResponse(BaseModel):
    session_key: int
    circuit_name: str = ""
    circuit_length_m: float = 5000.0
    sample_count: int = 0
    distance: list[float] = Field(default_factory=list)
    driver_a: TelemetryTrace
    driver_b: TelemetryTrace
    delta_time: list[float] = Field(default_factory=list)
    time_diff_total: float = 0.0


