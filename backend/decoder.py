"""
decoder.py
Rétro-ingénierie des payloads F1 compressés (.z).
Pipeline : correction padding Base64 → décompression Zlib/Raw Deflate → JSON.
"""

import base64
import zlib
import json
import logging

logger = logging.getLogger(__name__)


def decode_f1_z_payload(payload_str: str) -> dict:
    """
    Décode un payload F1 compressé reçu sur les topics CarData.z et Position.z.

    Étape 1 : les chaînes Base64 transmises par F1 manquent souvent leur padding '='.
    Étape 2 : décompression Zlib avec détection automatique d'en-tête (MAX_WBITS | 32).
              En cas d'échec, repli sur Raw Deflate (-MAX_WBITS), format réel du flux F1.
    Étape 3 : décodage UTF-8 puis json.loads().
    """
    if not payload_str:
        return {}

    try:
        # Correction du padding Base64
        remainder = len(payload_str) % 4
        if remainder:
            payload_str += "=" * (4 - remainder)

        decoded_bytes = base64.b64decode(payload_str)

        # Tentative Zlib standard (avec en-tête)
        try:
            decompressed = zlib.decompress(decoded_bytes, zlib.MAX_WBITS | 32)
        except zlib.error:
            # Repli Raw Deflate sans en-tête (format réel observé sur le flux F1)
            decompressed = zlib.decompress(decoded_bytes, -zlib.MAX_WBITS)

        return json.loads(decompressed.decode("utf-8"))

    except (base64.binascii.Error, UnicodeDecodeError) as e:
        logger.warning("Erreur de décodage Base64/UTF-8 : %s", e)
        return {}
    except json.JSONDecodeError as e:
        logger.warning("JSON invalide après décompression : %s", e)
        return {}
    except Exception as e:
        logger.error("Échec fatal du pipeline de décodage .z : %s", e)
        return {}


def filter_position(entry: dict) -> bool:
    """
    Filtre anti-snapping géospatial.
    Rejette les paquets {X:0, Y:0} que la FIA émet périodiquement à vide.
    Ces paquets téléporteraient toutes les monoplaces à l'origine (0,0) du canvas.
    """
    return not (entry.get("X", 1) == 0 and entry.get("Y", 1) == 0)
