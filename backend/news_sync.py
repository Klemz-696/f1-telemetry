"""
news_sync.py
Module de scraping et synchronisation d'actualités F1 réelles francophones.
Sources : F1i AutoJournal, Box-Box F1, Motorsport.com France.
Dépôt atomique dans STATE_DIR/f1_state_News.json
"""

import asyncio
import hashlib
import html
import json
import logging
import os
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
from typing import Optional

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


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("news_sync")

STATE_DIR = os.environ.get("F1_STATE_DIR", "/shared")
os.makedirs(STATE_DIR, exist_ok=True)

SYNC_INTERVAL_SECONDS = 900  # 15 minutes

FEEDS = [
    {
        "url": "https://f1i.autojournal.fr/feed/",
        "source": "F1i AutoJournal",
        "default_category": "Grand Prix",
    },
    {
        "url": "https://f1-boxbox.com/feed/",
        "source": "Box-Box F1",
        "default_category": "Actualité",
    },
    {
        "url": "https://fr.motorsport.com/rss/f1/news/",
        "source": "Motorsport.com",
        "default_category": "Grand Prix",
    },
]


def clean_html(raw_html: str) -> str:
    """Nettoie le texte en retirant les balises HTML et en décodant les entités."""
    if not raw_html:
        return ""
    unescaped = html.unescape(raw_html)
    # Remplacer les balises par un espace
    cleaned = re.sub(r"<[^>]+>", " ", unescaped)
    # Nettoyer les espaces multiples
    return " ".join(cleaned.split()).strip()


def extract_image_url(item: ET.Element, desc_html: str = "") -> Optional[str]:
    """Extrait l'URL d'image depuis enclosure, media:content ou balise img dans la description."""
    # 1. Enclosure
    enclosure = item.find("enclosure")
    if enclosure is not None:
        url = enclosure.get("url")
        if url and ("image" in enclosure.get("type", "") or any(ext in url.lower() for ext in [".jpg", ".jpeg", ".png", ".webp"])):
            return url

    # 2. Namespaces media:content ou media:thumbnail
    for elem in item:
        tag_lower = elem.tag.lower()
        if "content" in tag_lower or "thumbnail" in tag_lower:
            url = elem.attrib.get("url")
            if url and any(ext in url.lower() for ext in [".jpg", ".jpeg", ".png", ".webp"]):
                return url

    # 3. Chercher une balise <img src="..."> dans la description HTML
    if desc_html:
        img_match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', desc_html, re.IGNORECASE)
        if img_match:
            img_url = img_match.group(1)
            if img_url.startswith("http"):
                return img_url

    return None


def detect_category(title: str, text: str) -> str:
    """Détecte la catégorie de l'article en fonction du contenu."""
    haystack = f"{title} {text}".lower()
    if any(k in haystack for k in ["transfert", "contrat", "recrue", "départ", "mercato", "baquet", "remplaçant"]):
        return "Transferts"
    if any(k in haystack for k in ["moteur", "règlement", "technique", "aéro", "aileron", "châssis", "mgu", "batterie"]):
        return "Technique"
    if any(k in haystack for k in ["ferrari", "mercedes", "red bull", "mclaren", "alpine", "aston martin", "williams", "haas", "audi", "cadillac"]):
        return "Écuries"
    if any(k in haystack for k in ["qualif", "course", "grand prix", "gp", "pole", "chrono", "victoire", "podium", "classement"]):
        return "Grand Prix"
    if any(k in haystack for k in ["interview", "déclare", "confie", "avoue", "estime", "affirme"]):
        return "Interviews"
    return "Actualité"


def _parse_xml_content(content: bytes, source: str) -> list[dict]:
    articles = []
    try:
        text = content.decode("utf-8", errors="replace")
        text = re.sub(r"&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)", "&amp;", text)
        root = ET.fromstring(text.encode("utf-8"))
    except Exception as e:
        logger.warning("Échec parsing XML pour %s : %s", source, e)
        return []

    items = root.findall(".//item")

    for item in items:
        raw_title = item.findtext("title") or ""
        title = clean_html(raw_title)
        if not title:
            continue

        link = (item.findtext("link") or "").strip()
        if not link:
            atom_link = item.find("{http://www.w3.org/2005/Atom}link")
            if atom_link is not None:
                link = atom_link.attrib.get("href", "").strip()

        raw_desc = item.findtext("description") or ""
        desc = clean_html(raw_desc)
        summary = desc[:220] + ("…" if len(desc) > 220 else "")

        image_url = extract_image_url(item, desc_html=raw_desc)
        pub_date = item.findtext("pubDate") or ""
        category = detect_category(title, desc)

        article_id = hashlib.md5((link or title).encode("utf-8")).hexdigest()[:12]

        articles.append({
            "id": article_id,
            "title": title,
            "summary": summary,
            "image_url": image_url,
            "link": link,
            "source": source,
            "published_at": pub_date,
            "category": category,
            "fetched_at": time.time(),
        })
    return articles


def _fetch_feed_urllib(feed_info: dict) -> list[dict]:
    url = feed_info["url"]
    source = feed_info["source"]
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "application/rss+xml, application/xml, text/xml, */*",
            }
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status != 200:
                return []
            content = resp.read()
            return _parse_xml_content(content, source)
    except Exception as e:
        logger.error("Erreur urllib pour le flux %s : %s", source, e)
        return []


async def fetch_feed_articles(session, feed_info: dict) -> list[dict]:
    """Télécharge et parse un flux RSS d'actualités F1."""
    if not HAS_AIOHTTP or session is None:
        return await asyncio.to_thread(_fetch_feed_urllib, feed_info)

    url = feed_info["url"]
    source = feed_info["source"]
    try:
        async with session.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "application/rss+xml, application/xml, text/xml, */*",
            },
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status != 200:
                logger.warning("Échec HTTP %d lors du fetch du flux %s", resp.status, url)
                return []

            content = await resp.read()
            articles = _parse_xml_content(content, source)
            logger.info("Flux %s traité avec succès : %d articles extraits", source, len(articles))
            return articles
    except Exception as e:
        logger.error("Erreur lors du traitement du flux %s (%s) : %s", source, url, e)
        return []


def deduplicate_articles(articles: list[dict]) -> list[dict]:
    """Dédoublonne les articles par titre similaire ou lien."""
    seen_hashes = set()
    seen_titles = []
    unique_articles = []

    for art in articles:
        link_hash = art["id"]
        if link_hash in seen_hashes:
            continue
        seen_hashes.add(link_hash)

        norm_title = re.sub(r"[^\w\s]", "", art["title"].lower()).strip()
        words = norm_title.split()[:6]
        prefix = " ".join(words)

        if prefix and prefix in seen_titles:
            continue
        if prefix:
            seen_titles.append(prefix)

        unique_articles.append(art)

    return unique_articles


async def write_news_state(articles: list[dict]) -> None:
    """Écrit le fichier d'état des actualités de manière atomique."""
    path = os.path.join(STATE_DIR, "f1_state_News.json")
    tmp = path + ".tmp"
    payload = {
        "updated_at": time.time(),
        "count": len(articles),
        "articles": articles,
    }
    
    def _write_sync():
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)

    if HAS_AIOFILES:
        try:
            async with aiofiles.open(tmp, "w", encoding="utf-8") as f:
                await f.write(json.dumps(payload, ensure_ascii=False, indent=2))
            os.replace(tmp, path)
        except Exception:
            await asyncio.to_thread(_write_sync)
    else:
        await asyncio.to_thread(_write_sync)

    logger.info("Fichier d'état %s mis à jour avec %d articles", path, len(articles))


async def sync_news() -> list[dict]:
    """Exécute une synchronisation complète des flux RSS d'actualités."""
    logger.info("Démarrage synchronisation actualités F1...")
    if HAS_AIOHTTP:
        async with aiohttp.ClientSession() as session:
            tasks = [fetch_feed_articles(session, feed) for feed in FEEDS]
            results = await asyncio.gather(*tasks, return_exceptions=True)
    else:
        tasks = [fetch_feed_articles(None, feed) for feed in FEEDS]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    all_articles = []
    for res in results:
        if isinstance(res, list):
            all_articles.extend(res)

    deduped = deduplicate_articles(all_articles)
    if deduped:
        await write_news_state(deduped)
    return deduped


async def run_loop() -> None:
    """Boucle infinie exécutée périodiquement (toutes les 15 minutes)."""
    while True:
        try:
            await sync_news()
        except Exception as e:
            logger.error("Erreur cycle sync_news : %s", e)
        await asyncio.sleep(SYNC_INTERVAL_SECONDS)


if __name__ == "__main__":
    asyncio.run(run_loop())

