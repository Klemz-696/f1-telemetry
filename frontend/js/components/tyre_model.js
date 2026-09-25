/**
 * tyre_model.js
 * Modélisation mathématique prédictive de l'usure des pneumatiques Pirelli F1 (2026).
 * Estime l'état de santé résiduel (%), la perte au tour (s/tour), et l'approche du Cliff
 * en combinant le composé de gomme, l'âge du train, la sévérité du circuit et la température de piste.
 */

import { store } from "../store.js";

// Longévité de base en tours selon le composé (conditions nominales)
export const COMPOUND_BASE_LAPS = {
  SOFT: 18,
  MEDIUM: 28,
  HARD: 42,
  INTERMEDIATE: 30,
  WET: 35,
};

// Facteurs de perte de rythme au tour par puissance d'âge : dPace = k * (n / 10)^1.2
const COMPOUND_K_FACTORS = {
  SOFT: 0.08,
  MEDIUM: 0.05,
  HARD: 0.03,
  INTERMEDIATE: 0.06,
  WET: 0.06,
};

// Couleurs officielles Pirelli
export const COMPOUND_COLORS = {
  SOFT: "#ff3344",        // Rouge Tendre
  MEDIUM: "#ffd700",      // Jaune Médium
  HARD: "#ffffff",        // Blanc Dur
  INTERMEDIATE: "#39b54a",// Vert Intermédiaire
  WET: "#0072ce",         // Bleu Pluie Maxi
  UNKNOWN: "#888888",
};

/**
 * Normalise le nom du composé de pneu vers sa clé canonique
 */
export function normalizeCompound(compoundRaw) {
  if (!compoundRaw) return "MEDIUM";
  const c = String(compoundRaw).trim().toUpperCase();
  if (c.startsWith("S") || c === "SOFT") return "SOFT";
  if (c.startsWith("M") || c === "MEDIUM") return "MEDIUM";
  if (c.startsWith("H") || c === "HARD") return "HARD";
  if (c.startsWith("I") || c === "INTER") return "INTERMEDIATE";
  if (c.startsWith("W") || c === "WET") return "WET";
  return "MEDIUM";
}

/**
 * Évalue l'usure, la perte de rythme et la proximité de la falaise (Cliff) pour un pilote.
 */
export function evaluateTyreHealth(driver, circuitSpec = null, weather = null) {
  const age = Math.max(0, parseInt(driver?.tyre_age || 0, 10));
  const compound = normalizeCompound(driver?.compound);
  const baseLaps = COMPOUND_BASE_LAPS[compound] || 28;

  // 1. Facteur de sévérité du circuit (beta)
  const spec = circuitSpec || store.circuit_specs?.[store.session?.circuit_name] || store.circuits?.[store.session?.circuit_name] || {};
  const stressRaw = spec.characteristics?.tire_stress || spec.characteristics?.tyre_stress || "Moyen";
  const stress = String(stressRaw).toLowerCase();

  let betaCircuit = 1.0;
  if (stress.includes("extr") || stress.includes("très élevé") || stress.includes("tres eleve")) {
    betaCircuit = 1.28;
  } else if (stress.includes("élevé") || stress.includes("eleve") || stress.includes("high")) {
    betaCircuit = 1.18;
  } else if (stress.includes("faible") || stress.includes("low")) {
    betaCircuit = 0.86;
  }

  // 2. Facteur de température de piste (gamma)
  const w = weather || store.weather || {};
  const trackTemp = w.track_temp ?? w.track_temperature ?? 35.0;
  // Dégradation thermique accélérée au-delà de 35°C
  const gammaTemp = 1.0 + Math.max(0, (trackTemp - 35.0) / 100.0);

  // 3. Durée de vie effective (L_opt)
  const effectiveLife = Math.max(8, baseLaps / (betaCircuit * gammaTemp));
  const ratio = Math.min(1.4, age / effectiveLife);

  // 4. Santé résiduelle en pourcentage (courbe non-linéaire alpha = 1.35)
  // H(n) = max(0, 100 * (1 - (n / L_opt)^1.35))
  let healthPercent = Math.max(0, Math.round(100 * (1 - Math.pow(Math.min(1.0, ratio), 1.35))));
  if (ratio > 1.0) {
    // Chute brutale au-delà de la longévité optimale (Falaise de performance)
    healthPercent = Math.max(0, Math.round(healthPercent * Math.max(0, 1.0 - (ratio - 1.0) * 2.5)));
  }

  // 5. Perte de performance au tour (Delta Pace en s/tour)
  const k = COMPOUND_K_FACTORS[compound] || 0.05;
  const paceLossSec = +(k * Math.pow(age / 10.0, 1.2)).toFixed(2);

  // 6. Détection du seuil de Cliff
  const cliffLapEstimated = Math.round(effectiveLife * 0.88);
  const lapsBeforeCliff = Math.max(0, cliffLapEstimated - age);
  const isCliffApproaching = healthPercent <= 25 || lapsBeforeCliff <= 2;

  // 7. Statut et codes couleur
  let status = "OPTIMAL";
  let statusLabel = "Adhérence optimale";
  let statusColor = "#00e676"; // Vert

  if (healthPercent < 20) {
    status = "CLIFF";
    statusLabel = "Falaise critique (Cliff)";
    statusColor = "#ff1744"; // Rouge vif
  } else if (healthPercent < 45) {
    status = "WARNING";
    statusLabel = "Usure avancée";
    statusColor = "#ff9800"; // Orange
  } else if (healthPercent < 70) {
    status = "DEGRADED";
    statusLabel = "Dégradation modérée";
    statusColor = "#ffd700"; // Jaune
  }

  return {
    compound,
    compoundColor: COMPOUND_COLORS[compound] || "#ffffff",
    age,
    healthPercent,
    paceLossSec,
    status,
    statusLabel,
    statusColor,
    isCliffApproaching,
    cliffLapEstimated,
    lapsBeforeCliff,
    effectiveLife: Math.round(effectiveLife),
  };
}

/**
 * Génère le balisage HTML / SVG pour la jauge annulaire circulaire de pneu
 */
export function generateTyreGaugeHtml(evalResult) {
  const { compound, compoundColor, age, healthPercent, statusColor, isCliffApproaching } = evalResult;
  const initial = (compound || "M")[0];
  const pulseClass = isCliffApproaching ? "tyre-cliff-pulse" : "";

  // Circonférence normalisée pour viewBox 36x36 : rayon r=15.9155 -> C = 100
  const dashArray = `${healthPercent}, 100`;

  const tooltip = `Pneu : ${compound} (${age} tours)\nSanté estimée : ${healthPercent}%\nPerte au tour : +${evalResult.paceLossSec}s/tour\nStatut : ${evalResult.statusLabel}`;

  return `
    <div class="tyre-pill-gauge ${pulseClass}" title="${tooltip}">
      <svg class="tyre-svg-ring" viewBox="0 0 36 36">
        <path class="tyre-ring-bg"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
        />
        <path class="tyre-ring-val"
          stroke="${statusColor}"
          stroke-dasharray="${dashArray}"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
        />
      </svg>
      <span class="tyre-letter" style="color:${compoundColor}">${initial}</span>
      <span class="tyre-age-num">${age > 0 ? `${age}T` : ""}</span>
    </div>
  `;
}
