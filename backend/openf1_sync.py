"""
openf1_sync.py
Synchronisation secondaire via l'API REST OpenF1.
"""

import asyncio
import logging
import os

import aiohttp

from data.f1_2026 import DRIVERS_2026
from influx_client import write_stint

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("openf1_sync")

BASE_URL = "https://api.openf1.org/v1"
SYNC_INTERVAL_SECS = 20


async def fetch_json(session: aiohttp.ClientSession, url: str, params: dict = None) -> list | dict:
    try:
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status == 429:
                logger.warning("Rate limit OpenF1 atteint (HTTP 429) — pause 60s")
                await asyncio.sleep(60)
                return []
            if resp.status != 200:
                logger.warning("OpenF1 %s → HTTP %d", url, resp.status)
                return []
            return await resp.json()
    except asyncio.TimeoutError:
        logger.warning("Timeout OpenF1 %s", url)
        return []
    except Exception as e:
        logger.error("Erreur OpenF1 %s : %s", url, e)
        return []


async def sync_stints(session: aiohttp.ClientSession) -> None:
    """Récupère les stints OpenF1 et les écrit dans Influx avec le vrai session_key (B5)."""
    stints = await fetch_json(session, f"{BASE_URL}/stints", {"session_key": "latest"})
    if not stints:
        return

    # session_key réel : les réponses OpenF1 portent ce champ ; on prend celui du
    # premier point sinon "latest". Évite le tag session_key="latest" systématique.
    session_key = None
    if isinstance(stints, list) and stints:
        first = stints[0]
        if isinstance(first, dict):
            session_key = first.get("session_key")

    for stint in stints:
        driver_num = stint.get("driver_number")
        if driver_num and driver_num in DRIVERS_2026:
            try:
                await write_stint(driver_num, stint, session_key=session_key)
            except Exception as e:
                logger.warning("Erreur écriture stint pilote %s : %s", driver_num, e)
    logger.debug("Stints synchronisés : %d relais traités", len(stints))


async def run() -> None:
    logger.info("Démarrage openf1_sync — intervalle %ds", SYNC_INTERVAL_SECS)

    # Laisser InfluxDB finir son init même si healthcheck ok
    await asyncio.sleep(5)

    async with aiohttp.ClientSession(
        headers={"User-Agent": "f1-telemetry-dashboard/1.0"}
    ) as session:
        retry_count = 0
        while True:
            try:
                await sync_stints(session)
                retry_count = 0
            except Exception as e:
                retry_count += 1
                wait = min(60, 5 * retry_count)
                logger.error("Erreur sync_stints (tentative %d) : %s — retry dans %ds", retry_count, e, wait)
                await asyncio.sleep(wait)
                continue
            await asyncio.sleep(SYNC_INTERVAL_SECS)


if __name__ == "__main__":
    asyncio.run(run())
