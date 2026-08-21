"""
standings_sync.py
Service de synchronisation automatique des classements pilotes et constructeurs.

Stratégie :
  - Source      : API Ergast via jolpi.ca (proxy CORS-libre, données structurées, fiables)
  - Fréquence   : toutes les 6 heures (et au démarrage)
  - Persistance : fichier JSON dans STATE_DIR pour lecture par main.py
"""

import asyncio
import json
import logging
import os
import time

import aiohttp

from data.f1_2026 import SEASON, TEAM_NAME_MAP

logger = logging.getLogger("standings_sync")

STATE_DIR   = os.environ.get("F1_STATE_DIR", "/shared")
SYNC_INTERVAL_SECS = 6 * 3600  # toutes les 6 heures

ERGAST_BASE = "https://api.jolpi.ca/ergast/f1"   # proxy Ergast communautaire, CORS-libre

# Acronymes F1 officiels par nom complet (fallback si Ergast ne fournit pas)
DRIVER_ACRONYM_MAP = {
    "Kimi Antonelli":    "ANT",
    "Andrea Kimi Antonelli": "ANT",
    "George Russell":    "RUS",
    "Charles Leclerc":   "LEC",
    "Lewis Hamilton":    "HAM",
    "Lando Norris":      "NOR",
    "Oscar Piastri":     "PIA",
    "Oliver Bearman":    "BEA",
    "Pierre Gasly":      "GAS",
    "Max Verstappen":    "VER",
    "Liam Lawson":       "LAW",
    "Isack Hadjar":      "HAD",
    "Gabriel Bortoleto": "BOR",
    "Carlos Sainz":      "SAI",
    "Arvid Lindblad":    "LIN",
    "Franco Colapinto":  "COL",
    "Esteban Ocon":      "OCO",
    "Alexander Albon":   "ALB",
    "Sergio Pérez":      "PER",
    "Sergio Perez":      "PER",
    "Valtteri Bottas":   "BOT",
    "Fernando Alonso":   "ALO",
    "Lance Stroll":      "STR",
    "Nico Hülkenberg":   "HUL",
    "Nico Hulkenberg":   "HUL",
}

FLAGS_MAP = {
    "British":    "🇬🇧",
    "Italian":    "🇮🇹",
    "Monegasque": "🇲🇨",
    "Finnish":    "🇫🇮",
    "Dutch":      "🇳🇱",
    "French":     "🇫🇷",
    "Australian": "🇦🇺",
    "Spanish":    "🇪🇸",
    "German":     "🇩🇪",
    "New Zealander": "🇳🇿",
    "Brazilian":  "🇧🇷",
    "Canadian":   "🇨🇦",
    "Mexican":    "🇲🇽",
    "Thai":       "🇹🇭",
    "Argentine":  "🇦🇷",
    "Swedish":    "🇸🇪",
    "Argentinian":"🇦🇷",
}


async def fetch_json(session: aiohttp.ClientSession, url: str) -> dict | list:
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status == 429:
                logger.warning("Rate limit atteint sur %s — pause 60s", url)
                await asyncio.sleep(60)
                return {}
            if resp.status != 200:
                logger.warning("HTTP %d pour %s", resp.status, url)
                return {}
            return await resp.json(content_type=None)
    except asyncio.TimeoutError:
        logger.warning("Timeout pour %s", url)
        return {}
    except Exception as e:
        logger.error("Erreur fetch %s : %s", url, e)
        return {}


async def fetch_drivers_standings(session: aiohttp.ClientSession) -> list[dict]:
    """Récupère le classement pilotes depuis Ergast."""
    data = await fetch_json(
        session,
        f"{ERGAST_BASE}/{SEASON}/driverStandings.json?limit=30"
    )
    try:
        standings_table = data["MRData"]["StandingsTable"]["StandingsLists"][0]
        raw = standings_table["DriverStandings"]
    except (KeyError, IndexError, TypeError):
        logger.warning("Structure Ergast pilotes inattendue — données vides")
        return []

    result = []
    for entry in raw:
        driver = entry.get("Driver", {})
        constructors = entry.get("Constructors", [{}])
        team_raw = constructors[0].get("name", "") if constructors else ""
        team = TEAM_NAME_MAP.get(team_raw, team_raw)

        given  = driver.get("givenName", "")
        family = driver.get("familyName", "")
        full   = f"{given} {family}".strip()
        acronym = driver.get("code") or DRIVER_ACRONYM_MAP.get(full, full[:3].upper())
        flag = FLAGS_MAP.get(driver.get("nationality", ""), "")

        result.append({
            "position":      int(entry.get("position", 0)),
            "acronym":       acronym,
            "driver_number": int(driver.get("permanentNumber", 0)),
            "name":          full,
            "team":          team,
            "points":        int(float(entry.get("points", 0))),
            "wins":          int(entry.get("wins", 0)),
            "flag":          flag,
        })

    logger.info("Classement pilotes récupéré : %d entrées", len(result))
    return result


async def fetch_teams_standings(session: aiohttp.ClientSession) -> list[dict]:
    """Récupère le classement constructeurs depuis Ergast."""
    data = await fetch_json(
        session,
        f"{ERGAST_BASE}/{SEASON}/constructorStandings.json?limit=20"
    )
    try:
        standings_table = data["MRData"]["StandingsTable"]["StandingsLists"][0]
        raw = standings_table["ConstructorStandings"]
    except (KeyError, IndexError, TypeError):
        logger.warning("Structure Ergast constructeurs inattendue — données vides")
        return []

    result = []
    for entry in raw:
        constructor = entry.get("Constructor", {})
        name_raw = constructor.get("name", "")
        name = TEAM_NAME_MAP.get(name_raw, name_raw)
        result.append({
            "position": int(entry.get("position", 0)),
            "name":     name,
            "points":   int(float(entry.get("points", 0))),
            "wins":     int(entry.get("wins", 0)),
        })

    logger.info("Classement constructeurs récupéré : %d entrées", len(result))
    return result


async def fetch_last_race_results(session: aiohttp.ClientSession) -> dict:
    """Récupère le résultat de la dernière course (pour enrichir l'interface)."""
    data = await fetch_json(session, f"{ERGAST_BASE}/{SEASON}/last/results.json")
    try:
        race = data["MRData"]["RaceTable"]["Races"][0]
        return {
            "round":    int(race.get("round", 0)),
            "name":     race.get("raceName", ""),
            "circuit":  race.get("Circuit", {}).get("circuitName", ""),
            "country":  race.get("Circuit", {}).get("Location", {}).get("country", ""),
            "date":     race.get("date", ""),
            "results":  [
                {
                    "position": int(r.get("position", 0)),
                    "acronym":  r.get("Driver", {}).get("code", ""),
                    "name":     f"{r['Driver'].get('givenName','')} {r['Driver'].get('familyName','')}".strip(),
                    "team":     TEAM_NAME_MAP.get(
                        r.get("Constructor", {}).get("name", ""), ""
                    ),
                    "points":   float(r.get("points", 0)),
                    "time":     r.get("Time", {}).get("time", r.get("status", "")),
                }
                for r in race.get("Results", [])[:10]
            ],
        }
    except (KeyError, IndexError, TypeError):
        return {}


def write_state(filename: str, payload: dict | list) -> None:
    path = os.path.join(STATE_DIR, filename)
    tmp  = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, path)
        logger.info("Écrit : %s", path)
    except Exception as e:
        logger.error("Impossible d'écrire %s : %s", path, e)


async def sync_once(session: aiohttp.ClientSession) -> None:
    """Effectue une synchronisation complète des classements."""
    logger.info("Début synchronisation classements (saison %s)…", SEASON)

    drivers = await fetch_drivers_standings(session)
    teams   = await fetch_teams_standings(session)
    last_race = await fetch_last_race_results(session)

    if drivers:
        write_state("f1_state_DriversStandings.json", {
            "standings": drivers,
            "updated_at": time.time(),
            "season": SEASON,
        })
    if teams:
        write_state("f1_state_TeamsStandings.json", {
            "standings": teams,
            "updated_at": time.time(),
            "season": SEASON,
        })
    if last_race:
        write_state("f1_state_LastRaceResult.json", last_race)

    logger.info(
        "Synchronisation terminée — %d pilotes, %d équipes",
        len(drivers), len(teams)
    )


async def run() -> None:
    logger.info("standings_sync démarré — intervalle %dh", SYNC_INTERVAL_SECS // 3600)
    async with aiohttp.ClientSession(
        headers={"User-Agent": "f1-telemetry-dashboard/2.0 (standings-sync)"}
    ) as session:
        while True:
            try:
                await sync_once(session)
            except Exception as e:
                logger.error("Erreur sync_once : %s", e)
            await asyncio.sleep(SYNC_INTERVAL_SECS)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    asyncio.run(run())
