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


class BroadcastPayload(BaseModel):
    """Payload complet diffusé toutes les 500ms via WebSocket vers les clients."""
    server_ts: float
    session: SessionState = Field(default_factory=SessionState)
    standings: list[DriverTelemetry] = Field(default_factory=list)
    weather: WeatherState = Field(default_factory=WeatherState)
    race_control: list[RaceControlMessage] = Field(default_factory=list)
