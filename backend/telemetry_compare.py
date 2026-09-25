"""
telemetry_compare.py
Moteur de calcul et de normalisation métrique pour la télémétrie comparative Head-to-Head.
Discrétise le circuit sur une abscisse métrique régulière et calcule le delta de temps cumulé.
"""

import math
import time
from typing import Optional

try:
    from backend.models import TelemetryTrace, TelemetryCompareResponse
    from backend.data.f1_2026 import DRIVERS_2026, CIRCUIT_SPECS, CALENDAR_2026
except ImportError:
    from models import TelemetryTrace, TelemetryCompareResponse
    from data.f1_2026 import DRIVERS_2026, CIRCUIT_SPECS, CALENDAR_2026


def _find_driver_meta(driver_number: int) -> dict:
    """Retrouve les métadonnées d'un pilote selon son numéro permanent."""
    for d in DRIVERS_2026:
        if d.get("number") == driver_number:
            return d
    # Fallback générique
    return {
        "number": driver_number,
        "acronym": f"D{driver_number}",
        "name": f"Pilote #{driver_number}",
        "team": "F1 Team",
        "color": "#e10600",
    }


def _get_circuit_profile(circuit_name: str) -> tuple[float, list[dict]]:
    """
    Retourne la longueur métrique du circuit et les caractéristiques de virages/lignes droites.
    """
    # Recherche dans CIRCUIT_SPECS
    matched_spec = None
    for key, spec in CIRCUIT_SPECS.items():
        if key.lower() in circuit_name.lower() or circuit_name.lower() in key.lower():
            matched_spec = spec
            break

    length_m = 5278.0  # Défaut Albert Park Melbourne
    if matched_spec and matched_spec.get("length_km"):
        length_m = float(matched_spec["length_km"]) * 1000.0

    # Segments types de circuit F1 (pourcentage départ, pourcentage fin, type 'straight' ou 'corner', vitesse min)
    # Modélisation représentative d'un tracé de Grand Prix F1 (14 à 16 zones typiques)
    segments = [
        {"start": 0.00, "end": 0.12, "type": "straight", "v_max": 325, "gear": 8, "drs": 1},
        {"start": 0.12, "end": 0.17, "type": "corner",   "v_min": 135, "gear": 4, "drs": 0}, # T1-T2 chicane
        {"start": 0.17, "end": 0.25, "type": "straight", "v_max": 305, "gear": 7, "drs": 1},
        {"start": 0.25, "end": 0.30, "type": "corner",   "v_min": 95,  "gear": 3, "drs": 0}, # Épingle lente
        {"start": 0.30, "end": 0.42, "type": "straight", "v_max": 315, "gear": 8, "drs": 0},
        {"start": 0.42, "end": 0.50, "type": "corner",   "v_min": 195, "gear": 5, "drs": 0}, # Enchaînement rapide
        {"start": 0.50, "end": 0.65, "type": "straight", "v_max": 335, "gear": 8, "drs": 1}, # Ligne droite principale
        {"start": 0.65, "end": 0.72, "type": "corner",   "v_min": 110, "gear": 3, "drs": 0}, # Gros freinage
        {"start": 0.72, "end": 0.82, "type": "straight", "v_max": 290, "gear": 7, "drs": 0},
        {"start": 0.82, "end": 0.90, "type": "corner",   "v_min": 140, "gear": 4, "drs": 0}, # Virage technique
        {"start": 0.90, "end": 1.00, "type": "straight", "v_max": 310, "gear": 8, "drs": 1}, # Pleine charge arrivée
    ]

    return length_m, segments


def generate_synthesized_comparison(
    session_key: int,
    driver_a_num: int,
    driver_b_num: int,
    circuit_name: str = "Albert Park Circuit",
    step_m: float = 6.0,
) -> TelemetryCompareResponse:
    """
    Génère des courbes télémétriques comparatives haute fidélité (60 FPS)
    discrétisées sur la distance métrique du circuit.
    """
    meta_a = _find_driver_meta(driver_a_num)
    meta_b = _find_driver_meta(driver_b_num)
    circuit_length_m, segments = _get_circuit_profile(circuit_name)

    sample_count = int(circuit_length_m / step_m) + 1
    distances = [round(i * step_m, 1) for i in range(sample_count)]

    # Facteurs de pilotage spécifiques pour différencier les deux monoplaces de façon réaliste
    # Pilote A (ex: style agression / freinage tardif)
    # Pilote B (ex: style coulé / motricité sortie de virage)
    seed_a = (driver_a_num * 17) % 100 / 100.0
    seed_b = (driver_b_num * 23) % 100 / 100.0

    a_brake_bias = 0.97 + (seed_a * 0.06)      # Légère différence de point de freinage
    b_brake_bias = 0.97 + (seed_b * 0.06)
    a_top_speed_bias = 0.98 + (seed_a * 0.04)  # Différence de traînée aéro
    b_top_speed_bias = 0.98 + (seed_b * 0.04)

    speed_a = []
    throttle_a = []
    brake_a = []
    gear_a = []
    drs_a = []
    rpm_a = []

    speed_b = []
    throttle_b = []
    brake_b = []
    gear_b = []
    drs_b = []
    rpm_b = []

    for d in distances:
        ratio = d / circuit_length_m
        # Trouver le segment correspondant
        seg = segments[-1]
        for s in segments:
            if s["start"] <= ratio <= s["end"]:
                seg = s
                break

        seg_progress = (ratio - seg["start"]) / max(0.001, (seg["end"] - seg["start"]))

        if seg["type"] == "straight":
            # Phase d'accélération progressive jusqu'à la V-Max
            curve = math.sin(seg_progress * (math.pi / 2))
            va = (200 + (seg["v_max"] - 200) * curve) * a_top_speed_bias
            vb = (198 + (seg["v_max"] - 198) * curve) * b_top_speed_bias

            ta = min(100.0, 70.0 + 30.0 * curve)
            tb = min(100.0, 72.0 + 28.0 * curve)

            ba = 0.0
            bb = 0.0

            ga = seg["gear"]
            gb = seg["gear"]

            drsa = seg["drs"] if seg_progress > 0.2 else 0
            drsb = seg["drs"] if seg_progress > 0.2 else 0

        else:
            # Phase de virage : freinage en entrée, point de corde, puis réaccélération
            if seg_progress < 0.35:
                # Décélération / gros freinage
                brake_intensity = math.sin((seg_progress / 0.35) * math.pi)
                va = seg["v_min"] + (260 - seg["v_min"]) * (1.0 - (seg_progress / 0.35)) * a_brake_bias
                vb = seg["v_min"] + (260 - seg["v_min"]) * (1.0 - (seg_progress / 0.35)) * b_brake_bias
                ta = 0.0
                tb = 0.0
                ba = round(brake_intensity * 100.0, 1)
                bb = round(brake_intensity * 95.0, 1)
                ga = max(2, seg["gear"] - 1)
                gb = max(2, seg["gear"] - 1)
            elif seg_progress < 0.65:
                # Point de corde (apex) : vitesse minimale, stabilisation
                va = seg["v_min"] + 5.0 * math.sin(seg_progress * math.pi)
                vb = seg["v_min"] - 2.0 + 6.0 * math.sin(seg_progress * math.pi)
                ta = 15.0 + 10.0 * (seg_progress - 0.35) / 0.3
                tb = 18.0 + 12.0 * (seg_progress - 0.35) / 0.3
                ba = 0.0
                bb = 0.0
                ga = seg["gear"]
                gb = seg["gear"]
            else:
                # Réaccélération en sortie
                out_prog = (seg_progress - 0.65) / 0.35
                va = seg["v_min"] + 80.0 * (out_prog ** 1.3)
                vb = seg["v_min"] + 85.0 * (out_prog ** 1.2) # B ressort un poil plus fort
                ta = min(100.0, 30.0 + 70.0 * out_prog)
                tb = min(100.0, 35.0 + 65.0 * out_prog)
                ba = 0.0
                bb = 0.0
                ga = seg["gear"]
                gb = seg["gear"]

            drsa = 0
            drsb = 0

        # Ajout d'une légère gigue naturelle haute fréquence
        va += math.sin(d * 0.08) * 0.8
        vb += math.cos(d * 0.08) * 0.8

        va = round(max(60.0, min(355.0, va)), 1)
        vb = round(max(60.0, min(355.0, vb)), 1)

        rpma = int(10500 + (va / 350.0) * 2300)
        rpmb = int(10450 + (vb / 350.0) * 2350)

        speed_a.append(va)
        speed_b.append(vb)
        throttle_a.append(round(ta, 1))
        throttle_b.append(round(tb, 1))
        brake_a.append(ba)
        brake_b.append(bb)
        gear_a.append(ga)
        gear_b.append(gb)
        drs_a.append(drsa)
        drs_b.append(drsb)
        rpm_a.append(rpma)
        rpm_b.append(rpmb)

    # Calcul du Delta de temps cumulé mètre par mètre :
    # delta_t = sum( (step_m / (va/3.6)) - (step_m / (vb/3.6)) )
    delta_time = []
    cumul_delta = 0.0
    for va, vb in zip(speed_a, speed_b):
        time_a = step_m / (max(10.0, va) / 3.6)
        time_b = step_m / (max(10.0, vb) / 3.6)
        # Négatif si Pilote A prend de l'avance, positif si Pilote B comble l'écart
        cumul_delta += (time_a - time_b)
        delta_time.append(round(cumul_delta, 3))

    total_diff = round(cumul_delta, 3)

    trace_a = TelemetryTrace(
        driver_number=driver_a_num,
        acronym=meta_a.get("acronym", f"D{driver_a_num}"),
        team=meta_a.get("team", "Unknown"),
        team_color=meta_a.get("color", "#3671c6"),
        lap_number=18,
        lap_time_str="1:19.428",
        speed=speed_a,
        throttle=throttle_a,
        brake=brake_a,
        gear=gear_a,
        drs=drs_a,
        rpm=rpm_a,
    )

    trace_b = TelemetryTrace(
        driver_number=driver_b_num,
        acronym=meta_b.get("acronym", f"D{driver_b_num}"),
        team=meta_b.get("team", "Unknown"),
        team_color=meta_b.get("color", "#e8002d"),
        lap_number=18,
        lap_time_str="1:19.684",
        speed=speed_b,
        throttle=throttle_b,
        brake=brake_b,
        gear=gear_b,
        drs=drs_b,
        rpm=rpm_b,
    )

    return TelemetryCompareResponse(
        session_key=session_key,
        circuit_name=circuit_name,
        circuit_length_m=circuit_length_m,
        sample_count=len(distances),
        distance=distances,
        driver_a=trace_a,
        driver_b=trace_b,
        delta_time=delta_time,
        time_diff_total=total_diff,
    )
