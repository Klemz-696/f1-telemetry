/**
 * standings.js v2
 * - Classement pilotes + équipes
 * - Classement provisoire course (visible uniquement en mode live Race)
 * - Throttle 8s pour le classement provisoire
 */

const TEAM_COLORS_MAP = {
  "Mercedes-AMG Petronas": "#27F4D2", "Scuderia Ferrari": "#E8002D",
  "McLaren Formula 1 Team": "#FF8000", "Red Bull Racing": "#3671C6",
  "Aston Martin Aramco": "#229971", "BWT Alpine F1 Team": "#00A1E8",
  "Haas F1 Team": "#DEE1E2", "Williams Racing": "#1868DB",
  "Visa Cash App RB": "#6692FF", "Visa Cash App RB Formula One Team": "#6692FF",
  "Mercedes": "#27F4D2", "Ferrari": "#E8002D", "McLaren": "#FF8000",
  "Red Bull": "#3671C6", "Aston Martin": "#229971", "Alpine": "#00A1E8",
  "Haas": "#DEE1E2", "Williams": "#1868DB", "Racing Bulls": "#6692FF",
  "RB": "#6692FF", "Audi": "#FF2D00", "Cadillac": "#AAAAAD",
  "Cadillac Racing": "#AAAAAD", "Alpine F1 Team": "#00A1E8",
  "RB F1 Team": "#6692FF", "Cadillac F1 Team": "#AAAAAD",
  "Kick Sauber": "#FF2D00", "Sauber": "#FF2D00", "Audi F1 Team": "#FF2D00",
  "MoneyGram Haas F1 Team": "#DEE1E2",
};

// Points F1 2026 (positions 1..10, 0 ensuite)
const F1_POINTS_2026 = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

function getPointsForPosition(pos) {
  return F1_POINTS_2026[pos - 1] ?? 0;
}

function resolveTeamColor(teamName) {
  if (!teamName) return "#888";
  if (TEAM_COLORS_MAP[teamName]) return TEAM_COLORS_MAP[teamName];
  const lower = teamName.toLowerCase();
  for (const [key, val] of Object.entries(TEAM_COLORS_MAP)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) return val;
  }
  return "#888";
}

import { onUpdate, store } from "../store.js";
import { evaluateTyreHealth, COMPOUND_COLORS } from "./tyre_model.js";
import { playMessage } from "./radio_player.js";

let panelDrivers = null;
let panelTeams   = null;
let tabBtns      = null;

// Throttle classement provisoire
let _provisionalTimeout = null;
let _lastProvisionalRender = 0;

function initTabs() {
  panelDrivers = document.getElementById("standings-drivers");
  panelTeams   = document.getElementById("standings-teams");
  tabBtns      = document.querySelectorAll(".tab-btn");
  if (!panelDrivers || !panelTeams) return;
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      panelDrivers.classList.toggle("active", tab === "drivers");
      panelTeams.classList.toggle("active",   tab === "teams");
    });
  });
}

function renderFreshnessBar(container, updatedAt) {
  let bar = container.querySelector(".standings-freshness");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "standings-freshness";
    container.prepend(bar);
  }
  if (updatedAt) {
    const d = new Date(updatedAt * 1000);
    bar.textContent = `Mis à jour le ${d.toLocaleDateString(navigator.language, {
      day: "numeric", month: "short", year: "numeric",
    })} à ${d.toLocaleTimeString(navigator.language, { hour: "2-digit", minute: "2-digit" })}`;
  } else {
    bar.textContent = "Données de référence (synchronisation en cours…)";
  }
}

function renderLastRace(container, lastRace) {
  if (!lastRace || !lastRace.results?.length || !container) return;
  let section = container.querySelector(".last-race-section");
  if (!section) {
    section = document.createElement("div");
    section.className = "last-race-section";
    container.appendChild(section);
  }
  const title = document.createElement("div");
  title.className = "last-race-title";
  title.textContent = `Dernier GP — ${lastRace.name || ""} (${lastRace.date || ""})`;
  const table = document.createElement("table");
  table.className = "standings-table last-race-table";
  table.innerHTML = `<thead><tr>
    <th class="std-pos">POS</th><th>PILOTE</th><th>ÉCURIE</th>
    <th class="std-pts">TEMPS / STATUT</th>
  </tr></thead>`;
  const tbody = document.createElement("tbody");
  for (const r of lastRace.results) {
    const tr = document.createElement("tr");
    if (r.position <= 3) tr.className = ["podium-gold","podium-silver","podium-bronze"][r.position - 1];
    const color = resolveTeamColor(r.team);
    tr.innerHTML = `
      <td class="std-pos">${r.position}</td>
      <td class="std-name">${r.acronym || r.name}</td>
      <td class="std-team"><span class="std-color-bar-inline" style="background:${color}"></span>${r.team}</td>
      <td class="std-pts" style="font-family:var(--font-mono);font-size:10px">${r.time || "—"}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.replaceChildren(title, table);
}

function renderDrivers(standings, teams) {
  if (!panelDrivers) return;
  const table = document.createElement("table");
  table.className = "standings-table";
  table.innerHTML = `<thead><tr>
    <th class="std-pos">POS</th><th></th><th></th>
    <th>PILOTE</th><th>ÉCURIE</th><th class="std-pts">PTS</th>
  </tr></thead>`;
  const tbody = document.createElement("tbody");
  for (const d of standings) {
    const color = resolveTeamColor(d.team);
    const driverInfo = Object.values(store.drivers || {}).find(x => x.acronym === d.acronym);
    const flag = d.flag || driverInfo?.flag || "";
    const tr = document.createElement("tr");
    if (d.position <= 3) tr.className = ["podium-gold","podium-silver","podium-bronze"][d.position - 1];
    tr.innerHTML = `
      <td class="std-pos">${d.position}</td>
      <td class="std-color"><span class="std-color-bar" style="background:${color}"></span></td>
      <td class="std-flag">${flag}</td>
      <td class="std-name">${d.name}</td>
      <td class="std-team">${d.team}</td>
      <td class="std-pts">${d.points}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const freshness       = panelDrivers.querySelector(".standings-freshness");
  const lastRaceSection = panelDrivers.querySelector(".last-race-section");
  const provisionalSect = panelDrivers.querySelector(".standings-provisional-section");
  panelDrivers.replaceChildren();
  if (freshness) panelDrivers.appendChild(freshness);
  panelDrivers.appendChild(table);
  if (lastRaceSection) panelDrivers.appendChild(lastRaceSection);
  if (provisionalSect) panelDrivers.appendChild(provisionalSect);
}

function renderTeams(standings) {
  if (!panelTeams) return;
  const table = document.createElement("table");
  table.className = "standings-table";
  table.innerHTML = `<thead><tr>
    <th class="std-pos">POS</th><th></th><th>ÉCURIE</th><th class="std-pts">PTS</th>
  </tr></thead>`;
  const tbody = document.createElement("tbody");
  for (const t of standings) {
    const color = resolveTeamColor(t.name);
    const tr = document.createElement("tr");
    if (t.position <= 3) tr.className = ["podium-gold","podium-silver","podium-bronze"][t.position - 1];
    tr.innerHTML = `
      <td class="std-pos">${t.position}</td>
      <td class="std-color"><span class="std-color-bar" style="background:${color}"></span></td>
      <td class="std-name">${t.name}</td>
      <td class="std-pts">${t.points}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const freshness = panelTeams.querySelector(".standings-freshness");
  panelTeams.replaceChildren();
  if (freshness) panelTeams.appendChild(freshness);
  panelTeams.appendChild(table);
}

// ─── Classement provisoire ────────────────────────────────────────────────────

function computeProvisional(driversStandings, liveStandings) {
  // Pour chaque pilote du championnat, chercher sa position actuelle dans la course live
  const result = driversStandings.map(d => {
    const liveEntry = liveStandings.find(l =>
      l.acronym === d.acronym ||
      l.driver_number === d.driver_number
    );
    const livePos   = liveEntry ? liveEntry.position : null;
    const racePoints = livePos ? getPointsForPosition(livePos) : 0;
    return {
      ...d,
      provisional_points: d.points + racePoints,
      _race_pos:           livePos,
      _race_pts:           racePoints,
    };
  });

  // Trier par points provisoires décroissants
  result.sort((a, b) => b.provisional_points - a.provisional_points);
  result.forEach((d, i) => { d.provisional_position = i + 1; });

  return result;
}

function renderProvisional(driversStandings, liveStandings) {
  if (!panelDrivers) return;

  const provisional = computeProvisional(driversStandings, liveStandings);

  let section = panelDrivers.querySelector(".standings-provisional-section");
  if (!section) {
    section = document.createElement("div");
    section.className = "standings-provisional-section";
    panelDrivers.appendChild(section);
  }

  // Dual-column layout
  const dual = document.createElement("div");
  dual.className = "standings-dual-layout";

  // ── Colonne gauche : classement actuel ──
  const leftCol = document.createElement("div");
  const leftTitle = document.createElement("div");
  leftTitle.className = "standings-dual-title";
  leftTitle.textContent = "🏆 Championnat actuel";
  const leftTable = document.createElement("table");
  leftTable.className = "standings-table";
  leftTable.innerHTML = `<thead><tr>
    <th class="std-pos">POS</th><th></th><th>PILOTE</th>
    <th class="std-pts">PTS</th><th class="std-pts" style="font-size:9px">COURSE</th>
  </tr></thead>`;
  const leftBody = document.createElement("tbody");
  for (const d of driversStandings) {
    const liveEntry = liveStandings.find(l => l.acronym === d.acronym || l.driver_number === d.driver_number);
    const livePos = liveEntry?.position;
    const color = resolveTeamColor(d.team);
    const tr = document.createElement("tr");
    if (d.position <= 3) tr.className = ["podium-gold","podium-silver","podium-bronze"][d.position - 1];
    const racePosStr = livePos ? `P${livePos}` : "—";
    tr.innerHTML = `
      <td class="std-pos">${d.position}</td>
      <td class="std-color"><span class="std-color-bar" style="background:${color}"></span></td>
      <td class="std-name">${d.name}</td>
      <td class="std-pts">${d.points}</td>
      <td class="std-pts" style="color:var(--text-dim);font-size:9px">${racePosStr}</td>
    `;
    leftBody.appendChild(tr);
  }
  leftTable.appendChild(leftBody);
  leftCol.append(leftTitle, leftTable);

  // ── Colonne droite : provisoire ──
  const rightCol = document.createElement("div");
  const rightTitle = document.createElement("div");
  rightTitle.className = "standings-dual-title provisional";
  rightTitle.textContent = "🏁 Si course terminée maintenant";
  const rightTable = document.createElement("table");
  rightTable.className = "standings-table provisional-table";
  rightTable.innerHTML = `<thead><tr>
    <th class="std-pos">POS</th><th></th><th>PILOTE</th>
    <th class="std-pts">PTS PROV.</th><th class="std-delta">Δ PTS</th><th class="std-delta">Δ POS</th>
  </tr></thead>`;
  const rightBody = document.createElement("tbody");

  for (const d of provisional) {
    const tr = document.createElement("tr");
    if (d.provisional_position <= 3) {
      tr.className = ["podium-gold","podium-silver","podium-bronze"][d.provisional_position - 1];
    }
    const color    = resolveTeamColor(d.team);
    const deltaPos = d.position - d.provisional_position;
    const deltaPts = d._race_pts;

    const deltaPosStr   = deltaPos > 0 ? `▲${deltaPos}` : deltaPos < 0 ? `▼${Math.abs(deltaPos)}` : "—";
    const deltaPosClass = deltaPos > 0 ? "delta-up" : deltaPos < 0 ? "delta-down" : "";
    const deltaPtsStr   = deltaPts > 0 ? `+${deltaPts}` : deltaPts === 0 ? "—" : `${deltaPts}`;

    tr.innerHTML = `
      <td class="std-pos">${d.provisional_position}</td>
      <td class="std-color"><span class="std-color-bar" style="background:${color}"></span></td>
      <td class="std-name">${d.name}</td>
      <td class="std-pts">${d.provisional_points}</td>
      <td class="std-delta" style="color:var(--text-dim);font-size:10px">${deltaPtsStr}</td>
      <td class="std-delta ${deltaPosClass}">${deltaPosStr}</td>
    `;
    rightBody.appendChild(tr);
  }
  rightTable.appendChild(rightBody);
  rightCol.append(rightTitle, rightTable);

  dual.append(leftCol, rightCol);
  section.replaceChildren(dual);
}

function _scheduleProvisional(state) {
  const now = Date.now();
  if (now - _lastProvisionalRender < 8_000) {
    clearTimeout(_provisionalTimeout);
    _provisionalTimeout = setTimeout(() => {
      _lastProvisionalRender = Date.now();
      renderProvisional(state.drivers_standings, state.standings);
    }, 8_000 - (now - _lastProvisionalRender));
    return;
  }
  _lastProvisionalRender = now;
  renderProvisional(state.drivers_standings, state.standings);
}

function _removeProvisional() {
  panelDrivers?.querySelector(".standings-provisional-section")?.remove();
}

export function initStandings() {
  initTabs();

  onUpdate(state => {
    const ds = state.drivers_standings;
    const ts = state.teams_standings;
    if (!ds?.length || !ts?.length) return;

    renderDrivers(ds, state.teams);
    renderTeams(ts, state.teams);

    const updatedAt = state._standings_updated_at || null;
    if (panelDrivers) renderFreshnessBar(panelDrivers, updatedAt);
    if (panelTeams)   renderFreshnessBar(panelTeams,   updatedAt);
    if (state.last_race && panelDrivers) renderLastRace(panelDrivers, state.last_race);

    // Classement provisoire : seulement en mode live Race
    const isLiveRace = state.sessionMode === "live" && state.session?.session_type === "Race";
    if (isLiveRace && state.standings?.length) {
      _scheduleProvisional(state);
    } else {
      clearTimeout(_provisionalTimeout);
      _removeProvisional();
    }
  });

  const { drivers_standings: ds, teams_standings: ts, teams, last_race } = store;
  if (ds?.length && ts?.length) {
    renderDrivers(ds, teams);
    renderTeams(ts, teams);
    if (last_race && panelDrivers) renderLastRace(panelDrivers, last_race);
  }
}
// ─── Overlay détail pilote / écurie ─────────────────────────────────────────

const DETAIL_OVERLAY_ID = "std-detail-overlay";

function getOrCreateDetailOverlay() {
  let el = document.getElementById(DETAIL_OVERLAY_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = DETAIL_OVERLAY_ID;
    el.className = "std-detail-overlay";
    el.innerHTML = `
      <div class="std-detail-inner">
        <div class="std-detail-header">
          <span id="std-detail-title"></span>
          <button class="std-detail-close" id="std-detail-close">✕</button>
        </div>
        <div class="std-detail-body" id="std-detail-body"></div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector("#std-detail-close").addEventListener("click", closeDetailOverlay);
    el.addEventListener("click", e => { if (e.target === el) closeDetailOverlay(); });
  }
  return el;
}

function closeDetailOverlay() {
  document.getElementById(DETAIL_OVERLAY_ID)?.remove();
}

function detectProxy() {
  const h = window.location.hostname;
  return (h === "localhost" || h === "127.0.0.1") ? "http://localhost:3001" : `${window.location.origin}/proxy`;
}

const _detailCache = {};

async function fetchDriverHistory(driverRef, year) {
  const key = `driver_${driverRef}_${year}`;
  if (_detailCache[key]) return _detailCache[key];
  try {
    const PROXY = detectProxy();
    const res = await fetch(`${PROXY}/jolpica/ergast/f1/${year}/drivers/${driverRef}/results.json?limit=30`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const races = data?.MRData?.RaceTable?.Races || [];
    _detailCache[key] = races;
    return races;
  } catch (e) { return []; }
}

async function fetchTeamHistory(constructorRef, year) {
  const key = `team_${constructorRef}_${year}`;
  if (_detailCache[key]) return _detailCache[key];
  try {
    const PROXY = detectProxy();
    const res = await fetch(`${PROXY}/jolpica/ergast/f1/${year}/constructors/${constructorRef}/results.json?limit=100`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const races = data?.MRData?.RaceTable?.Races || [];
    _detailCache[key] = races;
    return races;
  } catch (e) { return []; }
}

function isoToFlagStd(c) {
  if (!c || c.length !== 2) return "";
  return [...c.toUpperCase()].map(x => String.fromCodePoint(x.charCodeAt(0) + 127397)).join("");
}

export function openDriverDetail(driver) {
  const ol = getOrCreateDetailOverlay();
  const color = resolveTeamColor(driver.team);
  document.getElementById("std-detail-title").innerHTML =
    `<span style="color:${color}">${driver.flag || ""} ${driver.name}</span>`;
  const body = document.getElementById("std-detail-body");

  // Lookup enriched driver metadata
  let dMeta = null;
  if (store.drivers_meta) {
    if (Array.isArray(store.drivers_meta)) {
      dMeta = store.drivers_meta.find(x => x.acronym === driver.acronym || x.name === driver.name);
    } else if (typeof store.drivers_meta === "object") {
      dMeta = store.drivers_meta[driver.acronym] || Object.values(store.drivers_meta).find(x => x.acronym === driver.acronym || x.name === driver.name);
    }
  }
  if (!dMeta && store.drivers) {
    dMeta = Object.values(store.drivers).find(x => x.acronym === driver.acronym);
  }

  // Lookup live telemetry driver for real-time tyre degradation
  const liveDriver = (store.standings || []).find(x =>
    (driver.acronym && x.acronym === driver.acronym) ||
    (driver.driver_number && String(x.driver_number) === String(driver.driver_number)) ||
    (dMeta?.number && String(x.driver_number) === String(dMeta.number)) ||
    (driver.name && x.driver_name && x.driver_name.toLowerCase().includes(driver.name.toLowerCase()))
  ) || (driver.compound ? driver : null);

  let tyreHtml = "";
  if (liveDriver && (liveDriver.compound || liveDriver.tyre_age !== undefined)) {
    const tyreEval = evaluateTyreHealth(
      liveDriver,
      store.circuit_specs?.[store.session?.circuit_name],
      store.weather
    );
    const initial = (tyreEval.compound || "M")[0];
    const cliffAlertHtml = tyreEval.isCliffApproaching
      ? `<div class="stdd-tyre-alert">
           <span class="stdd-tyre-alert-icon">⚠️</span>
           <span class="stdd-tyre-alert-text"><strong>Alerte Dégradation Critique (Cliff)</strong> : Risque d'effondrement de l'adhérence (${tyreEval.lapsBeforeCliff > 0 ? `dans ~${tyreEval.lapsBeforeCliff} tours` : 'Seuil atteint'}) !</span>
         </div>`
      : "";

    tyreHtml = `
      <div class="stdd-section stdd-tyre-section">
        <div class="stdd-section-title">🛞 Gestion des Pneumatiques (Pirelli Tyre Model)</div>
        ${cliffAlertHtml}
        <div class="stdd-tyre-card">
          <div class="stdd-tyre-gauge-col">
            <div class="stdd-tyre-gauge-wrap">
              <svg class="stdd-tyre-svg" viewBox="0 0 36 36">
                <path class="tyre-ring-bg"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path class="tyre-ring-val ${tyreEval.isCliffApproaching ? 'tyre-cliff-pulse' : ''}"
                  stroke="${tyreEval.statusColor}"
                  stroke-dasharray="${tyreEval.healthPercent}, 100"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div class="stdd-tyre-gauge-inner">
                <span class="stdd-tyre-letter" style="color:${tyreEval.compoundColor}">${initial}</span>
                <span class="stdd-tyre-pct">${tyreEval.healthPercent}%</span>
              </div>
            </div>
            <span class="stdd-tyre-status-badge" style="color:${tyreEval.statusColor}; border-color:${tyreEval.statusColor}55; background:${tyreEval.statusColor}18">
              ${tyreEval.statusLabel}
            </span>
          </div>

          <div class="stdd-tyre-stats-grid">
            <div class="stdd-tyre-metric">
              <span class="stdd-tyre-metric-lbl">Composé de Gomme</span>
              <span class="stdd-tyre-metric-val" style="color:${tyreEval.compoundColor}">Pirelli ${tyreEval.compound}</span>
            </div>
            <div class="stdd-tyre-metric">
              <span class="stdd-tyre-metric-lbl">Âge du Train</span>
              <span class="stdd-tyre-metric-val">${tyreEval.age} tour${tyreEval.age > 1 ? "s" : ""}</span>
            </div>
            <div class="stdd-tyre-metric">
              <span class="stdd-tyre-metric-lbl">Perte Chrono Estimée</span>
              <span class="stdd-tyre-metric-val">+${tyreEval.paceLossSec} s / tour</span>
            </div>
            <div class="stdd-tyre-metric">
              <span class="stdd-tyre-metric-lbl">Longévité Optimale</span>
              <span class="stdd-tyre-metric-val">${tyreEval.effectiveLife} tours max</span>
            </div>
            <div class="stdd-tyre-metric">
              <span class="stdd-tyre-metric-lbl">Seuil de Falaise (Cliff)</span>
              <span class="stdd-tyre-metric-val">Tour ~${tyreEval.cliffLapEstimated} (${tyreEval.lapsBeforeCliff > 0 ? `dans ${tyreEval.lapsBeforeCliff}T` : 'Atteint'})</span>
            </div>
            <div class="stdd-tyre-metric">
              <span class="stdd-tyre-metric-lbl">Température Asphalte</span>
              <span class="stdd-tyre-metric-val">${Math.round(store.weather?.track_temp ?? store.weather?.track_temperature ?? 35)}°C</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Lookup latest team radio communication for this driver
  const driverRadio = (store.team_radios || []).find(r =>
    String(r.driver_number) === String(driver.driver_number || dMeta?.number) ||
    r.driver_acronym === driver.acronym
  );

  let radioHtml = "";
  if (driverRadio) {
    radioHtml = `
      <div class="stdd-section stdd-radio-section">
        <div class="stdd-section-title">🎙️ Dernière Communication Radio</div>
        <div class="stdd-radio-card" id="stdd-driver-radio-btn" style="border-left: 4px solid ${color}; cursor: pointer;" title="Cliquer pour écouter la radio">
          <div class="stdd-radio-meta">
            <span class="stdd-radio-cat">${driverRadio.category || "COMMUNICATION"}</span>
            <span class="stdd-radio-time">${driverRadio.timestamp || "--:--"}</span>
          </div>
          <p class="stdd-radio-quote">“${driverRadio.transcript}”</p>
          <div class="stdd-radio-action">
            <span class="stdd-radio-play-icon">▶</span>
            <span>Écouter la radio</span>
          </div>
        </div>
      </div>
    `;
  }

  const photoHtml = dMeta?.photo_url
    ? `<div class="stdd-photo-wrap"><img src="${dMeta.photo_url}" alt="${driver.name}" class="stdd-driver-img" onerror="this.parentElement.style.display='none'" /></div>`
    : `<div class="stdd-photo-wrap stdd-photo-fallback"><span class="stdd-photo-num">#${dMeta?.number || driver.driver_number || driver.position}</span></div>`;

  body.innerHTML = `
    <div class="stdd-hero" style="border-left: 4px solid ${color}">
      ${photoHtml}
      <div class="stdd-hero-info">
        <div class="stdd-hero-topline">
          <span class="stdd-hero-num">#${dMeta?.number || driver.driver_number || driver.position}</span>
          <span class="stdd-hero-code">${driver.acronym || ""}</span>
          <span class="stdd-hero-flag">${driver.flag || dMeta?.flag || ""}</span>
          <span class="stdd-hero-nat">${dMeta?.nationality || ""}</span>
        </div>
        <h2 class="stdd-hero-fullname">${dMeta?.full_name || driver.name}</h2>
        <span class="stdd-hero-team" style="color:${color}">${driver.team}</span>
        ${dMeta?.birth_date ? `<span class="stdd-hero-birth">Né le ${new Date(dMeta.birth_date).toLocaleDateString("fr-FR", {day:"numeric",month:"long",year:"numeric"})}</span>` : ""}
      </div>
    </div>

    <!-- Palmarès en carrière F1 -->
    <div class="stdd-palmares">
      <div class="stdd-section-subtitle">🏆 Palmarès en Formule 1</div>
      <div class="stdd-palmares-grid">
        <div class="stdd-palmares-card"><span class="stdd-palmares-val">${dMeta?.championships ?? 0}</span><span class="stdd-palmares-lbl">Titres Mondiaux</span></div>
        <div class="stdd-palmares-card"><span class="stdd-palmares-val">${dMeta?.career_wins ?? 0}</span><span class="stdd-palmares-lbl">Victoires F1</span></div>
        <div class="stdd-palmares-card"><span class="stdd-palmares-val">${dMeta?.career_podiums ?? 0}</span><span class="stdd-palmares-lbl">Podiums</span></div>
        <div class="stdd-palmares-card"><span class="stdd-palmares-val">${dMeta?.career_poles ?? 0}</span><span class="stdd-palmares-lbl">Pole Positions</span></div>
        <div class="stdd-palmares-card"><span class="stdd-palmares-val">${dMeta?.career_points ?? 0}</span><span class="stdd-palmares-lbl">Pts Carrière</span></div>
      </div>
    </div>

    ${dMeta?.biography ? `
    <div class="stdd-section">
      <div class="stdd-section-title">📖 Biographie & Parcours</div>
      <p class="stdd-bio-text">${dMeta.biography}</p>
    </div>` : ""}

    <!-- Stats Saison 2026 -->
    <div class="stdd-stats-row">
      <div class="stdd-stat"><span class="stdd-stat-val">${driver.points}</span><span class="stdd-stat-lbl">Points 2026</span></div>
      <div class="stdd-stat"><span class="stdd-stat-val">P${driver.position}</span><span class="stdd-stat-lbl">Rang 2026</span></div>
      <div class="stdd-stat" id="stdd-wins"><span class="stdd-stat-val">—</span><span class="stdd-stat-lbl">Victoires 2026</span></div>
      <div class="stdd-stat" id="stdd-podiums"><span class="stdd-stat-val">—</span><span class="stdd-stat-lbl">Podiums 2026</span></div>
    </div>

    ${tyreHtml}

    ${radioHtml}

    <div class="stdd-section">
      <div class="stdd-section-title">Saison 2026 — course par course</div>
      <div class="stdd-history" id="stdd-history"><div class="stdd-empty">Chargement…</div></div>
    </div>`;
  ol.hidden = false;

  if (driverRadio) {
    const radioBtn = document.getElementById("stdd-driver-radio-btn");
    if (radioBtn) {
      radioBtn.addEventListener("click", () => playMessage(driverRadio));
    }
  }

  // Lookup driverRef from store
  const driverEntry = Object.values(store.drivers || {}).find(d =>
    d.acronym === driver.acronym || d.name === driver.name
  );
  const driverRef = driverEntry?.id || driver.acronym?.toLowerCase();
  if (!driverRef) return;

  fetchDriverHistory(driverRef, new Date().getFullYear()).then(races => {
    const histDiv = document.getElementById("stdd-history");
    if (!histDiv) return;
    if (!races.length) { histDiv.innerHTML = `<div class="stdd-empty">Aucune course disputée.</div>`; return; }

    let wins = 0, podiums = 0;
    const rows = races.map(r => {
      const res = r.Results?.[0];
      if (!res) return "";
      const pos = parseInt(res.position || "99", 10);
      if (pos === 1) wins++;
      if (pos <= 3) podiums++;
      const cls = pos === 1 ? "p1" : pos === 2 ? "p2" : pos === 3 ? "p3" : "";
      return `<div class="stdd-hist-row ${cls}">
        <span class="shist-round">R${r.round}</span>
        <span class="shist-gp">${r.raceName}</span>
        <span class="shist-pos">P${pos}</span>
        <span class="shist-pts">+${res.points || 0}pts</span>
      </div>`;
    }).join("");
    histDiv.innerHTML = rows || `<div class="stdd-empty">Aucune donnée.</div>`;
    const wEl = document.getElementById("stdd-wins");
    const pEl = document.getElementById("stdd-podiums");
    if (wEl) wEl.querySelector(".stdd-stat-val").textContent = wins;
    if (pEl) pEl.querySelector(".stdd-stat-val").textContent = podiums;
  });
}

function openTeamDetail(team) {
  const ol = getOrCreateDetailOverlay();
  const color = resolveTeamColor(team.name);
  document.getElementById("std-detail-title").innerHTML =
    `<span style="color:${color}">${team.name}</span>`;
  const body = document.getElementById("std-detail-body");

  // Lookup team meta
  let tMeta = null;
  if (store.teams_meta) {
    if (typeof store.teams_meta === "object" && !Array.isArray(store.teams_meta)) {
      tMeta = store.teams_meta[team.name] || Object.values(store.teams_meta).find(t =>
        (t.full_name && t.full_name.toLowerCase().includes(team.name.toLowerCase())) ||
        team.name.toLowerCase().includes((t.name || "").toLowerCase())
      );
    } else if (Array.isArray(store.teams_meta)) {
      tMeta = store.teams_meta.find(t =>
        (t.full_name && t.full_name.toLowerCase().includes(team.name.toLowerCase())) ||
        team.name.toLowerCase().includes((t.name || "").toLowerCase())
      );
    }
  }

  const logoHtml = tMeta?.logo_url ? `<img src="${tMeta.logo_url}" alt="${team.name}" class="stdd-team-logo" />` : "";
  const liveryHtml = tMeta?.car_image_url ? `<div class="stdd-team-livery"><img src="${tMeta.car_image_url}" alt="Monoplace ${team.name}" /></div>` : "";

  body.innerHTML = `
    <div class="stdd-hero stdd-hero-team-view" style="border-left: 4px solid ${color}">
      ${logoHtml ? `<div class="stdd-team-logo-wrap">${logoHtml}</div>` : ""}
      <div class="stdd-hero-info">
        <div class="stdd-hero-topline">
          <span class="stdd-hero-num">#${team.position}</span>
          <span class="stdd-hero-code">${tMeta?.base ? `📍 ${tMeta.base}` : ""}</span>
        </div>
        <h2 class="stdd-hero-fullname" style="color:${color}">${tMeta?.full_name || team.name}</h2>
        <div class="stdd-team-tech-specs">
          ${tMeta?.team_principal ? `<span><strong>Dirigeant :</strong> ${tMeta.team_principal}</span>` : ""}
          ${tMeta?.power_unit ? `<span><strong>Moteur :</strong> ${tMeta.power_unit}</span>` : ""}
        </div>
      </div>
    </div>

    ${liveryHtml}

    <div class="stdd-palmares">
      <div class="stdd-section-subtitle">🏆 Palmarès Écurie</div>
      <div class="stdd-palmares-grid">
        <div class="stdd-palmares-card"><span class="stdd-palmares-val">${tMeta?.championships ?? 0}</span><span class="stdd-palmares-lbl">Titres Constructeurs</span></div>
        <div class="stdd-palmares-card"><span class="stdd-palmares-val">${tMeta?.wins ?? 0}</span><span class="stdd-palmares-lbl">Victoires F1</span></div>
        <div class="stdd-palmares-card"><span class="stdd-palmares-val">${tMeta?.podiums ?? 0}</span><span class="stdd-palmares-lbl">Podiums</span></div>
        <div class="stdd-palmares-card"><span class="stdd-palmares-val">${team.points}</span><span class="stdd-palmares-lbl">Pts 2026</span></div>
      </div>
    </div>

    ${tMeta?.history ? `
    <div class="stdd-section">
      <div class="stdd-section-title">🏛️ Histoire de l'écurie</div>
      <p class="stdd-bio-text">${tMeta.history}</p>
    </div>` : ""}

    <div class="stdd-section">
      <div class="stdd-section-title">Pilotes de l'équipe</div>
      <div id="stdd-team-drivers"></div>
    </div>
    <div class="stdd-section">
      <div class="stdd-section-title">Saison 2026 — résultats</div>
      <div class="stdd-history" id="stdd-team-history"><div class="stdd-empty">Chargement…</div></div>
    </div>`;
  ol.hidden = false;

  // Drivers in this team from standings
  const teamDrivers = (store.drivers_standings || []).filter(d =>
    d.team?.toLowerCase().includes(team.name.toLowerCase()) ||
    team.name.toLowerCase().includes((d.team || "").toLowerCase())
  );
  const driversDiv = document.getElementById("stdd-team-drivers");
  if (driversDiv && teamDrivers.length) {
    driversDiv.innerHTML = teamDrivers.map(d =>
      `<div class="stdd-driver-row">
        <span class="sdr-flag">${d.flag || ""}</span>
        <span class="sdr-name">${d.name}</span>
        <span class="sdr-pos">P${d.position}</span>
        <span class="sdr-pts">${d.points} pts</span>
      </div>`
    ).join("");
  }

  // Team ref lookup
  const refMap = {
    "Mercedes":"mercedes","Red Bull":"red_bull","Ferrari":"ferrari","McLaren":"mclaren",
    "Aston Martin":"aston_martin","Alpine":"alpine","Haas":"haas","Williams":"williams",
    "Racing Bulls":"rb","RB":"rb","Audi":"sauber","Cadillac":"cadillac",
  };
  const constructorRef = refMap[team.name] || team.name.toLowerCase().replace(/\s+/g, "_");

  fetchTeamHistory(constructorRef, new Date().getFullYear()).then(races => {
    const histDiv = document.getElementById("stdd-team-history");
    if (!histDiv) return;
    if (!races.length) { histDiv.innerHTML = `<div class="stdd-empty">Aucune course disputée.</div>`; return; }

    let wins = 0, podiums = 0;
    // Group by race
    const raceMap = {};
    for (const r of races) {
      if (!raceMap[r.round]) raceMap[r.round] = { round: r.round, name: r.raceName, results: [] };
      for (const res of (r.Results || [])) {
        raceMap[r.round].results.push(res);
      }
    }
    const rows = Object.values(raceMap).map(r => {
      const sorted = r.results.sort((a,b) => parseInt(a.position||99) - parseInt(b.position||99));
      const best = sorted[0];
      const pos = parseInt(best?.position || "99", 10);
      if (pos === 1) wins++;
      if (pos <= 3) podiums++;
      const cls = pos === 1 ? "p1" : pos === 2 ? "p2" : pos === 3 ? "p3" : "";
      const drivers = sorted.map(x => `${x.Driver?.code || "?"}:P${x.position}`).join(" / ");
      return `<div class="stdd-hist-row ${cls}">
        <span class="shist-round">R${r.round}</span>
        <span class="shist-gp">${r.name}</span>
        <span class="shist-driver">${drivers}</span>
      </div>`;
    }).join("");
    histDiv.innerHTML = rows || `<div class="stdd-empty">Aucune donnée.</div>`;
    const wEl = document.getElementById("stdd-team-wins");
    const pEl = document.getElementById("stdd-team-podiums");
    if (wEl) wEl.querySelector(".stdd-stat-val").textContent = wins;
    if (pEl) pEl.querySelector(".stdd-stat-val").textContent = podiums;
  });
}

// ─── Patch renderDrivers + renderTeams pour rendre les rows cliquables ────────
// Override avec une version augmentée
const _origRenderDrivers = renderDrivers;
const _origRenderTeams = renderTeams;

function addClickToRows(panel, standings, clickFn) {
  if (!panel) return;
  const rows = panel.querySelectorAll("tbody tr");
  rows.forEach((tr, i) => {
    if (!standings[i]) return;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => clickFn(standings[i]));
    tr.addEventListener("mouseenter", () => tr.classList.add("std-row-hover"));
    tr.addEventListener("mouseleave", () => tr.classList.remove("std-row-hover"));
  });
}

// Monkey-patch onUpdate to add click handlers after each render
let _lastDs = [], _lastTs = [];
const _origOnUpdate = onUpdate;
// We'll add a secondary onUpdate in initStandings, just patch after renders via a wrapper

export function initStandingsWithDetail() {
  // Already called from initStandings — attach click handlers
  onUpdate(state => {
    if (state.drivers_standings?.length) _lastDs = state.drivers_standings;
    if (state.teams_standings?.length) _lastTs = state.teams_standings;
    // Add click after DOM settles
    setTimeout(() => {
      addClickToRows(panelDrivers, _lastDs, openDriverDetail);
      addClickToRows(panelTeams, _lastTs, openTeamDetail);
    }, 100);
  });
  // Also add for current data
  setTimeout(() => {
    addClickToRows(panelDrivers, _lastDs, openDriverDetail);
    addClickToRows(panelTeams, _lastTs, openTeamDetail);
  }, 500);
}