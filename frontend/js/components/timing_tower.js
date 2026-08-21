/**
 * timing_tower.js  v3
 *
 * NOUVEAUTÉS v3 :
 *  - Colonne POS± : positions gagnées/perdues depuis la grille de départ
 *    → visible uniquement en session_type === "Race"
 *  - _startPositions : Map enregistrant la grille au 1er tick Race
 *  - Grid CSS tower-header / tower-row étendu d'une colonne
 */

import { onUpdate, store } from "../store.js";

const container = document.getElementById("tower-rows");
const rowCache  = new Map();

// ─── Positions de départ (grille) ────────────────────────────────────────────
const _startPositions = new Map();
let   _lastSessionType = null;
let   _isRaceMode      = false;

function getCompoundInitial(c) { return (c || "?")[0]; }

// ─── Gestion colonne POS± ─────────────────────────────────────────────────────

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

  const driverBlock = document.createElement("div");
  driverBlock.className = "driver-block";
  const posEl  = document.createElement("span");
  posEl.className = "pos-badge";
  const acroEl = document.createElement("span");
  acroEl.className = "driver-acro";
  const numEl  = document.createElement("span");
  numEl.className = "driver-num";
  driverBlock.append(posEl, acroEl, numEl);
  row.appendChild(driverBlock);

  const gap = document.createElement("span");
  gap.className = "gap";
  row.appendChild(gap);

  for (let i = 0; i < 3; i++) {
    const s = document.createElement("span");
    s.className = "sector";
    row.appendChild(s);
  }

  const lap = document.createElement("span");
  lap.className = "lap-time";
  row.appendChild(lap);

  const tyre = document.createElement("div");
  tyre.className = "tyre-pill";
  const dot  = document.createElement("div");
  dot.className = "tyre-dot";
  const age  = document.createElement("span");
  tyre.append(dot, age);
  row.appendChild(tyre);

  const deltaCell = document.createElement("span");
  deltaCell.className = "col-pos-delta" + (_isRaceMode ? "" : " hidden");
  row.appendChild(deltaCell);

  container.appendChild(row);
  rowCache.set(driver.driver_number, row);
  return row;
}

// ─── Mise à jour d'une ligne ──────────────────────────────────────────────────

function updateRow(driver) {
  let row = rowCache.get(driver.driver_number);
  if (!row) row = createRow(driver);

  row.classList.toggle("in-pit",  driver.in_pit);
  row.classList.toggle("retired", driver.retired);
  row.classList.toggle("pinned",  store.pinnedDrivers?.has(driver.driver_number));

  const cells   = row.children;
  const color   = driver.team_color || "#888888";
  const isLight = document.documentElement.dataset.theme === "light";
  const isPale  = ["#DEE1E2","#dee1e2","#AAAAAD","#aaaaad"].includes(color);

  const db = cells[0];
  db.style.borderLeftColor = color;
  db.style.background = `linear-gradient(90deg,${color}22 0%,${color}06 100%)`;

  const posEl  = db.querySelector(".pos-badge");
  const acroEl = db.querySelector(".driver-acro");
  const numEl  = db.querySelector(".driver-num");
  posEl.textContent  = driver.position || "—";
  acroEl.textContent = driver.acronym  || "---";
  if (numEl) numEl.textContent = driver.driver_number ? "#" + driver.driver_number : "";

  if (isLight && isPale) {
    posEl.style.color  = "#111";
    acroEl.style.color = "#111";
    if (numEl) numEl.style.color = "#555";
  } else {
    posEl.style.color  = "";
    acroEl.style.color = "";
    if (numEl) numEl.style.color = "";
  }

  cells[1].textContent = driver.gap_to_leader || "";

  const s1cls = driver.sector_1_purple ? "sector purple" : driver.sector_1_green  ? "sector green" : "sector";
  const s2cls = driver.sector_2_purple ? "sector purple" : driver.sector_2_green  ? "sector green" : "sector";
  const s3cls = driver.sector_3_purple ? "sector purple" : driver.sector_3_green  ? "sector green" : "sector";

  if (driver.best_lap && s1cls === "sector") {
    cells[2].className = "sector purple";
    cells[3].className = "sector purple";
    cells[4].className = "sector purple";
  } else {
    cells[2].className = s1cls;
    cells[3].className = s2cls;
    cells[4].className = s3cls;
  }
  cells[2].textContent = driver.sector_1 || "";
  cells[3].textContent = driver.sector_2 || "";
  cells[4].textContent = driver.sector_3 || "";

  cells[5].textContent = driver.last_lap_time || "";
  cells[5].className   = driver.best_lap ? "lap-time purple" : "lap-time";

  const tyreDot = cells[6].querySelector(".tyre-dot");
  const tyreAge = cells[6].querySelector("span");
  tyreDot.className   = `tyre-dot ${driver.compound || "UNKNOWN"}`;
  tyreDot.title       = driver.compound || "";
  tyreAge.textContent = driver.tyre_age > 0
    ? `${getCompoundInitial(driver.compound)}+${driver.tyre_age}`
    : getCompoundInitial(driver.compound);

  const deltaCell = cells[7];
  if (deltaCell) {
    deltaCell.classList.toggle("hidden", !_isRaceMode);
    if (_isRaceMode) {
      const delta = _computeDelta(driver.driver_number, driver.position);
      if (delta === null || delta === 0) {
        deltaCell.textContent = "—";
        deltaCell.className = "col-pos-delta";
      } else if (delta > 0) {
        deltaCell.textContent = `▲${delta}`;
        deltaCell.className = "col-pos-delta delta-up";
      } else {
        deltaCell.textContent = `▼${Math.abs(delta)}`;
        deltaCell.className = "col-pos-delta delta-down";
      }
    }
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

  // Retirer les lignes obsolètes du DOM
  const activeNumbers = new Set(state.standings.map(d => String(d.driver_number)));
  Array.from(container.children).forEach(row => {
    const drvNum = row.dataset.drv;
    if (drvNum && !activeNumbers.has(drvNum)) {
      container.removeChild(row);
      rowCache.delete(parseInt(drvNum));
    }
  });

  for (const driver of state.standings) updateRow(driver);

  state.standings.forEach((driver, idx) => {
    const row = rowCache.get(driver.driver_number);
    if (row) container.insertBefore(row, container.children[idx] || null);
  });
}

export function initTimingTower() {
  // Transition douce à l'apparition (évite le flash de lignes vides)
  const timingEl = document.getElementById("timing-tower");
  if (timingEl) {
    timingEl.style.opacity = "0";
    timingEl.style.transition = "opacity .3s ease";
  }
  onUpdate(state => {
    if (state.standings?.length && timingEl?.style.opacity === "0") {
      requestAnimationFrame(() => { if (timingEl) timingEl.style.opacity = ""; });
    }
    render(state);
  });
}
