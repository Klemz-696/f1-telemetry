/**
 * timing_tower.js  v4 — Refonte Live Timing Tower
 *
 * NOUVEAUTÉS v4 :
 *  - Deux modes d'affichage :
 *      1. "expanded" (Aéré / Étendu) : vue spacieuse, lisibilité maximale,
 *         intervalles détaillés, noms complets, secteurs aérés, badges statut (PIT, DRS, RET).
 *      2. "compact" : vue ultra-compacte originale pour petits écrans / multi-fenêtrage.
 *  - Bouton de bascule rapide direct dans le bandeau du panneau (📐 Aéré / Compact)
 *  - Synchronisation bidirectionnelle avec le store.js et la page des paramètres
 *  - Affichage simultané de l'écart au leader ET de l'intervalle avec la voiture précédente
 *  - Badges secteurs colorés (violet = meilleur tour/secteur absolu, vert = record perso, jaune = secteur standard)
 */

import { onUpdate, store, updateStore, savePrefs } from "../store.js";
import { computePitExitPosition } from "./pit_strategy.js";
import { evaluateTyreHealth, generateTyreGaugeHtml } from "./tyre_model.js";
import { openDriverDetail } from "./standings.js";

const container = document.getElementById("tower-rows");
const rowCache  = new Map();

// ─── Positions de départ (grille) ────────────────────────────────────────────
const _startPositions = new Map();
let   _lastSessionType = null;
let   _isRaceMode      = false;

function getCompoundInitial(c) { return (c || "?")[0]; }

// ─── Gestion mode Course & POS± ───────────────────────────────────────────────

function _updateRaceMode(sessionType) {
  const isRace = sessionType === "Race" || sessionType === "Sprint";
  if (isRace !== _isRaceMode) {
    _isRaceMode = isRace;
    const header = document.getElementById("col-pos-delta-header");
    if (header) header.classList.toggle("hidden", !isRace);
    for (const row of rowCache.values()) {
      const deltaCell = row.querySelector(".col-pos-delta");
      if (deltaCell) deltaCell.classList.toggle("hidden", !isRace);
    }
  }
}

function _recordStartPositions(standings) {
  if (_startPositions.size > 0) return;
  for (const d of standings) {
    if (d.position) _startPositions.set(d.driver_number, d.position);
  }
}

function _computeDelta(driverNumber, currentPos) {
  const startPos = _startPositions.get(driverNumber);
  if (!startPos || !currentPos) return null;
  return startPos - currentPos;
}

// ─── Création d'une ligne ─────────────────────────────────────────────────────

function createRow(driver) {
  const row = document.createElement("div");
  row.className   = "tower-row";
  row.dataset.drv = driver.driver_number;

  // 1. Driver block
  const driverBlock = document.createElement("div");
  driverBlock.className = "driver-block";

  const posWrap = document.createElement("div");
  posWrap.className = "pos-delta-wrapper";
  const posEl  = document.createElement("span");
  posEl.className = "pos-badge";
  const deltaCell = document.createElement("span");
  deltaCell.className = "col-pos-delta" + (_isRaceMode ? "" : " hidden");
  posWrap.append(posEl, deltaCell);

  const idWrap = document.createElement("div");
  idWrap.className = "driver-id-wrap";
  const mainId = document.createElement("div");
  mainId.className = "driver-main-id";
  const acroEl = document.createElement("span");
  acroEl.className = "driver-acro";
  const numEl  = document.createElement("span");
  numEl.className = "driver-num";
  mainId.append(acroEl, numEl);

  const nameSub = document.createElement("span");
  nameSub.className = "driver-name-sub";
  idWrap.append(mainId, nameSub);

  driverBlock.append(posWrap, idWrap);
  row.appendChild(driverBlock);

  // 2. Gaps (Leader + Interval)
  const gapWrap = document.createElement("div");
  gapWrap.className = "gap-wrap";
  const gapLeader = document.createElement("span");
  gapLeader.className = "gap gap-leader";
  const gapInterval = document.createElement("span");
  gapInterval.className = "gap-interval";
  gapWrap.append(gapLeader, gapInterval);
  row.appendChild(gapWrap);

  // 3. Secteurs S1, S2, S3
  const sectorsWrap = document.createElement("div");
  sectorsWrap.className = "sectors-wrap";
  for (let i = 0; i < 3; i++) {
    const s = document.createElement("span");
    s.className = `sector s${i+1}`;
    sectorsWrap.appendChild(s);
  }
  row.appendChild(sectorsWrap);

  // 4. Temps au tour
  const lapWrap = document.createElement("div");
  lapWrap.className = "lap-wrap";
  const lap = document.createElement("span");
  lap.className = "lap-time";
  const bestBadge = document.createElement("span");
  bestBadge.className = "best-lap-badge hidden";
  bestBadge.textContent = "⚡ MEILLEUR";
  lapWrap.append(lap, bestBadge);
  row.appendChild(lapWrap);

  // 5. Pneus (Jauge annulaire Pirelli)
  const tyre = document.createElement("div");
  tyre.className = "tyre-pill";
  tyre.style.cursor = "pointer";
  tyre.title = "Cliquer pour voir l'analyse d'usure des gommes";
  tyre.addEventListener("click", (e) => {
    e.stopPropagation();
    openDriverDetail({
      driver_number: driver.driver_number,
      acronym: driver.acronym,
      name: driver.driver_name || driver.name || driver.acronym,
      team: driver.team,
      position: driver.position,
      points: 0,
      compound: driver.compound,
      tyre_age: driver.tyre_age
    });
  });
  row.appendChild(tyre);

  // 6. Statut & Alertes (PIT, DRS, RET)
  const statusCell = document.createElement("div");
  statusCell.className = "tower-status-cell";
  const pitBadge = document.createElement("span");
  pitBadge.className = "status-badge badge-pit hidden";
  pitBadge.textContent = "PIT";
  const drsBadge = document.createElement("span");
  drsBadge.className = "status-badge badge-drs hidden";
  drsBadge.textContent = "DRS";
  const retBadge = document.createElement("span");
  retBadge.className = "status-badge badge-ret hidden";
  retBadge.textContent = "OUT";
  statusCell.append(pitBadge, drsBadge, retBadge);
  row.appendChild(statusCell);

  // 7. Sortie Stand (Stratégie)
  const pitExitCell = document.createElement("div");
  pitExitCell.className = "pit-exit-cell hidden";
  row.appendChild(pitExitCell);

  // Clic sur une ligne → sélectionne comme monoplace cible Ghost Car sur la carte
  row.addEventListener("click", () => {
    updateStore({ pitGhostDriver: driver.driver_number });
    for (const r of rowCache.values()) {
      r.classList.toggle("is-pit-target", r.dataset.drv === String(driver.driver_number));
    }
  });

  container.appendChild(row);
  rowCache.set(driver.driver_number, row);
  return row;
}

// ─── Mise à jour d'une ligne ──────────────────────────────────────────────────

function updateRow(driver, intervalText = "") {
  let row = rowCache.get(driver.driver_number);
  if (!row) row = createRow(driver);

  row.classList.toggle("in-pit",  driver.in_pit);
  row.classList.toggle("retired", driver.retired);
  row.classList.toggle("pinned",  store.pinnedDrivers?.has(driver.driver_number));

  const color   = driver.team_color || "#888888";
  const isLight = document.documentElement.dataset.theme === "light";
  const isPale  = ["#DEE1E2","#dee1e2","#AAAAAD","#aaaaad"].includes(color);

  // 1. Driver block
  const db = row.querySelector(".driver-block");
  if (db) {
    db.style.borderLeftColor = color;
    db.style.background = `linear-gradient(90deg, ${color}22 0%, ${color}06 100%)`;
  }

  const posEl     = row.querySelector(".pos-badge");
  const acroEl    = row.querySelector(".driver-acro");
  const numEl     = row.querySelector(".driver-num");
  const nameSubEl = row.querySelector(".driver-name-sub");
  const deltaCell = row.querySelector(".col-pos-delta");

  if (posEl)     posEl.textContent  = driver.position || "—";
  if (acroEl)    acroEl.textContent = driver.acronym  || "---";
  if (numEl)     numEl.textContent  = driver.driver_number ? "#" + driver.driver_number : "";

  // Résolution nom complet depuis store
  if (nameSubEl) {
    const drvInfo = store.drivers?.[driver.driver_number] || store.drivers?.[driver.acronym];
    nameSubEl.textContent = drvInfo?.name || driver.team || "";
  }

  if (isLight && isPale) {
    if (posEl) posEl.style.color = "#111";
    if (acroEl) acroEl.style.color = "#111";
  } else {
    if (posEl) posEl.style.color = "";
    if (acroEl) acroEl.style.color = "";
  }

  // Delta positions
  if (deltaCell) {
    deltaCell.classList.toggle("hidden", !_isRaceMode);
    if (_isRaceMode) {
      const delta = _computeDelta(driver.driver_number, driver.position);
      if (delta === null || delta === 0) {
        deltaCell.textContent = "—";
        deltaCell.className = "col-pos-delta delta-same";
      } else if (delta > 0) {
        deltaCell.textContent = `▲${delta}`;
        deltaCell.className = "col-pos-delta delta-up";
      } else {
        deltaCell.textContent = `▼${Math.abs(delta)}`;
        deltaCell.className = "col-pos-delta delta-down";
      }
    }
  }

  // 2. Gaps
  const gapLeaderEl = row.querySelector(".gap-leader");
  const gapIntEl    = row.querySelector(".gap-interval");
  const rawGap = (driver.gap_to_leader || "").trim();

  if (gapLeaderEl) {
    if (driver.position === 1 || rawGap === "0.000" || rawGap === "LEADER") {
      gapLeaderEl.textContent = "LEADER";
      gapLeaderEl.className   = "gap gap-leader is-leader";
    } else {
      gapLeaderEl.textContent = rawGap ? (rawGap.startsWith("+") ? rawGap : `+${rawGap}`) : "—";
      gapLeaderEl.className   = "gap gap-leader";
    }
  }

  if (gapIntEl) {
    if (driver.position === 1) {
      gapIntEl.textContent = "1er";
    } else {
      gapIntEl.textContent = intervalText ? `int: ${intervalText}` : "";
    }
  }

  // 3. Secteurs
  const sEls = row.querySelectorAll(".sectors-wrap .sector");
  const sVals = [driver.sector_1, driver.sector_2, driver.sector_3];
  const sPurp = [driver.sector_1_purple, driver.sector_2_purple, driver.sector_3_purple];
  const sGren = [driver.sector_1_green, driver.sector_2_green, driver.sector_3_green];

  sEls.forEach((el, i) => {
    let cls = "sector";
    if (sPurp[i] || (driver.best_lap && !sGren[i])) cls = "sector purple";
    else if (sGren[i]) cls = "sector green";
    el.className = `${cls} s${i+1}`;
    el.textContent = sVals[i] || "—";
  });

  // 4. Tour
  const lapEl     = row.querySelector(".lap-time");
  const bestBadge = row.querySelector(".best-lap-badge");
  if (lapEl) {
    lapEl.textContent = driver.last_lap_time || "—";
    lapEl.className   = driver.best_lap ? "lap-time purple" : "lap-time";
  }
  if (bestBadge) {
    bestBadge.classList.toggle("hidden", !driver.best_lap);
  }

  // 5. Pneus (Jauge annulaire prédictive Pirelli)
  const tyrePill = row.querySelector(".tyre-pill");
  if (tyrePill) {
    const evalResult = evaluateTyreHealth(
      driver,
      store.circuit_specs?.[store.session?.circuit_name],
      store.weather
    );
    tyrePill.innerHTML = generateTyreGaugeHtml(evalResult);
  }

  // 6. Statut
  const pitBadge = row.querySelector(".badge-pit");
  const drsBadge = row.querySelector(".badge-drs");
  const retBadge = row.querySelector(".badge-ret");
  if (pitBadge) pitBadge.classList.toggle("hidden", !driver.in_pit);
  if (drsBadge) drsBadge.classList.toggle("hidden", !driver.drs || driver.in_pit);
  if (retBadge) retBadge.classList.toggle("hidden", !driver.retired);

  // 7. Sortie Stand (Stratégie)
  const pitExitCell = row.querySelector(".pit-exit-cell");
  const isStrategy = store.pitStrategyMode === true;
  const lapWrap = row.querySelector(".lap-wrap");

  if (lapWrap) lapWrap.style.display = isStrategy ? "none" : "";

  if (pitExitCell) {
    pitExitCell.classList.toggle("hidden", !isStrategy);
    if (isStrategy) {
      const pred = computePitExitPosition(driver, store.standings || [], store.session?.circuit_name, store.session?.track_status);
      if (pred) {
        const changeSign = pred.positionChange > 0 ? `▼${pred.positionChange}` : (pred.positionChange < 0 ? `▲${Math.abs(pred.positionChange)}` : `=`);
        const changeCls = pred.positionChange > 0 ? "pit-drop" : (pred.positionChange < 0 ? "pit-gain" : "pit-equal");
        const trafficHint = pred.carAhead
          ? `+${pred.gapAhead}s dev. ${pred.carAhead.acronym}`
          : (pred.carBehind ? `-${pred.gapBehind}s der. ${pred.carBehind.acronym}` : `P1 Net`);

        pitExitCell.innerHTML = `
          <div class="pit-pos-wrap">
            <span class="pit-pos-badge" style="background:${pred.trafficRiskColor}22; color:${pred.trafficRiskColor}; border:1px solid ${pred.trafficRiskColor}">P${pred.projectedPosition}</span>
            <span class="pit-change-badge ${changeCls}">${changeSign}</span>
          </div>
          <span class="pit-traffic-hint" style="color:${pred.trafficRiskColor}">${trafficHint}</span>
        `;
        row.title = pred.tooltipText;
      } else {
        pitExitCell.innerHTML = `<span class="pit-traffic-hint">—</span>`;
      }
    } else {
      row.title = "";
    }
  }

  const isGhostTarget = store.pitGhostDriver === driver.driver_number || (!store.pitGhostDriver && driver.position === 1 && isStrategy);
  row.classList.toggle("is-pit-target", isGhostTarget);
}

// ─── Calcul des intervalles ──────────────────────────────────────────────────

function parseGapSecs(gapStr) {
  if (!gapStr) return null;
  const clean = gapStr.replace("+", "").replace("s", "").trim();
  const val = parseFloat(clean);
  return isNaN(val) ? null : val;
}

function computeIntervals(standings) {
  const intervals = new Map();
  let prevGap = 0;

  standings.forEach((d, idx) => {
    if (idx === 0) {
      intervals.set(d.driver_number, "LEADER");
      prevGap = 0;
      return;
    }
    const curGap = parseGapSecs(d.gap_to_leader);
    if (curGap !== null) {
      const diff = Math.max(0, curGap - prevGap);
      intervals.set(d.driver_number, `+${diff.toFixed(3)}s`);
      prevGap = curGap;
    } else {
      intervals.set(d.driver_number, d.gap_to_leader || "");
    }
  });

  return intervals;
}

// ─── Mode Header & Toggle ────────────────────────────────────────────────────

function syncTowerHeader() {
  const isExpanded = (store.timingTowerMode || "expanded") === "expanded";
  const isStrategy = store.pitStrategyMode === true;
  const header = document.querySelector(".tower-header");
  const timingTower = document.getElementById("timing-tower");

  if (timingTower) {
    timingTower.classList.toggle("tower-expanded", isExpanded);
    timingTower.classList.toggle("tower-compact", !isExpanded);
    timingTower.classList.toggle("tower-strategy-mode", isStrategy);
  }

  if (header) {
    if (isExpanded) {
      header.innerHTML = `
        <span class="col-pos">POS</span>
        <span class="col-driver">PILOTE</span>
        <span class="col-gaps">ÉCARTS</span>
        <span class="col-s1">S1</span>
        <span class="col-s2">S2</span>
        <span class="col-s3">S3</span>
        ${isStrategy ? '<span class="col-pit-exit">SORTIE STAND (PROJETÉ)</span>' : '<span class="col-lap">DERNIER TOUR</span>'}
        <span class="col-tyre">PNEUS</span>
        <span class="col-status">STATUT</span>
      `;
    } else {
      header.innerHTML = `
        <span>PILOTE</span><span>ÉCART</span>
        <span>S1</span><span>S2</span><span>S3</span>
        ${isStrategy ? '<span class="col-pit-exit">SORTIE</span>' : '<span>TOUR</span>'}
        <span>PNEU</span>
        <span class="col-pos-delta hidden" id="col-pos-delta-header">POS±</span>
      `;
    }
  }

  const toggleBtn = document.getElementById("tower-mode-toggle");
  if (toggleBtn) {
    toggleBtn.textContent = isExpanded ? "📐 AÉRÉ" : "📊 COMPACT";
    toggleBtn.title = isExpanded ? "Basculer en mode Compact" : "Basculer en mode Aéré / Étendu";
  }

  const stratBtn = document.getElementById("tower-strategy-toggle");
  if (stratBtn) {
    stratBtn.classList.toggle("active", isStrategy);
  }
}

function initTowerModeToggle() {
  const handle = document.querySelector("#ov-timing .ov-drag-handle");
  if (!handle || document.getElementById("tower-mode-toggle")) return;

  // Bouton Stratégie Stands
  const stratBtn = document.createElement("button");
  stratBtn.id = "tower-strategy-toggle";
  stratBtn.className = "ov-btn-mode-toggle" + (store.pitStrategyMode ? " active" : "");
  stratBtn.textContent = "⏱️ STANDS";
  stratBtn.title = "Simulateur de sortie des stands (Pit Window)";
  stratBtn.addEventListener("click", () => {
    updateStore({ pitStrategyMode: !store.pitStrategyMode });
    stratBtn.classList.toggle("active", store.pitStrategyMode);
    syncTowerHeader();
    if (store.standings?.length) render(store);
  });

  const btn = document.createElement("button");
  btn.id = "tower-mode-toggle";
  btn.className = "ov-btn-mode-toggle";
  btn.textContent = (store.timingTowerMode || "expanded") === "expanded" ? "📐 AÉRÉ" : "📊 COMPACT";
  btn.title = "Basculer mode Aéré / Compact";

  btn.addEventListener("click", () => {
    const next = (store.timingTowerMode || "expanded") === "expanded" ? "compact" : "expanded";
    updateStore({ timingTowerMode: next });
    savePrefs();
    syncTowerHeader();
    if (store.standings?.length) render(store);
  });

  // Insérer avant les boutons de zoom A- A+
  const firstBtn = handle.querySelector("button");
  if (firstBtn) {
    handle.insertBefore(stratBtn, firstBtn);
    handle.insertBefore(btn, firstBtn);
  } else {
    handle.appendChild(stratBtn);
    handle.appendChild(btn);
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(state) {
  if (!state.standings?.length) return;

  const sessionType = state.session?.session_type || "";

  if (sessionType !== _lastSessionType) {
    if (_lastSessionType !== null && sessionType === "Race") {
      _startPositions.clear();
    }
    _lastSessionType = sessionType;
    _updateRaceMode(sessionType);
  }

  if (_isRaceMode && _startPositions.size === 0) {
    _recordStartPositions(state.standings);
  }

  // Nettoyage lignes obsolètes
  const activeNumbers = new Set(state.standings.map(d => String(d.driver_number)));
  Array.from(container.children).forEach(row => {
    const drvNum = row.dataset.drv;
    if (drvNum && !activeNumbers.has(drvNum)) {
      container.removeChild(row);
      rowCache.delete(parseInt(drvNum));
    }
  });

  // Calcul des intervalles relatifs
  const intervals = computeIntervals(state.standings);

  for (const driver of state.standings) {
    updateRow(driver, intervals.get(driver.driver_number) || "");
  }

  state.standings.forEach((driver, idx) => {
    const row = rowCache.get(driver.driver_number);
    if (row) container.insertBefore(row, container.children[idx] || null);
  });
}

export function initTimingTower() {
  const timingEl = document.getElementById("timing-tower");
  if (timingEl) {
    timingEl.style.opacity = "0";
    timingEl.style.transition = "opacity .3s ease";
  }

  initTowerModeToggle();
  syncTowerHeader();

  onUpdate(state => {
    if (state.timingTowerMode) {
      syncTowerHeader();
    }
    if (state.standings?.length && timingEl?.style.opacity === "0") {
      requestAnimationFrame(() => { if (timingEl) timingEl.style.opacity = ""; });
    }
    render(state);
  });
}
