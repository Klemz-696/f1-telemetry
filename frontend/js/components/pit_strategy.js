/**
 * pit_strategy.js
 * Moteur prédictif de calcul de la fenêtre d'arrêt aux stands ("Pit Window Simulator").
 * Calcule instantanément le rang virtuel de réinsertion en piste, l'écart net avec les voitures
 * adjacentes, et le risque de trafic/train DRS pour chaque pilote en course.
 */

import { store, updateStore, onUpdate } from "../store.js";

// Pertes moyennes par défaut si non spécifiées dans le circuit
const DEFAULT_PIT_LOSS_SEC = 22.5;

/**
 * Analyse et convertit les chaînes d'écart au leader en secondes flottantes.
 * Exemples gérés : "LEADER", "0.000", "+14.285", "14.285s", "+1 LAP", "+2 LAPS"
 */
export function parseGapToLeader(gapStr) {
  if (!gapStr) return null;
  const s = String(gapStr).trim().toUpperCase();
  if (s === "LEADER" || s === "0.000" || s === "0" || s === "0.0") return 0.0;
  if (s.includes("LAP")) {
    // Si à un tour, estimer un tour standard F1 à 90.0s par tour de retard
    const laps = parseInt(s.replace(/[^0-9]/g, ""), 10) || 1;
    return 90.0 * laps;
  }
  const clean = s.replace("+", "").replace("S", "").trim();
  const val = parseFloat(clean);
  return isNaN(val) ? null : val;
}

/**
 * Récupère le temps de perte au stand calibré pour le circuit actif et le statut de la piste.
 */
export function getCircuitPitLoss(circuitName = "", trackStatus = "1", customStationary = null) {
  let baseLoss = DEFAULT_PIT_LOSS_SEC;

  // Recherche dans les spécifications circuits stockées
  const specs = store.circuit_specs || store.circuits || {};
  const cLower = (circuitName || store.session?.circuit_name || "").toLowerCase();

  for (const [key, spec] of Object.entries(specs)) {
    if (cLower.includes(key) || key.includes(cLower)) {
      if (spec && spec.pit_loss_seconds) {
        baseLoss = spec.pit_loss_seconds;
        break;
      }
    }
  }

  // Ajustement si temps d'immobilisation personnalisé (base standard = 2.4s)
  if (customStationary !== null && !isNaN(customStationary)) {
    baseLoss = Math.max(10.0, baseLoss - 2.4 + customStationary);
  }

  // Ajustement selon neutralisation de course
  // SC (4) : réduction d'environ 55% de la perte nette par rapport à pleine vitesse
  // VSC (6) : réduction d'environ 35% de la perte nette
  // RED FLAG (5) : arrêt gratuit sur la grille
  if (trackStatus === "4") {
    return Math.round(baseLoss * 0.45 * 10) / 10;
  } else if (trackStatus === "6") {
    return Math.round(baseLoss * 0.65 * 10) / 10;
  } else if (trackStatus === "5") {
    return 0.0;
  }

  return Math.round(baseLoss * 10) / 10;
}

/**
 * Calcule la projection d'arrêt au stand pour un pilote donné dans le classement actuel.
 */
export function computePitExitPosition(driver, allStandings, circuitName = "", trackStatus = "1") {
  if (!driver || driver.retired) return null;

  const currentGap = parseGapToLeader(driver.gap_to_leader);
  if (currentGap === null) return null;

  const loss = getCircuitPitLoss(circuitName, trackStatus, store.pitCustomStopDuration);
  const projectedGap = currentGap + loss;

  // Filtrer les autres pilotes en piste
  const activeDrivers = allStandings
    .filter(d => !d.retired && d.driver_number !== driver.driver_number)
    .map(d => ({
      ...d,
      gapNum: parseGapToLeader(d.gap_to_leader),
    }))
    .filter(d => d.gapNum !== null)
    .sort((a, b) => a.gapNum - b.gapNum);

  let projectedPos = 1;
  let carAhead = null;
  let carBehind = null;

  for (const other of activeDrivers) {
    if (projectedGap > other.gapNum) {
      projectedPos++;
      carAhead = other;
    } else {
      if (!carBehind) carBehind = other;
    }
  }

  // Calcul des deltas avec les monoplaces immédiatement devant et derrière
  const gapAhead = carAhead ? Math.max(0, projectedGap - carAhead.gapNum) : 999.0;
  const gapBehind = carBehind ? Math.max(0, carBehind.gapNum - projectedGap) : 999.0;

  // Évaluation du niveau de risque de trafic
  let trafficRisk = "CLEAR";
  let trafficRiskLabel = "Piste dégagée";
  let trafficRiskColor = "#00e676"; // Vert éclatant

  if (gapAhead < 1.0) {
    trafficRisk = "TRAFFIC_DRS";
    trafficRiskLabel = "Coincé (Train DRS)";
    trafficRiskColor = "#ff1744"; // Rouge vif
  } else if (gapAhead < 2.5) {
    trafficRisk = "CLOSE";
    trafficRiskLabel = "Trafic proche";
    trafficRiskColor = "#ffb300"; // Orange vif
  }

  const currentPos = driver.position || 1;
  const posChange = projectedPos - currentPos; // positif = recul dans le classement

  // Construction du libellé de l'infobulle stratégique
  let tooltip = `Ressortirait P${projectedPos} (+${loss.toFixed(1)}s de perte au stand).`;
  if (carAhead) {
    tooltip += ` Devant lui : ${carAhead.acronym} (+${gapAhead.toFixed(1)}s).`;
  } else {
    tooltip += ` Ressortirait en tête (P1).`;
  }
  if (carBehind) {
    tooltip += ` Derrière lui : ${carBehind.acronym} (-${gapBehind.toFixed(1)}s).`;
  }

  return {
    driver_number: driver.driver_number,
    acronym: driver.acronym,
    currentPosition: currentPos,
    projectedPosition: projectedPos,
    positionChange: posChange,
    currentGap: currentGap,
    projectedGap: Math.round(projectedGap * 1000) / 1000,
    lossApplied: loss,
    gapAhead: Math.round(gapAhead * 10) / 10,
    gapBehind: Math.round(gapBehind * 10) / 10,
    carAhead: carAhead ? { acronym: carAhead.acronym, gap: Math.round(gapAhead * 10) / 10, team_color: carAhead.team_color } : null,
    carBehind: carBehind ? { acronym: carBehind.acronym, gap: Math.round(gapBehind * 10) / 10, team_color: carBehind.team_color } : null,
    trafficRisk,
    trafficRiskLabel,
    trafficRiskColor,
    tooltipText: tooltip,
  };
}

/**
 * Calcule en masse les projections d'arrêt pour l'ensemble des pilotes du classement.
 * Retourne une Map<driver_number, PitPrediction>.
 */
export function computeAllPitPredictions(standings = [], circuitName = "", trackStatus = "1") {
  const map = new Map();
  if (!standings || !standings.length) return map;

  const validCircuit = circuitName || store.session?.circuit_name || "Albert Park";
  const validStatus = trackStatus || store.session?.track_status || "1";

  for (const driver of standings) {
    const pred = computePitExitPosition(driver, standings, validCircuit, validStatus);
    if (pred) {
      map.set(driver.driver_number, pred);
    }
  }

  return map;
}

/**
 * Active ou désactive le mode affichage Stratégie Stands dans le store
 */
export function togglePitStrategyMode() {
  const next = !store.pitStrategyMode;
  updateStore({ pitStrategyMode: next });
  return next;
}

/**
 * Définit le pilote cible pour la projection Ghost Car sur la carte
 */
export function setPitGhostDriver(driverNumber) {
  updateStore({ pitGhostDriver: driverNumber });
}
