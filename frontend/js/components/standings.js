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

function openDriverDetail(driver) {
  const ol = getOrCreateDetailOverlay();
  const color = resolveTeamColor(driver.team);
  document.getElementById("std-detail-title").innerHTML =
    `<span style="color:${color}">${driver.flag || ""} ${driver.name}</span>`;
  const body = document.getElementById("std-detail-body");
  body.innerHTML = `
    <div class="stdd-hero" style="border-left: 4px solid ${color}">
      <span class="stdd-hero-num">#${driver.position}</span>
      <span class="stdd-hero-code">${driver.acronym || ""}</span>
      <span class="stdd-hero-fullname">${driver.name}</span>
      <span class="stdd-hero-team" style="color:${color}">${driver.team}</span>
    </div>
    <div class="stdd-stats-row">
      <div class="stdd-stat"><span class="stdd-stat-val">${driver.points}</span><span class="stdd-stat-lbl">Points</span></div>
      <div class="stdd-stat"><span class="stdd-stat-val">${driver.position}</span><span class="stdd-stat-lbl">Classement</span></div>
      <div class="stdd-stat" id="stdd-wins"><span class="stdd-stat-val">—</span><span class="stdd-stat-lbl">Victoires</span></div>
      <div class="stdd-stat" id="stdd-podiums"><span class="stdd-stat-val">—</span><span class="stdd-stat-lbl">Podiums</span></div>
    </div>
    <div class="stdd-section">
      <div class="stdd-section-title">Saison 2026 — course par course</div>
      <div class="stdd-history" id="stdd-history"><div class="stdd-empty">Chargement…</div></div>
    </div>`;
  ol.hidden = false;

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
      const time = res.Time?.time || res.status || "—";
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
  body.innerHTML = `
    <div class="stdd-hero" style="border-left: 4px solid ${color}">
      <span class="stdd-hero-num">#${team.position}</span>
      <span class="stdd-hero-fullname" style="color:${color}">${team.name}</span>
    </div>
    <div class="stdd-stats-row">
      <div class="stdd-stat"><span class="stdd-stat-val">${team.points}</span><span class="stdd-stat-lbl">Points</span></div>
      <div class="stdd-stat"><span class="stdd-stat-val">${team.position}</span><span class="stdd-stat-lbl">Classement</span></div>
      <div class="stdd-stat" id="stdd-team-wins"><span class="stdd-stat-val">—</span><span class="stdd-stat-lbl">Victoires</span></div>
      <div class="stdd-stat" id="stdd-team-podiums"><span class="stdd-stat-val">—</span><span class="stdd-stat-lbl">Podiums</span></div>
    </div>
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