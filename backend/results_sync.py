"""
results_sync.py
Service de synchronisation des résultats de courses de la saison.

Stratégie :
  - Source : API Ergast via jolpi.ca (proxy CORS-libre, gratuit)
  - Fréquence : au démarrage puis toutes les 30 min pendant un week-end,
                toutes les 6h hors week-end
  - Persistance : f1_state_SeasonResults.json dans STATE_DIR (/shared)
    → lu par main.py et diffusé aux clients via WebSocket

Endpoints Ergast utilisés :
  /f1/{year}/results.json?limit=500  → résultats complets de la saison
  /f1/{year}/qualifying.json?limit=500 → résultats qualifications (optionnel)
"""

import asyncio
import json
import logging
import os
import time

import aiohttp

from data.f1_2026 import SEASON, TEAM_NAME_MAP, CALENDAR_2026

logger = logging.getLogger("results_sync")

STATE_DIR   = os.environ.get("F1_STATE_DIR", "/shared")
ERGAST_BASE = "https://api.jolpi.ca/ergast/f1"

# Intervalles selon activité
SYNC_INTERVAL_RACE_WEEKEND = 30 * 60   # 30 min pendant un GP
SYNC_INTERVAL_NORMAL       = 6 * 3600  # 6h en dehors

# ─── Helpers ──────────────────────────────────────────────────────────────────

async def fetch_json(session: aiohttp.ClientSession, url: str) -> dict:
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
            if resp.status == 429:
                logger.warning("Rate limit — pause 90s")
                await asyncio.sleep(90)
                return {}
            if resp.status != 200:
                logger.warning("HTTP %d pour %s", resp.status, url)
                return {}
            return await resp.json(content_type=None)
    except asyncio.TimeoutError:
        logger.warning("Timeout : %s", url)
        return {}
    except Exception as e:
        logger.error("Erreur fetch %s : %s", url, e)
        return {}


def normalize_result(r: dict) -> dict:
    """Transforme un Result Ergast brut en objet simplifié."""
    driver = r.get("Driver", {})
    constructor = r.get("Constructor", {})
    given  = driver.get("givenName", "")
    family = driver.get("familyName", "")
    team_raw = constructor.get("name", "")

    fl = r.get("FastestLap", {})
    return {
        "position":       int(r.get("position", 0)),
        "grid":           int(r.get("grid", 0)),
        "status":         r.get("status", ""),
        "points":         float(r.get("points", 0)),
        "acronym":        (driver.get("code") or "???").upper(),
        "driver_number":  int(driver.get("permanentNumber", 0)),
        "name":           f"{given} {family}".strip(),
        "team":           TEAM_NAME_MAP.get(team_raw, team_raw),
        "time":           r.get("Time", {}).get("time", ""),
        "fastest_lap":    fl.get("rank") == "1",
        "fastest_lap_time": fl.get("Time", {}).get("time", ""),
        "fastest_lap_num":  int(fl.get("lap", 0)) if fl.get("lap") else None,
    }


def normalize_race(race: dict) -> dict:
    """Transforme une Race Ergast brute en objet propre."""
    circuit = race.get("Circuit", {})
    loc     = circuit.get("Location", {})
    return {
        "round":    int(race.get("round", 0)),
        "season":   int(race.get("season", SEASON)),
        "name":     race.get("raceName", ""),
        "circuit":  circuit.get("circuitName", ""),
        "country":  loc.get("country", ""),
        "locality": loc.get("locality", ""),
        "date":     race.get("date", ""),
        "time":     race.get("time", ""),
        "results":  [normalize_result(r) for r in race.get("Results", [])],
    }


def write_state(filename: str, payload: dict | list) -> None:
    path = os.path.join(STATE_DIR, filename)
    tmp  = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, path)
        logger.info("Écrit : %s (%d octets)", path, os.path.getsize(path))
    except Exception as e:
        logger.error("Impossible d'écrire %s : %s", path, e)

# ─── Détection week-end de course ─────────────────────────────────────────────

def is_race_weekend() -> bool:
    """Retourne True si on est dans la fenêtre (J-1 … fin+2h) d'un GP non annulé."""
    now_ts = time.time()
    for gp in CALENDAR_2026:
        if gp.get("cancelled"):   # E6 : ignore les GP annulés (Bahreïn, Arabie Saoudite)
            continue
        try:
            start = time.mktime(time.strptime(gp["date_start"], "%Y-%m-%d"))
            end   = time.mktime(time.strptime(gp["date_end"],   "%Y-%m-%d")) + 86400
            if start - 86400 <= now_ts <= end + 7200:
                return True
        except Exception:
            pass
    return False

# ─── Synchronisation principale ───────────────────────────────────────────────

async def sync_once(session: aiohttp.ClientSession) -> None:
    logger.info("Début sync résultats saison %d…", SEASON)

    data = await fetch_json(
        session,
        f"{ERGAST_BASE}/{SEASON}/results.json?limit=500"
    )

    races_raw = []
    try:
        races_raw = data["MRData"]["RaceTable"]["Races"]
    except (KeyError, TypeError):
        logger.warning("Structure Ergast inattendue — aucun résultat")

    races = [normalize_race(r) for r in races_raw]

    if races:
        write_state("f1_state_SeasonResults.json", {
            "season":     SEASON,
            "races":      races,
            "count":      len(races),
            "updated_at": time.time(),
        })
        logger.info("Sync terminée — %d courses avec résultats", len(races))
    else:
        logger.warning("Aucune course récupérée — état non mis à jour")


async def run() -> None:
    logger.info("results_sync démarré pour la saison %d", SEASON)
    async with aiohttp.ClientSession(
        headers={"User-Agent": "f1-telemetry-dashboard/2.0 (results-sync)"}
    ) as session:
        while True:
            try:
                await sync_once(session)
            except Exception as e:
                logger.error("Erreur sync_once : %s", e)

            interval = SYNC_INTERVAL_RACE_WEEKEND if is_race_weekend() else SYNC_INTERVAL_NORMAL
            logger.info("Prochaine sync dans %dmin", interval // 60)
            await asyncio.sleep(interval)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    asyncio.run(run())
