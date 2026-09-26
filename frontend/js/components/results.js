/**
 * results.js — Page résultats de la saison 2026
 *
 * Style agenda/calendrier mobile :
 *  - GP passés : podium (P1/P2/P3), fastest lap, points clés — dépliable
 *  - GP en cours : badge "EN COURS", sessions avec statuts
 *  - GP à venir : countdown + programme des sessions
 *
 * Source : /proxy/jolpica/ergast/f1/2026/results.json (via proxy Node)
 *          + store.calendar pour la structure complète
 */

import { store, onUpdate } from "../store.js";

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function isoToFlag(code) {
  if (!code || code.length !== 2) return "";
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(c.charCodeAt(0) + 127397))
    .join("");
}

function resolveTeamColor(teamName) {
  const MAP = {
    "Mercedes":"#27F4D2","Red Bull":"#3671C6","Ferrari":"#E8002D",
    "McLaren":"#FF8000","Aston Martin":"#229971","Alpine":"#00A1E8",
    "Haas":"#DEE1E2","Williams":"#1868DB","Racing Bulls":"#6692FF",
    "RB":"#6692FF","Audi":"#FF2D00","Cadillac":"#AAAAAD",
  };
  if (!teamName) return "#888";
  if (MAP[teamName]) return MAP[teamName];
  for (const [k, v] of Object.entries(MAP)) {
    if (teamName.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return "#888";
}

function formatCountdown(targetISO) {
  const diff = new Date(targetISO).getTime() - Date.now();
  if (diff <= 0) return "EN COURS";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (d > 0) return `dans ${d}j ${String(h).padStart(2,"0")}h`;
  if (h > 0) return `dans ${h}h ${String(m).padStart(2,"0")}m`;
  return `dans ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
}

function formatDate(isoStr, opts = {}) {
  try {
    return new Date(isoStr).toLocaleString("fr-FR", opts);
  } catch { return isoStr; }
}

function formatLapTime(ms) {
  if (!ms) return "—";
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}

// ─── Correspondance round → clé Ergast ───────────────────────────────────────

function normalizeDriverName(givenName, familyName) {
  return `${givenName} ${familyName}`.trim();
}

function ergastTeamToInternal(constructorName) {
  const MAP = {
    "Mercedes":"Mercedes","Red Bull":"Red Bull","Ferrari":"Ferrari",
    "McLaren":"McLaren","Aston Martin":"Aston Martin","Alpine F1 Team":"Alpine",
    "Alpine":"Alpine","Haas F1 Team":"Haas","Haas":"Haas","Williams":"Williams",
    "RB F1 Team":"Racing Bulls","Racing Bulls":"Racing Bulls",
    "Visa Cash App RB":"Racing Bulls","Kick Sauber":"Audi","Sauber":"Audi",
    "Audi":"Audi","Cadillac":"Cadillac","Andretti Global":"Cadillac",
  };
  return MAP[constructorName] || constructorName;
}

// ─── Chargement des résultats depuis Jolpica ──────────────────────────────────

let _resultsCache = null;
let _fetchPromise = null;

function detectProxy() {
  const h = window.location.hostname;
  const p = window.location.port;
  if (p === "8080" || p === "80" || p === "443" || p === "" || (h !== "localhost" && h !== "127.0.0.1")) {
    return `${window.location.origin}/proxy`;
  }
  return "http://localhost:3001";
}

function mapNormalizedRaceToErgast(normRace) {
  if (!normRace) return null;
  return {
    round: normRace.round?.toString() || "",
    raceName: normRace.name || "",
    Results: (normRace.results || []).map((r, i) => ({
      position: r.position?.toString() || (i + 1).toString(),
      points: r.points?.toString() || "0",
      status: r.time ? "" : "Finished",
      Driver: {
        code: r.code || r.acronym || "",
        givenName: (r.name || "").split(" ")[0] || "",
        familyName: (r.name || "").split(" ").slice(1).join(" ") || ""
      },
      Constructor: {
        name: r.team || ""
      },
      Time: r.time ? { time: r.time } : null,
      FastestLap: {
        rank: r.fastest_lap ? "1" : "0",
        Time: r.fastest_lap_time ? { time: r.fastest_lap_time } : null
      }
    }))
  };
}

async function fetchResults() {
  if (_resultsCache) return _resultsCache;
  if (_fetchPromise) return _fetchPromise;

  const PROXY   = detectProxy();
  const JOLPICA = `${PROXY}/jolpica`;
  const year    = new Date().getFullYear();

  _fetchPromise = (async () => {
    try {
      // Récupère tous les résultats de la saison en une requête (limit=500)
      const res = await fetch(`${JOLPICA}/ergast/f1/${year}/results.json?limit=500`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const races = data?.MRData?.RaceTable?.Races || [];
      _resultsCache = races;
      return races;
    } catch (err) {
      console.warn("[results] Impossible de charger les résultats Ergast :", err);
      if (store.season_results && store.season_results.length > 0) {
        console.info("[results] Utilisation des résultats statiques en fallback");
        const fallbackRaces = store.season_results.map(mapNormalizedRaceToErgast);
        _resultsCache = fallbackRaces;
        return fallbackRaces;
      }
      return [];
    }
  })();

  return _fetchPromise;
}

// ─── Construction du rendu ────────────────────────────────────────────────────

function buildResultCard(gp, ergastRace, isExpanded) {
  const now       = Date.now();
  const startMs   = new Date(gp.date_start).getTime();
  const endMs     = new Date(gp.date_end).getTime() + 4 * 3600000; // +4h après la fin prévue
  const raceMs    = (() => {
    const r = (gp.sessions || []).find(s => s.name === "Course" || s.type === "Race");
    return r ? new Date(r.date).getTime() : endMs;
  })();

  const isPast    = raceMs < now - 3600000; // Terminé > 1h
  const isCurrent = startMs <= now && now <= endMs;
  const isFuture  = startMs > now;
  const isCancelled = gp.cancelled === true;

  const flag      = isoToFlag(gp.country_code);
  const isSprint  = gp.sprint === true;

  // ── Calcul prochain session ──
  const nextSession = isFuture || isCurrent
    ? (gp.sessions || []).find(s => new Date(s.date).getTime() > now) || null
    : null;

  // ── Badge de statut ──
  let statusBadge = "";
  if (isCancelled)   statusBadge = `<span class="res-badge cancelled">ANNULÉ</span>`;
  else if (isPast)   statusBadge = `<span class="res-badge past">TERMINÉ</span>`;
  else if (isCurrent)statusBadge = `<span class="res-badge live">EN COURS</span>`;
  else if (isFuture) {
    const raceSession = (gp.sessions || []).find(s => s.name === "Course");
    statusBadge = raceSession
      ? `<span class="res-badge future" data-cd="${raceSession.date}">${formatCountdown(raceSession.date)}</span>`
      : `<span class="res-badge future">À VENIR</span>`;
  }

  // ── Résultats (GP passé avec données Ergast) ──
  let resultsSection = "";
  if (isPast && !isCancelled && ergastRace) {
    const results = ergastRace.Results || [];
    const top3    = results.slice(0, 3);
    const fl      = results.find(r => r.FastestLap?.rank === "1") || null;

    const podiumHTML = top3.map((r, i) => {
      const pos   = i + 1;
      const name  = normalizeDriverName(r.Driver?.givenName || "", r.Driver?.familyName || "");
      const team  = ergastTeamToInternal(r.Constructor?.name || "");
      const color = resolveTeamColor(team);
      const code  = (r.Driver?.code || "???").toUpperCase();
      const pts   = r.points || "0";
      const time  = pos === 1
        ? (r.Time?.time || r.status || "—")
        : (r.Time?.time ? `+${r.Time.time}` : r.status || "—");
      return `<div class="res-podium-item pos-${pos}" style="--tc:${color}">
        <span class="res-podium-pos">P${pos}</span>
        <span class="res-podium-code">${code}</span>
        <span class="res-podium-name">${name}</span>
        <span class="res-podium-team">${team}</span>
        <span class="res-podium-time">${time}</span>
      </div>`;
    }).join("");

    const flHTML = fl
      ? `<div class="res-fl-row">
          ⚡ Fastest Lap — <strong>${fl.Driver?.code || "?"}</strong>
          ${fl.FastestLap?.Time?.time
            ? `<span class="res-fl-time">${fl.FastestLap.Time.time}</span>`
            : ""}
          ${fl.FastestLap?.lap ? `<span class="res-fl-lap">Tour ${fl.FastestLap.lap}</span>` : ""}
        </div>`
      : "";

    resultsSection = `
      <div class="res-results-block">
        <div class="res-podium-row">${podiumHTML}</div>
        ${flHTML}
      </div>`;
  } else if (isPast && !isCancelled && !ergastRace) {
    resultsSection = `<div class="res-results-placeholder">Résultats en cours de chargement…</div>`;
  }

  // ── Sessions (GP à venir ou en cours) ──
  let sessionsSection = "";
  if ((isFuture || isCurrent) && !isCancelled) {
    const sessHTML = (gp.sessions || []).map(s => {
      const sMs      = new Date(s.date).getTime();
      const isDone   = sMs < now;
      const isLive   = isCurrent && sMs <= now && sMs + 7200000 > now;
      const isNextS  = nextSession && s.date === nextSession.date;
      const isCourse = s.name === "Course" || s.type === "Race";
      return `<div class="res-sess-row ${isDone?"done":""} ${isLive?"live":""} ${isNextS?"next":""} ${isCourse?"race":""}">
        <span class="res-sess-name">${s.name || s.type}</span>
        <span class="res-sess-date">${formatDate(s.date, { weekday:"short", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })}</span>
        ${isNextS ? `<span class="res-sess-cd" data-target="${s.date}"></span>` : ""}
        ${isLive ? `<span class="res-live-dot">● LIVE</span>` : ""}
      </div>`;
    }).join("");
    sessionsSection = `<div class="res-sessions-block">${sessHTML}</div>`;
  }

  // ── Lien vers la vue Live si en cours ──
  const liveLink = isCurrent
    ? `<a href="#telemetry" class="res-live-cta" id="res-live-cta">📡 Voir le dashboard</a>`
    : "";

  const expandClass = isExpanded ? "expanded" : "";
  const cardClass   = [
    "res-card",
    isPast    ? "is-past"    : "",
    isCurrent ? "is-current" : "",
    isFuture  ? "is-future"  : "",
    isCancelled ? "is-cancelled" : "",
    isSprint  ? "is-sprint"  : "",
  ].filter(Boolean).join(" ");

  return `
    <div class="${cardClass} ${expandClass}" data-round="${gp.round}" id="res-card-${gp.round}">
      <div class="res-card-header" data-toggle="${gp.round}">
        <div class="res-card-left">
          <span class="res-round">M${gp.round}</span>
          <span class="res-flag">${flag}</span>
          <div class="res-card-info">
            <span class="res-gp-name">${gp.name}</span>
            <span class="res-circuit">${gp.circuit}</span>
          </div>
        </div>
        <div class="res-card-right">
          ${isSprint ? `<span class="res-sprint-badge">S</span>` : ""}
          <span class="res-dates">${
            formatDate(gp.date_start, { day:"numeric", month:"short" })} — ${
            formatDate(gp.date_end, { day:"numeric", month:"short" })
          }</span>
          ${statusBadge}
          <span class="res-chevron">${isExpanded ? "▲" : "▼"}</span>
        </div>
      </div>
      <div class="res-card-body">
        ${resultsSection}
        ${sessionsSection}
        ${liveLink}
      </div>
    </div>`;
}

// ─── Mise à jour des countdowns ───────────────────────────────────────────────

let _cdInterval = null;

function startCountdowns() {
  if (_cdInterval) clearInterval(_cdInterval);
  _cdInterval = setInterval(() => {
    document.querySelectorAll(".res-badge.future[data-cd]").forEach(el => {
      el.textContent = formatCountdown(el.dataset.cd);
    });
    document.querySelectorAll(".res-sess-cd[data-target]").forEach(el => {
      el.textContent = formatCountdown(el.dataset.target);
    });
  }, 1000);
}

// ─── Rendu principal ──────────────────────────────────────────────────────────

let _expandedRounds = new Set();
let _ergastData     = [];
let _rendered       = false;

function matchErgastRace(ergastRaces, gpRound) {
  return ergastRaces.find(r => parseInt(r.round, 10) === gpRound) || null;
}

async function renderResults() {
  const container = document.getElementById("results-list");
  if (!container) return;

  const calendar = store.calendar || [];
  if (!calendar.length) {
    container.innerHTML = `<div class="res-loading">Chargement du calendrier…</div>`;
    return;
  }

  // Chargement des données Ergast (une seule fois, mis en cache)
  container.innerHTML = `<div class="res-loading">Chargement des résultats…</div>`;
  _ergastData = await fetchResults();

  // Trouver le GP en cours ou le prochain pour auto-expand
  const now = Date.now();
  if (!_rendered) {
    const autoExpand = calendar.find(gp => {
      if (gp.cancelled) return false;
      const startMs = new Date(gp.date_start).getTime();
      const endMs   = new Date(gp.date_end).getTime() + 4 * 3600000;
      const raceMs  = (() => {
        const r = (gp.sessions || []).find(s => s.name === "Course");
        return r ? new Date(r.date).getTime() : endMs;
      })();
      return (startMs <= now && now <= endMs) ||  // en cours
             (raceMs > now);                       // prochain
    });
    if (autoExpand) _expandedRounds.add(autoExpand.round);
    _rendered = true;
  }

  const html = calendar.map(gp => {
    const ergastRace = matchErgastRace(_ergastData, gp.round);
    return buildResultCard(gp, ergastRace, _expandedRounds.has(gp.round));
  }).join("");

  container.innerHTML = html || `<div class="res-empty">Aucune manche au calendrier.</div>`;

  // Liaisons toggle expand
  container.querySelectorAll("[data-toggle]").forEach(header => {
    header.addEventListener("click", () => {
      const round = parseInt(header.dataset.toggle, 10);
      const card  = document.getElementById(`res-card-${round}`);
      if (!card) return;
      const isExpanded = card.classList.contains("expanded");
      if (isExpanded) {
        card.classList.remove("expanded");
        _expandedRounds.delete(round);
        const chevron = card.querySelector(".res-chevron");
        if (chevron) chevron.textContent = "▼";
      } else {
        card.classList.add("expanded");
        _expandedRounds.add(round);
        const chevron = card.querySelector(".res-chevron");
        if (chevron) chevron.textContent = "▲";
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  });

  // Lien vers live page
  container.querySelectorAll(".res-live-cta").forEach(a => {
    a.addEventListener("click", e => {
      e.preventDefault();
      history.pushState(null, "", "#telemetry");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
  });

  startCountdowns();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function _isResultsActive() {
  return document.getElementById("view-results")?.classList.contains("active");
}

export function initResults() {
  function _onActivate() {
    if (_isResultsActive()) setTimeout(renderResults, 50);
  }

  // viewchange : déclenché par activateView() à chaque navigation (pushState)
  window.addEventListener("viewchange", e => {
    if (e.detail?.view === "results") setTimeout(renderResults, 50);
  });
  // popstate : navigation navigateur (retour/avant)
  window.addEventListener("popstate", _onActivate);

  // Données du store qui arrivent : re-rendre si vue déjà active
  onUpdate(state => {
    if (!_isResultsActive()) return;
    if (!state.calendar?.length) return;
    const container = document.getElementById("results-list");
    if (container && (container.querySelector(".res-loading") || !container.children.length)) {
      renderResults();
    }
  });

  // Init immédiat si vue active au chargement
  if (_isResultsActive()) setTimeout(renderResults, 300);
}