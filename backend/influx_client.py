"""
influx_client.py
Wrapper du client InfluxDB v2.7 asynchrone.
Centralise l'écriture par batch et la lecture Flux.

Notes structurelles :
  - Un seul client async réutilisé (B7) au lieu d'un client par appel.
  - Les vars d'env ont des défauts (B8) pour éviter un KeyError cryptique à l'import.
  - write_car_data/write_positions/write_stint prennent un tag session_key réel (B5).
  - Plus de write_weather : la météo est servie au frontend via le fichier d'état (B4).
"""

import os
import logging
from datetime import datetime, timezone
from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync
from influxdb_client import Point, WritePrecision

logger = logging.getLogger(__name__)

INFLUX_URL    = os.environ.get("INFLUX_URL", "http://influxdb:8086")
INFLUX_TOKEN  = os.environ.get("INFLUX_TOKEN", "")
INFLUX_ORG    = os.environ.get("INFLUX_ORG", "f1")
INFLUX_BUCKET = os.environ.get("INFLUX_BUCKET", "f1-telemetry")

# Client async singleton (B7) — créé paresseusement, fermé à l'arrêt du processus.
_client_instance: InfluxDBClientAsync | None = None


async def get_client() -> InfluxDBClientAsync:
    global _client_instance
    if _client_instance is None:
        _client_instance = InfluxDBClientAsync(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
    return _client_instance


async def close_client() -> None:
    global _client_instance
    if _client_instance is not None:
        await _client_instance.close()
        _client_instance = None



async def write_car_data(entries: list[dict]) -> None:
    """
    Écrit la télémétrie CarData.z dans le measurement 'car_data'.
    Tags (indexés) : driver_number, session_key
    Fields (non indexés) : speed, rpm, gear, throttle, brake, drs
    Précision nanoseconde pour éviter l'écrasement des points simultanés.
    """
    points = []
    for e in entries:
        try:
            p = (
                Point("car_data")
                .tag("driver_number", str(e["driver_number"]))
                .tag("session_key", str(e.get("session_key", "latest")))
                .field("speed",    int(e.get("Speed", 0)))
                .field("rpm",      int(e.get("RPM", 0)))
                .field("gear",     int(e.get("nGear", 0)))
                .field("throttle", int(e.get("Throttle", 0)))
                .field("brake",    int(e.get("Brake", 0)))
                .field("drs",      int(e.get("DRS", 0)))
                .time(datetime.now(timezone.utc), WritePrecision.NS)
            )
            points.append(p)
        except (KeyError, ValueError) as err:
            logger.debug("Point car_data ignoré : %s", err)

    if not points:
        return
    client = await get_client()
    await client.write_api().write(bucket=INFLUX_BUCKET, record=points)


async def write_positions(entries: list[dict]) -> None:
    """
    Écrit les coordonnées Position.z dans le measurement 'position'.
    Les entrées {X:0, Y:0} sont déjà filtrées en amont par decoder.filter_position().
    """
    points = []
    for e in entries:
        try:
            p = (
                Point("position")
                .tag("driver_number", str(e["driver_number"]))
                .tag("session_key", str(e.get("session_key", "latest")))
                .field("x", float(e["X"]))
                .field("y", float(e["Y"]))
                .field("z", float(e.get("Z", 0.0)))
                .time(datetime.now(timezone.utc), WritePrecision.NS)
            )
            points.append(p)
        except (KeyError, ValueError) as err:
            logger.debug("Point position ignoré : %s", err)

    if not points:
        return
    client = await get_client()
    await client.write_api().write(bucket=INFLUX_BUCKET, record=points)


async def write_stint(driver_number: int, stint: dict, session_key: str | None = None) -> None:
    client = await get_client()
    p = (
        Point("stint")
        .tag("driver_number", str(driver_number))
        .tag("session_key", str(session_key or "latest"))
        .field("compound",         stint.get("compound", "UNKNOWN"))
        .field("stint_number",     int(stint.get("stint_number", 0)))
        .field("lap_start",        int(stint.get("lap_start", 0)))
        .field("tyre_age_at_start",int(stint.get("tyre_age_at_start", 0)))
        .time(datetime.now(timezone.utc), WritePrecision.NS)
    )
    await client.write_api().write(bucket=INFLUX_BUCKET, record=[p])


async def query_latest_state(window_seconds: int = 5) -> list[dict]:
    """
    Requête Flux récupérant les derniers points de car_data / position / stint
    sur les N dernières secondes, aplatis en UNE ligne par pilote.

    Correctif B1 : auparavant le pivot sur rowKey ["_time","driver_number"] produisait
    plusieurs lignes creuses par pilote (car_data/position/stint ayant des timestamps
    d'écriture différents), et by_driver.update() les fusionnait en écrasant
    speed/rpm/gear avec null. On regroupe maintenant par (driver, measurement, field),
    on prend last(), puis on re-regroupe par driver et on pivote sur _field → une
    seule ligne complète par pilote, sans écrasement.
    La météo et race_control ne sont PAS requêtées ici : servies via fichiers d'état.
    """
    flux = f"""
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -{window_seconds}s)
  |> filter(fn: (r) => r._measurement == "car_data" or r._measurement == "position" or r._measurement == "stint")
  |> group(columns: ["driver_number", "_measurement", "_field"])
  |> last()
  |> group(columns: ["driver_number"])
  |> pivot(rowKey: ["driver_number"], columnKey: ["_field"], valueColumn: "_value")
"""
    client = await get_client()
    tables = await client.query_api().query(flux)
    results = []
    for table in tables:
        for record in table.records:
            results.append(dict(record.values))
    return results
