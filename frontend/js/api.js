/**
 * api.js v7 — Toutes les requêtes API passent par le proxy de cache local.
 *
 * ARCHITECTURE ANTI-429 :
 *  1. Le proxy Node.js (port 3001) intercepte TOUTES les requêtes OpenF1 / Jolpica
 *  2. Les données d'archive sont mises en cache sur disque (survie aux redémarrages)
 *  3. Stale-While-Revalidate : réponse immédiate, refresh en arrière-plan
 *  4. sessionStorage : les données d'archive survivent aux rechargements de page
 *  5. WebSocket push depuis le proxy pour éviter tout polling répétitif
 *
 * CORRECTIONS v7 :
 *  - getLatestSession() utilise session_key=latest (proxy intercepte → vraie dernière session)
 *  - fetchAndStoreStaticData() filtre les sessions futures (évite de cacher Miami avant qu'elle ait lieu)
 *  - WebSocket proxy : retry exponentiel plafonné
 *
 * PLUS AUCUN appel direct vers api.openf1.org depuis le navigateur.
 */

import { updateStore, store } from "./store.js";

// ─── Détection URL du proxy ───────────────────────────────────────────────────
// - En développement (localhost) : proxy sur :3001
// - En production (servi par Nginx) : /proxy/ redirige vers f1_proxy:3001

function detectProxy() {
  const h = window.location.hostname;
  const p = window.location.port;
  if (p === "8080" || p === "80" || p === "443" || p === "" || (h !== "localhost" && h !== "127.0.0.1")) {
    return `${window.location.origin}/proxy`;
  }
  return "http://localhost:3001";
}

const PROXY   = detectProxy();
const OPENF1  = `${PROXY}/openf1`;
const JOLPICA = `${PROXY}/jolpica`;
const YEAR    = new Date().getFullYear();

// ─── Fallback session (GP Japon 2026 — Course) ────────────────────────────────
// Utilisé uniquement si le proxy est inaccessible au premier chargement.

const FALLBACK_SESSION = {
  session_key:        11253,
  session_name:       "Race",
  session_type:       "Race",
  location:           "Suzuka",
  circuit_short_name: "Suzuka",
  country_code:       "JP",
  date_start:         "2026-03-29T05:00:00+00:00",
  date_end:           "2026-03-29T07:00:00+00:00",
  meeting_key:        1261,
};

const TEAM_COLORS = {
  "Mercedes":                           "#27F4D2",
  "Mercedes-AMG Petronas":              "#27F4D2",
  "Mercedes AMG":                       "#27F4D2",
  "Red Bull Racing":                    "#3671C6",
  "Red Bull":                           "#3671C6",
  "Ferrari":                            "#E8002D",
  "Scuderia Ferrari":                   "#E8002D",
  "McLaren":                            "#FF8000",
  "McLaren Formula 1 Team":             "#FF8000",
  "Aston Martin":                       "#229971",
  "Aston Martin Aramco":                "#229971",
  "Alpine":                             "#00A1E8",
  "Alpine F1 Team":                     "#00A1E8",
  "BWT Alpine F1 Team":                 "#00A1E8",
  "Haas F1 Team":                       "#DEE1E2",
  "Haas":                               "#DEE1E2",
  "MoneyGram Haas F1 Team":             "#DEE1E2",
  "Williams":                           "#1868DB",
  "Williams Racing":                    "#1868DB",
  "Racing Bulls":                       "#6692FF",
  "RB":                                 "#6692FF",
  "RB F1 Team":                         "#6692FF",
  "Visa Cash App RB":                   "#6692FF",
  "Mercedes":                           "#27F4D2",
  "Mercedes-AMG Petronas":              "#27F4D2",
  "Mercedes AMG":                       "#27F4D2",
  "Red Bull Racing":                    "#3671C6",
  "Red Bull":                           "#3671C6",
  "Ferrari":                            "#E8002D",
  "Scuderia Ferrari":                   "#E8002D",
  "McLaren":                            "#FF8000",
  "McLaren Formula 1 Team":             "#FF8000",
  "Aston Martin":                       "#229971",
  "Aston Martin Aramco":                "#229971",
  "Alpine":                             "#00A1E8",
  "Alpine F1 Team":                     "#00A1E8",
  "BWT Alpine F1 Team":                 "#00A1E8",
  "Haas F1 Team":                       "#DEE1E2",
  "Haas":                               "#DEE1E2",
  "MoneyGram Haas F1 Team":             "#DEE1E2",
  "Williams":                           "#1868DB",
  "Williams Racing":                    "#1868DB",
  "Racing Bulls":                       "#6692FF",
  "RB":                                 "#6692FF",
  "RB F1 Team":                         "#6692FF",
  "Visa Cash App RB":                   "#6692FF",
  "Visa Cash App RB Formula One Team":  "#6692FF",
  "Audi":                               "#FF2D00",
  "Audi F1 Team":                       "#FF2D00",
  "Cadillac":                           "#AAAAAD",
  "Cadillac F1 Team":                   "#AAAAAD",
  "Cadillac Racing":                    "#AAAAAD",
  "Sauber":                             "#FF2D00",
  "Kick Sauber":                        "#FF2D00",
};

const FALLBACK_DRIVERS_2026 = [
  {"acronym":"VER","name":"Max Verstappen","team":"Red Bull Racing","country_code":"NL","color":"#3671C6"},
  {"acronym":"LAW","name":"Liam Lawson","team":"Red Bull Racing","country_code":"NZ","color":"#3671C6"},
  {"acronym":"RUS","name":"George Russell","team":"Mercedes","country_code":"GB","color":"#27F4D2"},
  {"acronym":"ANT","name":"Andrea Kimi Antonelli","team":"Mercedes","country_code":"IT","color":"#27F4D2"},
  {"acronym":"LEC","name":"Charles Leclerc","team":"Ferrari","country_code":"MC","color":"#E8002D"},
  {"acronym":"HAM","name":"Lewis Hamilton","team":"Ferrari","country_code":"GB","color":"#E8002D"},
  {"acronym":"NOR","name":"Lando Norris","team":"McLaren","country_code":"GB","color":"#FF8000"},
  {"acronym":"PIA","name":"Oscar Piastri","team":"McLaren","country_code":"AU","color":"#FF8000"},
  {"acronym":"ALO","name":"Fernando Alonso","team":"Aston Martin","country_code":"ES","color":"#229971"},
  {"acronym":"STR","name":"Lance Stroll","team":"Aston Martin","country_code":"CA","color":"#229971"},
  {"acronym":"GAS","name":"Pierre Gasly","team":"Alpine","country_code":"FR","color":"#00A1E8"},
  {"acronym":"DOO","name":"Jack Doohan","team":"Alpine","country_code":"AU","color":"#00A1E8"},
  {"acronym":"ALB","name":"Alexander Albon","team":"Williams","country_code":"TH","color":"#1868DB"},
  {"acronym":"SAI","name":"Carlos Sainz","team":"Williams","country_code":"ES","color":"#1868DB"},
  {"acronym":"TSU","name":"Yuki Tsunoda","team":"Racing Bulls","country_code":"JP","color":"#6692FF"},
  {"acronym":"HAD","name":"Isack Hadjar","team":"Racing Bulls","country_code":"FR","color":"#6692FF"},
  {"acronym":"HUL","name":"Nico Hulkenberg","team":"Audi","country_code":"DE","color":"#FF2D00"},
  {"acronym":"BOR","name":"Gabriel Bortoleto","team":"Audi","country_code":"BR","color":"#FF2D00"},
  {"acronym":"OCO","name":"Esteban Ocon","team":"Haas","country_code":"FR","color":"#DEE1E2"},
  {"acronym":"BEA","name":"Oliver Bearman","team":"Haas","country_code":"GB","color":"#DEE1E2"}
];

const ACRO_TO_NUM = {
  "NOR": 1, "VER": 3, "BOR": 5, "HAD": 6, "GAS": 10, "PER": 11, "ANT": 12, "ALO": 14,
  "LEC": 16, "STR": 18, "ALB": 23, "HUL": 27, "LAW": 30, "OCO": 31, "LIN": 41, "COL": 43,
  "HAM": 44, "SAI": 55, "RUS": 63, "BOT": 77, "PIA": 81, "BEA": 87, "TSU": 22, "DOO": 61
};

function parseStaticDrivers(driverData) {
  const dict = {};
  const list = Array.isArray(driverData) ? driverData : Object.values(driverData);
  for (const d of list) {
    const acr = d.acronym || d.name_acronym;
    const num = d.number || d.driver_number || ACRO_TO_NUM[acr] || 0;
    const driverObj = {
      acronym: acr,
      name: d.name || d.full_name,
      team: d.team || d.team_name,
      color: d.color || getTeamColor(d.team || d.team_name, d.team_colour),
      country_code: d.country_code,
      number: num,
      driver_number: num
    };
    if (num) {
      dict[num] = driverObj;
      dict[String(num)] = driverObj;
    }
    dict[acr] = driverObj;
  }
  return dict;
}

const CANCELLED_MEETINGS = [
  "bahrain",
  "saudi",
  "jeddah"
];

// ─── Cache session (anti-appel repeated) ─────────────────────────────────────

let _cachedSession    = null;
let _sessionFetchedAt = 0;
const SESSION_CACHE_TTL = 55_000; // 55s

// ─── sessionStorage : persistance entre rechargements ────────────────────────

function ssGet(key) {
  try {
    const raw = sessionStorage.getItem(`f1v7_${key}`);
    if (!raw) return null;
    const { data, expiresAt } = JSON.parse(raw);
    return expiresAt > Date.now() ? data : null;
  } catch { return null; }
}

function ssSet(key, data, ttlMs) {
  try {
    sessionStorage.setItem(`f1v7_${key}`, JSON.stringify({
      data,
      expiresAt: Date.now() + ttlMs,
    }));
  } catch { /* sessionStorage plein ou indisponible */ }
}

function ssClear() {
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith("f1v7_")) sessionStorage.removeItem(k);
    }
  } catch {}
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

const statusEl  = document.getElementById("ws-status");
const offlineEl = document.getElementById("offline-banner");

function setStatus(online, label) {
  if (offlineEl) offlineEl.hidden = online;
}

// ─── apiFetch : requêtes vers le PROXY (jamais vers OpenF1 directement) ───────

async function apiFetch(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal:  AbortSignal.timeout(8_000),
      });
      if (res.status === 502 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(Math.pow(2, attempt) * 1_000);
          continue;
        }
        throw new Error(`HTTP ${res.status} — proxy unreachable`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
      return res.json();
    } catch (e) {
      if (attempt < retries && !e.message?.startsWith("HTTP")) {
        await sleep(Math.pow(2, attempt) * 1_000);
        continue;
      }
      throw e;
    }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function findColor(teamName) {
  if (!teamName) return "#888888";
  if (TEAM_COLORS[teamName]) return TEAM_COLORS[teamName];
  for (const [key, val] of Object.entries(TEAM_COLORS)) {
    if (teamName.includes(key) || key.includes(teamName)) return val;
  }
  return "#888888";
}

function getTeamColor(teamName, rawColour) {
  if (rawColour) {
    const hex = rawColour.startsWith("#") ? rawColour : `#${rawColour}`;
    if (hex !== "#000000" && hex !== "#ffffff") return hex;
  }
  return findColor(teamName);
}

// ─── 1. DONNÉES STATIQUES ─────────────────────────────────────────────────────

export function applyStaticPayloadToStore(sd) {
  if (!sd || !Array.isArray(sd.calendar) || sd.calendar.length === 0) return false;

  const driversDict = parseStaticDrivers(sd.drivers || FALLBACK_DRIVERS_2026);
  const patch = {
    calendar: sd.calendar,
    drivers_standings: sd.drivers_standings || FALLBACK_DRIVERS_STANDINGS,
    teams_standings: sd.teams_standings || FALLBACK_TEAMS_STANDINGS,
    drivers: driversDict,
    teams_meta: sd.teams || null,
    circuits_meta: sd.circuits || null,
    drivers_meta: sd.drivers || null,
    last_race: sd.last_race || null,
    season_results: sd.season_results || null,
    _standings_updated_at: Math.floor(Date.now() / 1000),
  };

  updateStore(patch);
  ssSet("static_data", patch, 2 * 3600 * 1000);
  return true;
}

export async function loadStaticData() {
  setStatus(false, "● Chargement…");

  // 1. SessionStorage si déjà présent
  const cachedStatic = ssGet("static_data");
  if (cachedStatic) {
    updateStore(cachedStatic);
    setStatus(true, "● EN LIGNE");
    console.info(`[api] Données statiques depuis sessionStorage (${cachedStatic.calendar?.length ?? 0} GPs)`);
    setTimeout(refreshStaticDataBackground, 200);
    return;
  }

  // 2. Chargement instantané en amont depuis FastAPI (/api/static, < 30ms)
  try {
    const sd = await apiFetch(window.location.origin + '/api/static', 1);
    if (applyStaticPayloadToStore(sd)) {
      setStatus(true, "● EN LIGNE");
      console.info(`[api] Données chargées en amont avec succès : ${sd.calendar.length} GPs, ${sd.drivers_standings?.length ?? 0} pilotes`);
      // Synchronisation réseau Jolpica / OpenF1 non bloquante en arrière-plan
      setTimeout(refreshStaticDataBackground, 500);
      return;
    }
  } catch (err) {
    console.warn("[api] /api/static indisponible au démarrage :", err.message);
  }

  // 3. Fallback réseau si /api/static n'a pas répondu
  await fetchAndStoreStaticData();
}

async function fetchAndStoreStaticData() {
  const [meetingsRes, sessionsRes] = await Promise.allSettled([
    apiFetch(`${OPENF1}/meetings?year=${YEAR}`),
    apiFetch(`${OPENF1}/sessions?year=${YEAR}`),
  ]);

  const meetingsData = meetingsRes.status === "fulfilled" ? meetingsRes.value : [];
  const sessionsData = sessionsRes.status === "fulfilled" ? sessionsRes.value : [];

  // Classements Jolpica
  const [driverStandings, teamStandings] = await Promise.allSettled([
    apiFetch(`${JOLPICA}/${YEAR}/driverStandings/?format=json`),
    apiFetch(`${JOLPICA}/${YEAR}/constructorStandings/?format=json`),
  ]);
  const dsData = driverStandings.status === "fulfilled" ? driverStandings.value : null;
  const tsData = teamStandings.status   === "fulfilled" ? teamStandings.value   : null;

  const calendar = buildCalendar(meetingsData, sessionsData);

  // Enrichissement circuit_id depuis le mapping location (OpenF1) → Ergast
  const _CMAP = {"Melbourne":{"id":"albert_park","laps":58,"length_km":5.278,"first_gp":1996},"Shanghai":{"id":"shanghai","laps":56,"length_km":5.451,"first_gp":2004},"Suzuka":{"id":"suzuka","laps":53,"length_km":5.807,"first_gp":1987},"Sakhir":{"id":"bahrain","laps":57,"length_km":5.412,"first_gp":2004},"Bahrain":{"id":"bahrain","laps":57,"length_km":5.412,"first_gp":2004},"Jeddah":{"id":"jeddah","laps":50,"length_km":6.174,"first_gp":2021},"Miami":{"id":"miami","laps":57,"length_km":5.412,"first_gp":2022},"Monaco":{"id":"monaco","laps":78,"length_km":3.337,"first_gp":1950},"Montreal":{"id":"villeneuve","laps":70,"length_km":4.361,"first_gp":1978},"Barcelona":{"id":"catalunya","laps":66,"length_km":4.657,"first_gp":1991},"Spielberg":{"id":"red_bull_ring","laps":71,"length_km":4.318,"first_gp":1970},"Silverstone":{"id":"silverstone","laps":52,"length_km":5.891,"first_gp":1950},"Spa-Francorchamps":{"id":"spa","laps":44,"length_km":7.004,"first_gp":1950},"Budapest":{"id":"hungaroring","laps":70,"length_km":4.381,"first_gp":1986},"Zandvoort":{"id":"zandvoort","laps":72,"length_km":4.259,"first_gp":1952},"Monza":{"id":"monza","laps":53,"length_km":5.793,"first_gp":1950},"Baku":{"id":"baku","laps":51,"length_km":6.003,"first_gp":2017},"Singapore":{"id":"marina_bay","laps":62,"length_km":5.063,"first_gp":2008},"Austin":{"id":"americas","laps":56,"length_km":5.513,"first_gp":2012},"Mexico City":{"id":"rodriguez","laps":71,"length_km":4.304,"first_gp":1963},"São Paulo":{"id":"interlagos","laps":71,"length_km":4.309,"first_gp":1973},"Las Vegas":{"id":"vegas","laps":50,"length_km":6.201,"first_gp":2023},"Lusail":{"id":"losail","laps":57,"length_km":5.38,"first_gp":2021},"Yas Island":{"id":"yas_marina","laps":58,"length_km":5.281,"first_gp":2009}};
  for (const gp of calendar) {
    const _m = _CMAP[gp.circuit] || {};
    gp.circuit_id        = _m.id        || null;
    gp.circuit_laps      = _m.laps      || null;
    gp.circuit_length_km = _m.length_km || null;
    gp.circuit_first_gp  = _m.first_gp  || null;
  }

  // Enrichissement depuis /api/static (FastAPI) quand OpenF1 est bloque
  let _staticCalendar = null;
  let _staticDrStandings = null;
  let _staticTmStandings = null;
  let _staticDrivers = null;
  let _staticTeams = null;
  let _staticCircuits = null;
  let _lastRace = null;
  let _seasonResults = null;
  try {
    const _sd = await apiFetch(window.location.origin + '/api/static');
    if (_sd && Array.isArray(_sd.calendar) && _sd.calendar.length > 0) {
      _staticCalendar = _sd.calendar;
      _staticDrStandings = _sd.drivers_standings || null;
      _staticTmStandings = _sd.teams_standings   || null;
      _staticDrivers = _sd.drivers || null;
      _staticTeams = _sd.teams || null;
      _staticCircuits = _sd.circuits || null;
      _lastRace = _sd.last_race || null;
      _seasonResults = _sd.season_results || null;
      console.info('[api] /api/static OK - ' + _staticCalendar.length + ' GPs statiques 2026');
    }
  } catch (_se) {
    console.warn('[api] /api/static indisponible :', _se.message);
  }

  // ── Mise en cache de la dernière session valide (Live ou Archive) ─────────
  // Filtre : session passée ou en cours + non annulée + session_key valide
  if (!_cachedSession && sessionsData.length > 0) {
    const nowIso = new Date().toISOString();
    const latestSession = [...sessionsData]
      .filter(s =>
        s.session_key  > 0 &&
        s.date_start  <= nowIso &&
        s.is_cancelled !== true &&
      !CANCELLED_MEETINGS.some(c => (s.meeting_name || "").toLowerCase().includes(c))
      )
      .sort((a, b) => new Date(b.date_start) - new Date(a.date_start))[0];
    // Enrichir avec le round_number depuis les meetings (pour Jolpica /YEAR/ROUND/results)
    // CORRECTION : exclure Pre-Season Testing (pas des rounds au sens Jolpica/Ergast)
    if (latestSession && meetingsData.length > 0) {
      const sortedMtg = [...meetingsData]
            .filter(m => !(m.meeting_name || '').toLowerCase().includes('testing'))
            .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
      const idx = sortedMtg.findIndex(m => m.meeting_key === latestSession.meeting_key);
      if (idx >= 0) latestSession.round_number = idx + 1;
    }
    _cachedSession    = latestSession || FALLBACK_SESSION;
    _sessionFetchedAt = Date.now();
    console.info(`[api] Session mise en cache : ${_cachedSession.session_name} #${_cachedSession.session_key} round=${_cachedSession.round_number ?? "?"}`);
  }

  // Pilotes de la session archivée
  let driversDict = {};
  if (_cachedSession) {
    try {
      const rawDrivers = await apiFetch(`${OPENF1}/drivers?session_key=${_cachedSession.session_key}`);
      driversDict = buildDriversDict(rawDrivers);
      console.info(`[api] ${Object.keys(driversDict).length} pilotes chargés`);
    } catch (e) {
      console.warn("[api] Pilotes : HTTP 502 — proxy unreachable");
      driversDict = parseStaticDrivers(typeof _staticDrivers !== 'undefined' && _staticDrivers ? _staticDrivers : FALLBACK_DRIVERS_2026);
    }
  } else {
    driversDict = parseStaticDrivers(typeof _staticDrivers !== 'undefined' && _staticDrivers ? _staticDrivers : FALLBACK_DRIVERS_2026);
  }

  // Classements
  const dsList = dsData?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
  const drivers_standings = dsList.length > 0
    ? dsList.map((s, i) => ({
        position: parseInt(s.position) || i + 1,
        name:     `${s.Driver.givenName} ${s.Driver.familyName}`,
        acronym:  s.Driver.code || s.Driver.familyName.slice(0, 3).toUpperCase(),
        team:     s.Constructors?.[0]?.name || "—",
        points:   parseFloat(s.points)  || 0,
        wins:     parseInt(s.wins)      || 0,
        nationality: s.Driver.nationality || "",
      }))
    : FALLBACK_DRIVERS_STANDINGS;

  const tsList = tsData?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
  const teams_standings = tsList.length > 0
    ? tsList.map((s, i) => ({
        position:    parseInt(s.position) || i + 1,
        name:        s.Constructor.name,
        nationality: s.Constructor.nationality || "",
        points:      parseFloat(s.points) || 0,
        wins:        parseInt(s.wins)     || 0,
      }))
    : FALLBACK_TEAMS_STANDINGS;

  let lr = typeof _lastRace !== 'undefined' && _lastRace ? _lastRace : null;
  if (!lr && drivers_standings && drivers_standings.length >= 3) {
    lr = {
      raceName: "Dernier Grand Prix (Fallback)",
      results: drivers_standings.slice(0, 3).map(s => ({
        position: s.position,
        Driver: { givenName: s.name.split(' ')[0], familyName: s.name.split(' ').slice(1).join(' ') },
        Constructor: { name: s.team }
      }))
    };
  }

  const patch = {
    calendar: typeof _staticCalendar !== 'undefined' && _staticCalendar ? _staticCalendar : calendar,
    drivers_standings: typeof _staticDrStandings !== 'undefined' && _staticDrStandings ? _staticDrStandings : drivers_standings,
    teams_standings: typeof _staticTmStandings !== 'undefined' && _staticTmStandings ? _staticTmStandings : teams_standings,
    drivers: driversDict,
    teams_meta: _staticTeams || null,
    circuits_meta: _staticCircuits || null,
    drivers_meta: _staticDrivers || null,
    last_race: lr,
    season_results: typeof _seasonResults !== 'undefined' && _seasonResults ? _seasonResults : null,
    _standings_updated_at: Math.floor(Date.now() / 1000),
  };

  updateStore(patch);
  ssSet("static_data", patch, 2 * 3600 * 1000);
  setStatus(true, "● EN LIGNE");
  console.info(`[api] Statiques OK — ${calendar.length} GPs, ${drivers_standings.length} pilotes classement`);
}

async function refreshStaticDataBackground() {
  try {
    await fetchAndStoreStaticData();
    console.info("[api] Données statiques rafraîchies en arrière-plan");
  } catch (e) {
    console.warn("[api] Refresh arrière-plan échoué :", e.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDriversDict(rawDrivers) {
  const dict = {};
  for (const d of rawDrivers) {
    if (!d.driver_number) continue;
    dict[d.driver_number] = {
      name:    d.full_name || `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || `Pilote #${d.driver_number}`,
      acronym: d.name_acronym || "???",
      number:  d.driver_number,
      team:    d.team_name || "—",
      color:   getTeamColor(d.team_name, d.team_colour),
      flag:    isoToFlag(d.country_code),
      country_code: d.country_code || "",
    };
  }
  return dict;
}

function buildCalendar(meetings, sessions) {
  if (!meetings.length) return [];
  const byMeeting = {};
  for (const s of sessions) {
    if (!byMeeting[s.meeting_key]) byMeeting[s.meeting_key] = [];
    byMeeting[s.meeting_key].push({
      name: s.session_name, date: s.date_start, type: s.session_type,
    });
  }
  return meetings
    .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
    .map((m, i) => {
      const gpSessions = (byMeeting[m.meeting_key] || []).sort((a, b) => new Date(a.date) - new Date(b.date));
      const cancelled  = CANCELLED_MEETINGS.some(c => (m.meeting_name || "").toLowerCase().includes(c));
      return {
        round:        i + 1,
        name:         m.meeting_name,
        circuit:      m.location,
        country:      m.country_name,
        country_code: m.country_code || "",
        date_start:   m.date_start,
        date_end:     m.date_end,
        sessions:     gpSessions,
        sprint: gpSessions.some(s => s.type?.toLowerCase().includes('sprint')),
        cancelled,
        cancel_reason: cancelled ? "Annulé — raisons géopolitiques (avril 2026)" : null,
        meeting_key:  m.meeting_key,
      };
    });
}

// ─── 2. SESSION ───────────────────────────────────────────────────────────────

/**
 * getLatestSession()
 * Récupère la dernière session réelle terminée depuis le proxy.
 * Filtre : passée dans le temps + non annulée + ayant des données (session_key valide).
 * Utilise _cachedSession si valide et récent (< SESSION_CACHE_TTL).
 * Alias public utilisé par watchSessionState.
 */
async function getLatestSession() {
  // Retourner le cache si encore frais
  if (_cachedSession && (Date.now() - _sessionFetchedAt) < SESSION_CACHE_TTL) {
    return _cachedSession;
  }

  try {
    const year = new Date().getFullYear();
    const sessionsData = await apiFetch(`${OPENF1}/sessions?year=${year}`);

    if (!Array.isArray(sessionsData) || sessionsData.length === 0) {
      console.warn("[api] getLatestSession : liste de sessions vide, fallback");
      return _cachedSession || FALLBACK_SESSION;
    }

    const now = new Date().toISOString();

    // Filtre 1 : sessions dont la date de début est passée
    // Filtre 2 : non annulées (par nom de meeting ou flag is_cancelled)
    // Filtre 3 : session_key doit exister et être > 0
    const validSessions = sessionsData.filter(s => {
      if (!s.session_key || s.session_key <= 0)       return false;
      if (!s.date_start || s.date_start > now)         return false;
      if (s.is_cancelled === true)                      return false;
      if (CANCELLED_MEETINGS.some(c => (s.meeting_name || "").toLowerCase().includes(c))) return false;
      return true;
    });

    if (validSessions.length === 0) {
      console.warn("[api] getLatestSession : aucune session valide trouvée, fallback");
      return _cachedSession || FALLBACK_SESSION;
    }

    // Trier par date_start décroissant → la plus récente en premier
    validSessions.sort((a, b) => new Date(b.date_start) - new Date(a.date_start));

    const best = validSessions[0];
    _cachedSession    = best;
    _sessionFetchedAt = Date.now();
    console.info(`[api] getLatestSession → ${best.session_name} #${best.session_key} (${best.location ?? ""})`);
    return best;

  } catch (e) {
    console.warn("[api] getLatestSession erreur :", e.message, "— fallback");
    return _cachedSession || FALLBACK_SESSION;
  }
}

function isSessionLive(session) {
  if (!session) return false;
  const now   = Date.now();
  const start = new Date(session.date_start).getTime();
  const end   = session.date_end
    ? new Date(session.date_end).getTime()
    : start + 3 * 3600 * 1000;
  // Fenêtre : 5 min avant le début, 30 min après la fin prévue
  return now >= start - 5 * 60 * 1000 && now <= end + 30 * 60 * 1000;
}

/**
 * isSessionPreparing()
 * Detecte si on est dans les 15 minutes AVANT le debut d'une session
 * mais pas encore dans la fenetre live (5 min avant).
 */
function isSessionPreparing(session) {
  if (!session) return false;
  const now   = Date.now();
  const start = new Date(session.date_start).getTime();
  return now >= start - 15 * 60 * 1000 && now < start - 5 * 60 * 1000;
}

/**
 * getNextUpcomingSession()
 * Cherche la prochaine session qui commence dans les 15 prochaines minutes.
 * Different de getLatestSession() qui ne retourne que des sessions passees.
 */
async function getNextUpcomingSession() {
  try {
    const year = new Date().getFullYear();
    const sessionsData = await apiFetch(`${OPENF1}/sessions?year=${year}`);
    if (!Array.isArray(sessionsData) || sessionsData.length === 0) return null;

    const now = Date.now();
    // Sessions qui commencent dans les 15 prochaines minutes
    const upcoming = sessionsData.filter(s => {
      if (!s.session_key || s.session_key <= 0) return false;
      if (!s.date_start) return false;
      if (s.is_cancelled === true) return false;
      if (CANCELLED_MEETINGS.some(c => (s.meeting_name || "").toLowerCase().includes(c))) return false;
      const start = new Date(s.date_start).getTime();
      return start > now && start <= now + 15 * 60 * 1000;
    });

    if (upcoming.length === 0) return null;
    upcoming.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
    console.info(`[api] Session a venir detectee : ${upcoming[0].session_name} #${upcoming[0].session_key} dans ${Math.round((new Date(upcoming[0].date_start).getTime() - now) / 60000)} min`);
    return upcoming[0];
  } catch (e) {
    console.warn("[api] getNextUpcomingSession erreur :", e.message);
    return null;
  }
}

// ─── 3. MODE ARCHIVE ──────────────────────────────────────────────────────────

export async function loadArchiveSession() {
  const session = _cachedSession || FALLBACK_SESSION;
  const key     = session.session_key;

  // Rendu immédiat des standings de fallback (CHARGEMENT...) pour éviter l'écran noir
  const initialFallback = buildLiveFallbackStandings("archive");
  updateStore({
    sessionMode: "archive",
    _archive:    true,
    session: {
      session_key:  key,
      session_name: session.session_name,
      session_type: session.session_type,
      circuit_name:       session.circuit_short_name || session.location || "—",
      circuit_short_name: session.circuit_short_name || session.location || "—",
      location:           session.location || "",
      country_code:       session.country_code || "",
      track_status:       "1",
    },
    standings: initialFallback,
  });

  const cached = ssGet(`archive_${key}`);
  if (cached && cached.standings && cached.standings.length > 0) {
    console.info(`[api] Archive depuis sessionStorage — ${cached.standings.length} pilotes`);
    updateStore(cached);
    setStatus(true, "● ARCHIVE");
    // Refresh silencieux
    fetchArchiveData(session).then(patch => {
      if (patch && patch.standings && patch.standings.length > 0) {
        updateStore(patch);
        ssSet(`archive_${key}`, patch, 30 * 60 * 1000);
      }
    }).catch(() => {});
    return;
  }

  setStatus(false, "● ARCHIVE — chargement…");
  console.info(`[api] Archive : ${session.session_name} — session_key=${key}`);

  try {
    const patch = await fetchArchiveData(session);
    if (patch && patch.standings && patch.standings.length > 0) {
      updateStore(patch);
      ssSet(`archive_${key}`, patch, 30 * 60 * 1000);
      console.info(`[api] Archive chargée : ${patch.standings.length} pilotes`);
      setStatus(true, "● ARCHIVE");
    } else {
      setStatus(true, "● ARCHIVE (STREAM)");
      console.warn("[api] L'API OpenF1 est restreinte ou injoignable, passage en streaming direct via WebSocket.");
    }
  } catch (e) {
    setStatus(false, "● ERREUR RÉSEAU");
    console.error("[api] fetchArchiveData erreur:", e.message);
  }
}

async function fetchArchiveData(session) {
  const key        = session.session_key;
  const meetingKey = session.meeting_key;

  // ── Fetch toutes les sources en parallèle ─────────────────────────────────
  // CORRECTION : on récupère aussi intervals pour les positions sur la carte
  //              et on tente Jolpica /results avec le round de la session
  const sessionRound = session.round_number || session.round || null;

  const [posRes, rcRes, wxRes, stintsRes, lapsRes, driversRes, intervalsRes, jolpicaRes] =
    await Promise.allSettled([
      apiFetch(`${PROXY}/api/last-positions?session_key=${key}`),
      apiFetch(`${OPENF1}/race_control?session_key=${key}`),
      apiFetch(`${OPENF1}/weather?session_key=${key}`),
      apiFetch(`${OPENF1}/stints?session_key=${key}`),
      apiFetch(`${OPENF1}/laps?session_key=${key}`),
      apiFetch(`${OPENF1}/drivers?session_key=${key}`),
      apiFetch(`${OPENF1}/intervals?session_key=${key}`),
      // Résultats officiels FIA via Jolpica — essaye d'abord par round si connu
      sessionRound
        ? apiFetch(`${JOLPICA}/${YEAR}/${sessionRound}/results/?format=json`).catch(() =>
            apiFetch(`${JOLPICA}/${YEAR}/results/?format=json&limit=100`).catch(() => null))
        : apiFetch(`${JOLPICA}/${YEAR}/results/?format=json&limit=100`).catch(() => null),
    ]);

  const positions  = posRes.status       === "fulfilled" ? (posRes.value       || []) : [];
  const rcMessages = rcRes.status        === "fulfilled" ? (rcRes.value        || []) : [];
  const weatherArr = wxRes.status        === "fulfilled" ? (wxRes.value        || []) : [];
  const stints     = stintsRes.status    === "fulfilled" ? (stintsRes.value    || []) : [];
  const laps       = lapsRes.status      === "fulfilled" ? (lapsRes.value      || []) : [];
  const drivers    = driversRes.status   === "fulfilled" ? (driversRes.value   || []) : [];
  const intervals  = intervalsRes.status === "fulfilled" ? (intervalsRes.value || []) : [];
  const jolpicaRaw = jolpicaRes.status   === "fulfilled" ? jolpicaRes.value            : null;

  // ── Dictionnaire pilotes ──────────────────────────────────────────────────
  let driversDict = store.drivers || {};
  if (drivers.length > 0) {
    driversDict = buildDriversDict(drivers);
    updateStore({ drivers: driversDict });
  }

  const wx = weatherArr.at(-1) || {};

  // ── Positions GPS finales par pilote (pour la CARTE) ──────────────────────
  // On prend la DERNIÈRE position valide (non-snapping) de chaque pilote.
  // C'est indépendant du classement officiel.
  const lastGpsPos = {};
  for (const p of positions) {
    if (p.x === 0 && p.y === 0) continue; // filtre anti-snapping
    if (!p.driver_number) continue;
    const existing = lastGpsPos[p.driver_number];
    // Garder la plus récente (date ou index dans le tableau)
    if (!existing || new Date(p.date) > new Date(existing.date)) {
      lastGpsPos[p.driver_number] = p;
    }
  }
  console.info(`[api] Archive GPS : ${Object.keys(lastGpsPos).length} pilotes avec position`);

  // ── Classement officiel Jolpica (résultats FIA avec pénalités) ────────────
  // Jolpica /YEAR/ROUND/results → résultat exact de cette course
  // Jolpica /YEAR/results → toutes les courses, on cherche par date ou lieu
  let officialResults = null; // Map driver_number → { position, gap, status, points }
  try {
    // Si on a un round direct, jolpicaRaw est déjà le bon round
    let races = jolpicaRaw?.MRData?.RaceTable?.Races || [];

    // Cas 1 : route directe /YEAR/ROUND/results → Races contient 1 entrée
    if (races.length === 1 && races[0]?.Results?.length > 0) {
      // Bingo : résultat de la course exacte
    } else {
      // Cas 2 : route /YEAR/results → chercher la bonne course
      const sessionDate = (session.date_start || "").slice(0, 10); // "2026-03-29"
      const loc = (session.location || session.circuit_short_name || "").toLowerCase();

      const matchedRace =
        races.find(r => r.date === sessionDate) ||
        races.find(r => loc.length >= 4 && (r.raceName || "").toLowerCase().includes(loc.slice(0, 4))) ||
        races.find(r => loc.length >= 4 && (r.Circuit?.Location?.locality || "").toLowerCase().includes(loc.slice(0, 4)));

      races = matchedRace ? [matchedRace] : [];
    }

    if (races.length > 0 && races[0].Results?.length > 0) {
      officialResults = new Map();
      for (const r of races[0].Results) {
        const num = parseInt(r.number, 10);
        if (!num) continue;
        officialResults.set(num, {
          position: parseInt(r.position, 10) || 0,
          gap:      r.Time?.time || (r.position > 1 ? r.status : "") || "",
          status:   r.status || "",
          points:   parseFloat(r.points) || 0,
        });
      }
      const _winner = races[0].Results.find(r => parseInt(r.position) === 1);
      if (_winner?.Time?.time) updateStore({ _raceTotalTime: _winner.Time.time });
      console.info(`[api] Classement officiel Jolpica OK : ${officialResults.size} pilotes`);
    } else {
      console.warn("[api] Jolpica : aucun résultat de course trouvé pour cette session");
    }
  } catch (e) {
    console.warn("[api] Jolpica results parse error:", e.message);
  }

  // ── Classement GPS de base (pour les coordonnées x,y seulement) ───────────
  // On passe intervals pour avoir les positions intermédiaires
  const gpsStandings = buildStandings(positions, intervals, stints, laps, driversDict);

  // ── Fusion : classement officiel FIA (positions + gaps) + GPS (x,y carte) ──
  let standings;

  if (officialResults && officialResults.size > 0) {
    // Construire les standings à partir des résultats officiels Jolpica
    // et enrichir avec les coordonnées GPS pour la carte
    standings = [];

    for (const [num, off] of officialResults) {
      const info      = driversDict[num] || driversDict[String(num)] || {};
      const gpsDriver = gpsStandings.find(d => d.driver_number === num);
      const gps       = lastGpsPos[num] || lastGpsPos[String(num)] || {};
      const stint     = gpsDriver?.compound ? gpsDriver : {};
      const isRetired = ["Retired","DNF","DSQ","EX","NC"].some(s =>
        off.status.toUpperCase().includes(s.toUpperCase()));

      standings.push({
        // Infos pilote
        driver_number:   num,
        acronym:         info.acronym      || gpsDriver?.acronym  || `#${num}`,
        team_color:      info.color        || gpsDriver?.team_color || "#888",
        team:            info.team         || gpsDriver?.team      || "—",
        name:            info.name         || gpsDriver?.name      || `Pilote ${num}`,
        flag:            info.flag         || gpsDriver?.flag      || "",
        country_code:    info.country_code || gpsDriver?.country_code || "",
        // Classement officiel FIA (pénalités incluses)
        position:        off.position,
        gap_to_leader:   off.position === 1
          ? "LEADER"
          : (off.gap
              ? (String(off.gap).startsWith("+") ? off.gap : `+${off.gap}`)
              : (gpsDriver?.gap_to_leader || "")),
        retired:         isRetired,
        official_points: off.points,
        // Télémétrie (GPS pour la carte)
        x:               gps.x || 0,
        y:               gps.y || 0,
        // Infos pneu depuis la télémétrie
        compound:        gpsDriver?.compound || "UNKNOWN",
        tyre_age:        gpsDriver?.tyre_age || 0,
        // Infos temps au tour depuis la télémétrie
        last_lap_time:   gpsDriver?.last_lap_time || "",
        sector_1:        gpsDriver?.sector_1 || "",
        sector_2:        gpsDriver?.sector_2 || "",
        sector_3:        gpsDriver?.sector_3 || "",
        best_lap:        gpsDriver?.best_lap || false,
        lap_number:      gpsDriver?.lap_number || 0,
        in_pit:          false,
        drs_open:        false,
      });
    }

    // Ajouter les pilotes manquants de driversDict (qui ne sont pas dans officialResults)
    const seenNumbers = new Set(officialResults.keys());
    const fallbackList = Object.keys(driversDict).length > 0 
      ? Object.values(driversDict)
      : parseStaticDrivers(FALLBACK_DRIVERS_2026);
      
    const uniqueDrivers = [];
    const seenAcro = new Set();
    for (const d of Object.values(fallbackList)) {
      if (d && d.acronym && !seenAcro.has(d.acronym)) {
        seenAcro.add(d.acronym);
        uniqueDrivers.push(d);
      }
    }

    let nextPosition = standings.length + 1;
    for (const d of uniqueDrivers) {
      const num = parseInt(d.number || d.driver_number || 0) || ACRO_TO_NUM[d.acronym] || 0;
      if (num && !seenNumbers.has(num)) {
        seenNumbers.add(num);
        const p = nextPosition++;
        standings.push({
          driver_number:   num,
          acronym:         d.acronym || "???",
          team_color:      d.color || d.team_color || "#888888",
          team:            d.team || "—",
          name:            d.name || `Pilote ${p}`,
          flag:            d.flag || "",
          country_code:    d.country_code || "",
          position:        p,
          gap_to_leader:   `+${(p * 1.5).toFixed(3)}`,
          retired:         true,
          official_points: 0,
          x:               0,
          y:               0,
          compound:        "UNKNOWN",
          tyre_age:        0,
          last_lap_time:   "",
          sector_1:        "",
          sector_2:        "",
          sector_3:        "",
          best_lap:        false,
          lap_number:      0,
          in_pit:          false,
          drs_open:        false,
        });
      }
    }

    // Trier par position officielle
    standings.sort((a, b) => {
      if (!a.position && b.position) return  1;
      if (!b.position && a.position) return -1;
      return a.position - b.position;
    });

    console.info(`[api] Archive : classement officiel FIA complété — ${standings.length} pilotes`);
  } else {
    // Fallback : classement GPS (positions finales télémétrie)
    // Enrichir avec les coords GPS directes
    standings = gpsStandings.map(d => {
      const gps = lastGpsPos[d.driver_number] || lastGpsPos[String(d.driver_number)] || {};
      const racePos = parseInt(gps.position) || d.position || 0;
      return {
        ...d,
        position:      racePos,
        gap_to_leader: racePos === 1 ? "LEADER" : d.gap_to_leader,
        x: gps.x || d.x || 0,
        y: gps.y || d.y || 0,
      };
    }).sort((a, b) => {
      if (!a.position && b.position) return  1;
      if (!b.position && a.position) return -1;
      return a.position - b.position;
    });
    console.info("[api] Archive : classement GPS fallback (Jolpica indisponible)");
  }

  // Fallback ultime si standings toujours vides (API 502 de bout en bout)
  if (!standings || standings.length === 0) {
    console.warn("[api] fetchArchiveData : standings vides (API down/502). Reconstitution depuis les pilotes statiques.");
    const fallbackList = Object.keys(driversDict).length > 0 
      ? Object.values(driversDict)
      : parseStaticDrivers(FALLBACK_DRIVERS_2026);
      
    const uniqueDrivers = [];
    const seen = new Set();
    for (const d of Object.values(fallbackList)) {
      if (d && d.acronym && !seen.has(d.acronym)) {
        seen.add(d.acronym);
        uniqueDrivers.push(d);
      }
    }

    // Récupérer les résultats de la course
    const activeRound = session.round_number || session.round || null;
    let matchedRace = null;
    if (store.season_results && Array.isArray(store.season_results)) {
      if (activeRound) {
        matchedRace = store.season_results.find(r => r.round === activeRound);
      }
      if (!matchedRace) {
        const loc = (session.location || session.circuit_short_name || "").toLowerCase();
        matchedRace = store.season_results.find(r => loc.length >= 4 && (
          (r.name || "").toLowerCase().includes(loc.slice(0, 4)) ||
          (r.circuit || "").toLowerCase().includes(loc.slice(0, 4)) ||
          (r.locality || "").toLowerCase().includes(loc.slice(0, 4))
        ));
      }
    }

    const resultsMap = new Map();
    if (matchedRace && Array.isArray(matchedRace.results)) {
      matchedRace.results.forEach(res => {
        if (res.acronym) resultsMap.set(res.acronym.toUpperCase(), res);
        if (res.driver_number) resultsMap.set(String(res.driver_number), res);
      });
    }

    const standingsMap = new Map();
    const activeStandings = (store.drivers_standings && store.drivers_standings.length > 0)
      ? store.drivers_standings
      : FALLBACK_DRIVERS_STANDINGS;
    activeStandings.forEach((s, idx) => {
      const pos = s.position || (idx + 1);
      if (s.acronym) standingsMap.set(s.acronym.toUpperCase(), { position: pos, points: s.points || 0 });
    });

    uniqueDrivers.sort((a, b) => {
      const aAcro = (a.acronym || "").toUpperCase();
      const bAcro = (b.acronym || "").toUpperCase();
      const aNumStr = String(a.driver_number || a.number || "");
      const bNumStr = String(b.driver_number || b.number || "");

      if (resultsMap.size > 0) {
        const aRes = resultsMap.get(aAcro) || resultsMap.get(aNumStr);
        const bRes = resultsMap.get(bAcro) || resultsMap.get(bNumStr);
        if (aRes && bRes) return aRes.position - bRes.position;
        if (aRes) return -1;
        if (bRes) return 1;
      }

      const aStd = standingsMap.get(aAcro);
      const bStd = standingsMap.get(bAcro);
      if (aStd && bStd) return aStd.position - bStd.position;
      if (aStd) return -1;
      if (bStd) return 1;

      return aAcro.localeCompare(bAcro);
    });

    standings = uniqueDrivers.map((d, index) => {
      const p = index + 1;
      const num = parseInt(d.number || d.driver_number || 0) || ACRO_TO_NUM[d.acronym] || (100 + p);
      
      const dAcro = (d.acronym || "").toUpperCase();
      const dNumStr = String(num);
      const realRes = resultsMap.get(dAcro) || resultsMap.get(dNumStr);

      const pos = realRes ? realRes.position : p;
      const gap = realRes ? (realRes.position === 1 ? "LEADER" : (realRes.time || realRes.status || `+${(pos * 1.5).toFixed(3)}`)) : (p === 1 ? "LEADER" : `+${(p * 1.5).toFixed(3)}`);
      const isRetired = realRes ? ["Retired","DNF","DSQ","EX","NC"].some(s => (realRes.status || "").toUpperCase().includes(s)) : false;
      const points = realRes ? (realRes.points || 0) : (pos <= 10 ? [25, 18, 15, 12, 10, 8, 6, 4, 2, 1][pos - 1] : 0);

      return {
        driver_number:   num,
        acronym:         d.acronym || "???",
        team_color:      d.color || d.team_color || "#888888",
        team:            d.team || "—",
        name:            d.name || `Pilote ${pos}`,
        flag:            d.flag || "",
        country_code:    d.country_code || "",
        position:        pos,
        gap_to_leader:   gap,
        retired:         isRetired,
        official_points: points,
        x:               0,
        y:               0,
        compound:        "SOFT",
        tyre_age:        5,
        last_lap_time:   "",
        sector_1:        "",
        sector_2:        "",
        sector_3:        "",
        best_lap:        false,
        lap_number:      10,
        in_pit:          false,
        drs_open:        false,
      };
    });

    standings.sort((a, b) => {
      if (!a.position && b.position) return  1;
      if (!b.position && a.position) return -1;
      return a.position - b.position;
    });
  }

  const raceControl = [...rcMessages]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 15)
    .map(m => ({
      timestamp: m.date,
      message:   m.message || "",
      flag:      mapRcFlag(m.flag),
      category:  m.category || "",
    }));

  const maxLap = laps.reduce((max, l) => Math.max(max, l.lap_number || 0), 0);

  return {
    sessionMode: "archive",
    _archive:    true,
    session: {
      session_key:  key,
      session_name: session.session_name,
      session_type: session.session_type,
      circuit_name:       session.circuit_short_name || session.location || "—",
      circuit_short_name: session.circuit_short_name || session.location || "—",
      location:           session.location || "",
      country_code:       session.country_code || "",
      track_status:       "1",
      race_total_time:    store._raceTotalTime || null,
      meeting_key:        meetingKey,
      lap_total:          maxLap,
      laps_in_session:    maxLap,
      lap_current:        maxLap,
    },
    standings,
    weather: {
      air_temp:   wx.air_temperature   ?? null,
      track_temp: wx.track_temperature ?? null,
      wind_speed: wx.wind_speed        ?? null,
      rainfall:   (wx.rainfall ?? 0) > 0,
    },
    raceControl,
  };
}

// ─── 3.5. TELEMETRY WEBSOCKET (Backend) ───────────────────────────────────────

let _telemetryWs = null;

// F1 : backoff exponentiel de reconnexion (1s → 60s) pour ne pas marteler le
// backend quand il est down. Réinitialisé à 1s sur chaque ouverture réussie.
const _WS_RECONNECT_BASE = 1000;
const _WS_RECONNECT_MAX  = 60000;
let   _wsReconnectDelay  = _WS_RECONNECT_BASE;

// F3 : le WS est la source primaire du classement. On horodate chaque trame
// reçue ; le polling ne reprend la main sur store.standings que si le WS n'a
// rien emis profitablement depuis _WS_STALE_MS.
const _WS_STALE_MS = 15_000;
let   _wsLastMsgAt = 0;

export function connectTelemetryWs() {
  if (_telemetryWs) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    _telemetryWs = new WebSocket(wsUrl);

    _telemetryWs.addEventListener("open", () => {
      console.info("[api] Telemetry WebSocket connecté (FastAPI)");
      _wsReconnectDelay = _WS_RECONNECT_BASE;   // F1 : reset backoff
      _wsLastMsgAt = Date.now();                 // F3 : WS déclaré primaire dès la connexion
    });

    _telemetryWs.addEventListener("message", evt => {
      try {
        const payload = JSON.parse(evt.data);
        _wsLastMsgAt = Date.now();               // F3 : fraîcheur WS

        // F2 : ne plus tout bloquer derrière un guard sur standings.
        // On forward systématiquement session/weather/raceControl présents,
        // et standings uniquement s'il est non vide (sinon on préserve le store).
        const patch = {};
        if (payload.session)               patch.session     = payload.session;
        if (payload.weather)              patch.weather     = payload.weather;
        if (payload.race_control)         patch.raceControl = payload.race_control;
        if (payload.standings && payload.standings.length > 0) patch.standings = payload.standings;
        if (payload.ingestion_status)     patch.ingestionStatus = payload.ingestion_status;
        if (payload.team_radios && payload.team_radios.length > 0) patch.team_radios = payload.team_radios;
        if (Object.keys(patch).length) updateStore(patch);
      } catch (e) { }
    });

    _telemetryWs.addEventListener("close", () => {
      console.info(`[api] Telemetry WebSocket fermé, reconnexion dans ${Math.round(_wsReconnectDelay / 1000)}s...`);
      _telemetryWs = null;
      const delay = _wsReconnectDelay;
      _wsReconnectDelay = Math.min(_wsReconnectDelay * 2, _WS_RECONNECT_MAX);  // F1 : backoff
      setTimeout(connectTelemetryWs, delay);
    });

    _telemetryWs.addEventListener("error", () => {
      _telemetryWs?.close();
    });
  } catch (e) {
    const delay = _wsReconnectDelay;
    _wsReconnectDelay = Math.min(_wsReconnectDelay * 2, _WS_RECONNECT_MAX);
    setTimeout(connectTelemetryWs, delay);
  }
}

export function disconnectTelemetryWs() {
  if (_telemetryWs) {
    try {
      _telemetryWs.onclose = null;
      _telemetryWs.onerror = null;
      _telemetryWs.close();
    } catch (e) {}
    _telemetryWs = null;
    console.info("[api] Telemetry WebSocket déconnecté");
  }
  _wsReconnectDelay = _WS_RECONNECT_BASE;   // F1 : prêt pour une future reconnexion
  _wsLastMsgAt = 0;                          // F3 : le polling redevient primaire
}

// ─── 4. POLLING LIVE ──────────────────────────────────────────────────────────

let _liveInterval = null;

export async function startLivePolling(sessionKey) {
  stopLivePolling();
  await _pollLive(sessionKey);
  _liveInterval = setInterval(() => _pollLive(sessionKey), 5_000);
  console.info(`[api] Polling live démarré — session ${sessionKey}`);
}

export function stopLivePolling() {
  if (_liveInterval) { clearInterval(_liveInterval); _liveInterval = null; }
}

async function _pollLive(sessionKey) {
  try {
    // Essayer d'abord l'endpoint agrégé (plus efficace, une seule requête)
    let positions = [], rcMessages = [], weatherArr = [], stints = [], intervals = [], laps = [];
    let usedAggregated = false;

    try {
      const liveData = await apiFetch(`${PROXY}/api/live-data?session_key=${sessionKey}`);
      if (liveData && !liveData.error) {
        positions  = liveData.positions  || [];
        rcMessages = liveData.race_control || [];
        weatherArr = liveData.weather    ? [liveData.weather] : [];
        stints     = liveData.stints     || [];
        intervals  = liveData.intervals  || [];
        laps       = liveData.laps       || [];
        usedAggregated = true;
      }
    } catch (_aggErr) {
      // Fallback : requêtes individuelles
    }

    if (!usedAggregated) {
      // Si l'agrégé échoue ou est vide, ne pas spammer les 6 endpoints individuels.
      // Le WebSocket télémétrie FastAPI prend le relais pour les données temps réel.
    }

    const driversDict = store.drivers || {};
    const wx          = Array.isArray(weatherArr) ? weatherArr.at(-1) || {} : weatherArr || {};
    const standings   = buildStandings(positions, intervals, stints, laps, driversDict);
    const raceControl = [...rcMessages]
      .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 15)
      .map(m => ({ timestamp: m.date, message: m.message || "", flag: mapRcFlag(m.flag), category: m.category || "" }));

    // Déterminer le tour en cours
    const maxLap = laps.reduce((max, l) => Math.max(max, l.lap_number || 0), 0);

    // Protection : ne pas écraser des standings valides par une liste vide
    const patch = {
      weather: {
        air_temp:   wx.air_temperature  ?? wx.air_temp ?? null,
        track_temp: wx.track_temperature ?? wx.track_temp ?? null,
        wind_speed: wx.wind_speed        ?? null,
        rainfall:   (wx.rainfall ?? 0) > 0,
      },
      session: {
        ...(store.session || {}),
        lap_current: maxLap || store.session?.lap_current || 0,
      },
    };

    // F3 : si le WS est frais (source primaire enrichie), le polling NE doit PAS
    // écraser store.standings — les deux sources calculent le classement avec des
    // algorithmes différents et se battraient (scintillement). Le polling ne prend
    // la main que si le WS est stale (ou jamais connecté).
    const wsStale = !_wsLastMsgAt || (Date.now() - _wsLastMsgAt > _WS_STALE_MS);
    if (standings.length > 0 && wsStale) {
      patch.standings = standings;
    } else if (wsStale && (!store.standings || store.standings.length === 0)) {
      // Pas de standings existants non plus, mettre un fallback
      patch.standings = buildLiveFallbackStandings();
    }
    // Sinon, garder les standings existants du store (détenus par le WS)

    if (raceControl.length > 0) {
      patch.raceControl = raceControl;
    }

    updateStore(patch);
    setStatus(true, "● EN DIRECT");
  } catch (e) {
    console.warn("[api] Erreur _pollLive :", e.message);
    // Ne pas mettre hors ligne pour une erreur ponctuelle
  }
}

// ─── 5. Construction classement ───────────────────────────────────────────────

function buildStandings(positions, intervals, stints, laps, driversDict) {
  // Dernière position GPS connue par pilote (filtre anti-snapping)
  const lastPos = {};
  for (const p of positions) {
    if (p.x === 0 && p.y === 0) continue;
    lastPos[p.driver_number] = p;
  }

  const lastInterval = {};
  for (const i of intervals) lastInterval[i.driver_number] = i;

  const lastStint = {};
  for (const s of stints) {
    const cur = lastStint[s.driver_number];
    if (!cur || s.stint_number > cur.stint_number) lastStint[s.driver_number] = s;
  }

  const lastLap = {};
  const bestOverall = {}; // meilleur secteur global (purple)
  for (const l of laps) {
    const cur = lastLap[l.driver_number];
    if (!cur || l.lap_number > cur.lap_number) lastLap[l.driver_number] = l;
    // Track best sectors globally
    if (l.duration_sector_1 && (!bestOverall.s1 || l.duration_sector_1 < bestOverall.s1)) bestOverall.s1 = l.duration_sector_1;
    if (l.duration_sector_2 && (!bestOverall.s2 || l.duration_sector_2 < bestOverall.s2)) bestOverall.s2 = l.duration_sector_2;
    if (l.duration_sector_3 && (!bestOverall.s3 || l.duration_sector_3 < bestOverall.s3)) bestOverall.s3 = l.duration_sector_3;
  }

  // Meilleur tour global
  let bestLapTime = Infinity;
  for (const l of Object.values(lastLap)) {
    if (l.lap_duration && l.lap_duration < bestLapTime) bestLapTime = l.lap_duration;
  }

  const allNums = new Set([
    ...Object.keys(lastPos),
    ...Object.keys(lastInterval),
    ...Object.keys(lastStint),
    ...Object.keys(lastLap),
  ]);
  if (allNums.size === 0) return [];

  return [...allNums].map(num => {
    const driverNum  = parseInt(num);
    const pos        = lastPos[num]      || {};
    const inv        = lastInterval[num] || {};
    const stint      = lastStint[num]    || {};
    const lap        = lastLap[num]      || {};
    const driverInfo = driversDict[driverNum] || driversDict[String(driverNum)] || {};
    const tyreAge    = (stint.tyre_age_at_start || 0) + Math.max(0, (lap.lap_number || 0) - (stint.lap_start || 0));

    const s1 = lap.duration_sector_1 || 0;
    const s2 = lap.duration_sector_2 || 0;
    const s3 = lap.duration_sector_3 || 0;

    // Calculer si le secteur est personnel ou globalement le meilleur
    const s1_purple = s1 > 0 && s1 <= (bestOverall.s1 || 0);
    const s2_purple = s2 > 0 && s2 <= (bestOverall.s2 || 0);
    const s3_purple = s3 > 0 && s3 <= (bestOverall.s3 || 0);

    const s1_green = s1 > 0 && !s1_purple;
    const s2_green = s2 > 0 && !s2_purple;
    const s3_green = s3 > 0 && !s3_purple;

    return {
      driver_number:    driverNum,
      acronym:          driverInfo.acronym   || `#${driverNum}`,
      team_color:       driverInfo.color     || "#888888",
      team:             driverInfo.team      || "—",
      name:             driverInfo.name      || `Pilote ${driverNum}`,
      flag:             driverInfo.flag      || "",
      country_code:     driverInfo.country_code || "",
      position:         parseInt(pos.position || inv.position || 0),
      gap_to_leader:    inv.gap_to_leader || "",
      retired:          false,
      compound:         stint.compound || "UNKNOWN",
      tyre_age:         tyreAge,
      last_lap_time:    lap.lap_duration ? String(lap.lap_duration) : "",
      sector_1:         s1 > 0 ? String(s1) : "",
      sector_2:         s2 > 0 ? String(s2) : "",
      sector_3:         s3 > 0 ? String(s3) : "",
      sector_1_purple:  s1_purple,
      sector_1_green:   s1_green,
      sector_2_purple:  s2_purple,
      sector_2_green:   s2_green,
      sector_3_purple:  s3_purple,
      sector_3_green:   s3_green,
      best_lap:         lap.lap_duration && lap.lap_duration <= bestLapTime,
      lap_number:       lap.lap_number || 0,
      in_pit:           false,
      drs_open:         false,
      x:                pos.x || 0,
      y:                pos.y || 0,
    };
  }).sort((a, b) => {
    if (a.position === 0 && b.position !== 0) return  1;
    if (b.position === 0 && a.position !== 0) return -1;
    return a.position - b.position;
  });
}

// ─── 6. Refresh classements championnats ──────────────────────────────────────

export function scheduleStandingsRefresh() {
  // Rafraîchissement toutes les heures (le proxy cache — requête instantanée)
  setInterval(async () => {
    try {
      const [dr, tr] = await Promise.all([
        apiFetch(`${JOLPICA}/${YEAR}/driverStandings/?format=json`),
        apiFetch(`${JOLPICA}/${YEAR}/constructorStandings/?format=json`),
      ]);
      const dsList = dr?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
      const tsList = tr?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
      if (dsList.length) {
        updateStore({
          drivers_standings: dsList.map((s, i) => ({
            position:    parseInt(s.position) || i + 1,
            name:        `${s.Driver.givenName} ${s.Driver.familyName}`,
            acronym:     s.Driver.code || s.Driver.familyName.slice(0, 3).toUpperCase(),
            team:        s.Constructors?.[0]?.name || "—",
            points:      parseFloat(s.points) || 0,
            wins:        parseInt(s.wins)     || 0,
            nationality: s.Driver.nationality || "",
          })),
          teams_standings: tsList.map((s, i) => ({
            position:    parseInt(s.position) || i + 1,
            name:        s.Constructor.name,
            nationality: s.Constructor.nationality || "",
            points:      parseFloat(s.points) || 0,
            wins:        parseInt(s.wins)     || 0,
          })),
          _standings_updated_at: Math.floor(Date.now() / 1000),
        });
        console.info("[api] Classements rafraîchis");
      }
    } catch (e) { console.warn("[api] Échec refresh classements :", e.message); }
  }, 60 * 60 * 1000);
}

// ─── 7. WebSocket push depuis le proxy ───────────────────────────────────────

let _proxyWs       = null;
let _wsRetryDelay  = 5_000;
const WS_MAX_DELAY = 60_000;

function connectProxyWs() {
  const wsUrl = PROXY.replace(/^http/, "ws") + "/ws";
  try {
    _proxyWs = new WebSocket(wsUrl);

    _proxyWs.addEventListener("open", () => {
      console.info("[api] WebSocket proxy connecté");
      _wsRetryDelay = 5_000;
    });

    _proxyWs.addEventListener("message", evt => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.event === "preload_complete") {
          console.info(`[api] Proxy préchargement terminé (session ${msg.sessionKey}) — refresh archive`);
          if ((!store.standings || store.standings.length === 0) && _cachedSession) {
            loadArchiveSession();
          }
        } else if (msg.event === "session_mode_changed") {
          console.info(`[api] Proxy signale changement de mode → ${msg.mode} (session ${msg.sessionKey})`);
          _sessionFetchedAt = 0;
        }
      } catch {}
    });

    _proxyWs.addEventListener("close", () => {
      console.info(`[api] WebSocket proxy fermé — retry dans ${_wsRetryDelay / 1000}s`);
      setTimeout(connectProxyWs, _wsRetryDelay);
      _wsRetryDelay = Math.min(_wsRetryDelay * 2, WS_MAX_DELAY);
    });

    _proxyWs.addEventListener("error", () => {
      _proxyWs?.close();
    });
  } catch {
    setTimeout(connectProxyWs, _wsRetryDelay);
    _wsRetryDelay = Math.min(_wsRetryDelay * 2, WS_MAX_DELAY);
  }
}

// ─── 8. Surveillance live ↔ archive ──────────────────────────────────────────

function buildLiveFallbackStandings(mode = "live") {
  const driversDict = store.drivers && Object.keys(store.drivers).length > 0
    ? store.drivers
    : parseStaticDrivers(FALLBACK_DRIVERS_2026);
    
  const uniqueDrivers = [];
  const seen = new Set();
  for (const d of Object.values(driversDict)) {
    if (d && d.acronym && !seen.has(d.acronym)) {
      seen.add(d.acronym);
      uniqueDrivers.push(d);
    }
  }

  const standingsMap = new Map();
  const activeStandings = (store.drivers_standings && store.drivers_standings.length > 0)
    ? store.drivers_standings
    : FALLBACK_DRIVERS_STANDINGS;
  activeStandings.forEach((s, idx) => {
    const pos = s.position || (idx + 1);
    if (s.acronym) standingsMap.set(s.acronym.toUpperCase(), { position: pos });
  });

  uniqueDrivers.sort((a, b) => {
    const aAcro = (a.acronym || "").toUpperCase();
    const bAcro = (b.acronym || "").toUpperCase();
    const aStd = standingsMap.get(aAcro);
    const bStd = standingsMap.get(bAcro);
    if (aStd && bStd) return aStd.position - bStd.position;
    if (aStd) return -1;
    if (bStd) return 1;
    return aAcro.localeCompare(bAcro);
  });

  const gapLabel = mode === "archive" ? "CHARGEMENT..." : "CONNEXION...";

  return uniqueDrivers.map((d, i) => {
    const num = parseInt(d.number || d.driver_number || 0) || ACRO_TO_NUM[d.acronym] || (100 + i);
    return {
      driver_number: num,
      acronym: d.acronym || "???",
      team_color: d.color || d.team_color || "#888888",
      team: d.team || "—",
      name: d.name || `Pilote`,
      flag: d.flag || "",
      country_code: d.country_code || "",
      position: i + 1,
      gap_to_leader: gapLabel,
      retired: false,
      compound: "",
      tyre_age: 0,
      last_lap_time: "",
      sector_1: "",
      sector_2: "",
      sector_3: "",
      best_lap: false,
      lap_number: 0,
      in_pit: false,
      drs_open: false,
    };
  });
}

export function watchSessionState() {
  let currentState = null;
  let _preparingSessionKey = null;

  let _checkRunning = false;
  const check = async () => {
    if (_checkRunning) return;
    _checkRunning = true;
    try {
      // Respecter le mode forcé manuellement s'il est différent de direct
      // _forcedMode === null signifie "auto" → laisser la logique proxy décider
      if (store._forcedMode && store._forcedMode !== 'live' && store._forcedMode !== 'auto') {
        const targetMode = store._forcedMode;
        if (currentState !== targetMode) {
          console.info(`[api] Mode forcé appliqué sur le client : ${targetMode}`);
          currentState = targetMode;
          _preparingSessionKey = null;
          stopLivePolling();
          if (targetMode === 'archive') {
            disconnectTelemetryWs();
            await loadArchiveSession();
          } else {
            disconnectTelemetryWs();
            ssClear();
          }
        }
        _checkRunning = false;
        return;
      }

      // Mode forcé "live" : forcer l'activation même si le proxy dit archive
      if (store._forcedMode === 'live' && currentState !== 'live') {
        console.info('[api] Mode LIVE forcé par l\'utilisateur');
        const session = await getLatestSession();
        currentState = 'live';
        _preparingSessionKey = null;
        ssClear();

        if (Object.keys(store.drivers || {}).length === 0) {
          try {
            const r = await apiFetch(`${OPENF1}/drivers?session_key=${session.session_key}`);
            updateStore({ drivers: buildDriversDict(r) });
          } catch {
            updateStore({ drivers: parseStaticDrivers(FALLBACK_DRIVERS_2026) });
          }
        }

        const fallbackLiveStandings = buildLiveFallbackStandings();
        updateStore({
          sessionMode: 'live',
          standings:    fallbackLiveStandings,
          raceControl:  [],
          weather:      {},
          _archive:     false,
          session: {
            session_key:  session.session_key,
            session_name: session.session_name,
            session_type: session.session_type,
            circuit_name: session.circuit_short_name || session.location || '\u2014',
            country_code: session.country_code || '',
            track_status: '1',
          },
        });
        connectTelemetryWs();
        startLivePolling(session.session_key);
        setStatus(true, '\u25cf EN DIRECT');
        _checkRunning = false;
        return;
      }

      // ── Priorité 1 : demander l'état au proxy (décision serveur) ─────────
      let proxyState = null;
      try {
        proxyState = await apiFetch(`${PROXY}/api/session-state`);
      } catch (_pe) {
        console.warn('[api] /api/session-state indisponible :', _pe.message);
      }

      // Si le proxy retourne un mode défini, on l'utilise
      if (proxyState && proxyState.mode) {
        let proxyMode = proxyState.mode; // 'live' | 'archive' | 'preparing'
        const activeSession = proxyState.activeSession || proxyState.archiveSession || null;
        const nextSession   = proxyState.nextSession || null;

        // Hardening client : vérifier si le mode 'live' du proxy est valide temporellement
        if (proxyMode === 'live') {
          const sess = proxyState.liveSession || activeSession;
          if (sess && !isSessionLive(sess)) {
            console.warn(`[api] Proxy signale le mode LIVE pour la session #${sess.session_key} (${sess.location}), mais l'heure ne correspond pas. Redirection vers ARCHIVE.`);
            proxyMode = 'archive';
          }
        }

        if (proxyMode === 'live' && currentState !== 'live') {
          const sess = proxyState.liveSession || activeSession;
          if (!sess) { _checkRunning = false; return; }
          console.info('[api] (proxy) Mode LIVE :', sess.session_name, '#' + sess.session_key);
          currentState = 'live';
          _preparingSessionKey = null;
          stopLivePolling();
          ssClear();

          // Charger les pilotes d'abord pour pouvoir construire le standings de fallback
          if (Object.keys(store.drivers || {}).length === 0) {
            try {
              const r = await apiFetch(`${OPENF1}/drivers?session_key=${sess.session_key}`);
              updateStore({ drivers: buildDriversDict(r) });
            } catch {
              console.warn("[api] Pilotes : HTTP 502 — proxy unreachable");
              updateStore({ drivers: parseStaticDrivers(FALLBACK_DRIVERS_2026) });
            }
          }

          const fallbackLiveStandings = buildLiveFallbackStandings();

          updateStore({
            sessionMode: 'live',
            standings:    fallbackLiveStandings,
            raceControl:  [],
            weather:      {},
            _archive:     false,
            session: {
              session_key:  sess.session_key,
              session_name: sess.session_name,
              session_type: sess.session_type,
              circuit_name: sess.circuit_short_name || sess.location || '\u2014',
              country_code: sess.country_code || '',
              track_status: '1',
            },
          });
          // Lancer les DEUX sources de données en parallèle :
          // - WebSocket FastAPI : données enrichies (timing, DRS, secteurs couleur)
          // - Polling OpenF1 via proxy : positions GPS, intervals, laps (backup)
          connectTelemetryWs();
          startLivePolling(sess.session_key);
          setStatus(true, '\u25cf EN DIRECT');
          _checkRunning = false;
          return;

        } else if (proxyMode === 'archive' && currentState !== 'archive' && currentState !== 'preparing') {
          console.info('[api] (proxy) Mode ARCHIVE');
          currentState = 'archive';
          _preparingSessionKey = null;
          stopLivePolling();
          disconnectTelemetryWs();
          await loadArchiveSession();
          _checkRunning = false;
          return;

        } else if (proxyMode === 'preparing' && nextSession) {
          if (currentState !== 'preparing' || _preparingSessionKey !== nextSession.session_key) {
            console.info('[api] (proxy) Mode PREPARING : ', nextSession.session_name, '#' + nextSession.session_key);
            currentState = 'preparing';
            _preparingSessionKey = nextSession.session_key;
            stopLivePolling();
            disconnectTelemetryWs();
            ssClear();
            const startTime = new Date(nextSession.date_start).getTime();
            const minutesLeft = Math.ceil((startTime - Date.now()) / 60000);
            updateStore({
              sessionMode: 'preparing',
              _archive:    false,
              standings:    [],
              raceControl:  [],
              weather:      {},
              session: {
                session_key:        nextSession.session_key,
                session_name:       nextSession.session_name,
                session_type:       nextSession.session_type,
                circuit_name:       nextSession.circuit_short_name || nextSession.location || '\u2014',
                circuit_short_name: nextSession.circuit_short_name || nextSession.location || '\u2014',
                location:           nextSession.location || '',
                country_code:       nextSession.country_code || '',
                track_status:       '1',
                time_remaining:     'D\u00e9but dans ' + minutesLeft + ' min',
                meeting_key:        nextSession.meeting_key,
              },
            });
            setStatus(true, '\u25cf PR\u00c9PARATION');
          } else if (_preparingSessionKey === nextSession.session_key && currentState === 'preparing') {
            // Mise a jour du minuteur seulement
            const startTime = new Date(nextSession.date_start).getTime();
            const minutesLeft = Math.ceil((startTime - Date.now()) / 60000);
            updateStore({ session: { ...(store.session || {}), time_remaining: 'D\u00e9but dans ' + minutesLeft + ' min' } });
          }
          _checkRunning = false;
          return;

        } else if (proxyMode === 'live' && currentState === 'live') {
          // Deja en live, rien a faire
          _checkRunning = false;
          return;
        }
        // Si proxyMode est deja le meme etat, ne rien changer
      }

      // ── Fallback : logique originale basee sur getLatestSession() ────────
      const session = await getLatestSession();
      const live    = isSessionLive(session);

      if (live && currentState !== "live") {
        console.info(`[api] (fallback) Mode LIVE : ${session.session_name} #${session.session_key}`);
        currentState = "live";
        _preparingSessionKey = null;
        stopLivePolling();
        ssClear();
        updateStore({
          sessionMode: "live",
          standings:    [],
          raceControl:  [],
          weather:      {},
          _archive:     false,
          session: {
            session_key:  session.session_key,
            session_name: session.session_name,
            session_type: session.session_type,
            circuit_name: session.circuit_short_name || session.location || "\u2014",
            country_code: session.country_code || "",
            track_status: "1",
          },
        });
        if (Object.keys(store.drivers || {}).length === 0) {
          try {
            const r = await apiFetch(`${OPENF1}/drivers?session_key=${session.session_key}`);
            updateStore({ drivers: buildDriversDict(r) });
          } catch {
            console.warn("[api] Pilotes : HTTP 502 — proxy unreachable");
            updateStore({ drivers: parseStaticDrivers(FALLBACK_DRIVERS_2026) });
          }
        }
        connectTelemetryWs();
        startLivePolling(session.session_key);
        setStatus(true, "\u25cf EN DIRECT");

      } else if (!live) {
        const upcoming = await getNextUpcomingSession();

        if (upcoming && isSessionPreparing(upcoming) && currentState !== "preparing") {
          console.info(`[api] (fallback) Mode PREPARING : ${upcoming.session_name} #${upcoming.session_key}`);
          currentState = "preparing";
          _preparingSessionKey = upcoming.session_key;
          stopLivePolling();
          disconnectTelemetryWs();
          ssClear();

          const startTime = new Date(upcoming.date_start).getTime();
          const minutesLeft = Math.ceil((startTime - Date.now()) / 60000);

          updateStore({
            sessionMode: "preparing",
            _archive:    false,
            standings:    [],
            raceControl:  [],
            weather:      {},
            session: {
              session_key:        upcoming.session_key,
              session_name:       upcoming.session_name,
              session_type:       upcoming.session_type,
              circuit_name:       upcoming.circuit_short_name || upcoming.location || "\u2014",
              circuit_short_name: upcoming.circuit_short_name || upcoming.location || "\u2014",
              location:           upcoming.location || "",
              country_code:       upcoming.country_code || "",
              track_status:       "1",
              time_remaining:     `D\u00e9but dans ${minutesLeft} min`,
              meeting_key:        upcoming.meeting_key,
            },
          });

          try {
            const r = await apiFetch(`${OPENF1}/drivers?session_key=${upcoming.session_key}`);
            if (r && r.length > 0) {
              updateStore({ drivers: buildDriversDict(r) });
            }
          } catch {}

          setStatus(true, "\u25cf PR\u00c9PARATION");

        } else if (upcoming && _preparingSessionKey === upcoming.session_key && currentState === "preparing") {
          const startTime = new Date(upcoming.date_start).getTime();
          const minutesLeft = Math.ceil((startTime - Date.now()) / 60000);
          updateStore({
            session: {
              ...(store.session || {}),
              time_remaining: `D\u00e9but dans ${minutesLeft} min`,
            },
          });

        } else if (currentState !== "archive" && currentState !== "preparing" && (!upcoming || !isSessionPreparing(upcoming))) {
          console.info("[api] (fallback) Mode ARCHIVE (pas de session live)");
          currentState = "archive";
          _preparingSessionKey = null;
          stopLivePolling();
          disconnectTelemetryWs();
          await loadArchiveSession();
        }
      }
    } catch (e) {
      console.warn('[api] check() erreur :', e.message);
    } finally {
      _checkRunning = false;
    }
  };


  connectProxyWs();

  setTimeout(() => {
    check();
    setInterval(check, 30 * 1000);
  }, 1_000);
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function formatGap(val) {
  if (val == null || val === "") return "";
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
  if (n === 0)  return "LEADER";
  return n > 60 ? `+${Math.floor(n / 60)} T` : `+${n.toFixed(3)}`;
}

function formatLapTime(seconds) {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}

function formatSectorTime(seconds) {
  if (!seconds || seconds <= 0) return "";
  return seconds.toFixed(3);
}

function mapRcFlag(flag) {
  const MAP = { GREEN: "GREEN", YELLOW: "YELLOW", RED: "RED", SC: "SC", VSC: "VSC" };
  return MAP[flag?.toUpperCase()] || "";
}

function isoToFlag(code) {
  if (!code || code.length !== 2) return "";
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(c.charCodeAt(0) + 127397))
    .join("");
}

// ─── Fallbacks statiques ──────────────────────────────────────────────────────

const FALLBACK_DRIVERS_STANDINGS = [
  { position: 1,  name: "Kimi Antonelli",    acronym: "ANT", team: "Mercedes",        points: 72,  wins: 2, nationality: "Italian" },
  { position: 2,  name: "George Russell",    acronym: "RUS", team: "Mercedes",        points: 63,  wins: 1, nationality: "British" },
  { position: 3,  name: "Charles Leclerc",   acronym: "LEC", team: "Ferrari",         points: 49,  wins: 0, nationality: "Monegasque" },
  { position: 4,  name: "Lewis Hamilton",    acronym: "HAM", team: "Ferrari",         points: 41,  wins: 0, nationality: "British" },
  { position: 5,  name: "Lando Norris",      acronym: "NOR", team: "McLaren",         points: 25,  wins: 0, nationality: "British" },
  { position: 6,  name: "Oscar Piastri",     acronym: "PIA", team: "McLaren",         points: 21,  wins: 0, nationality: "Australian" },
  { position: 7,  name: "Oliver Bearman",    acronym: "BEA", team: "Haas F1 Team",    points: 17,  wins: 0, nationality: "British" },
  { position: 8,  name: "Pierre Gasly",      acronym: "GAS", team: "Alpine",          points: 15,  wins: 0, nationality: "French" },
  { position: 9,  name: "Max Verstappen",    acronym: "VER", team: "Red Bull Racing", points: 12,  wins: 0, nationality: "Dutch" },
  { position: 10, name: "Liam Lawson",       acronym: "LAW", team: "Racing Bulls",    points: 10,  wins: 0, nationality: "New Zealander" },
  { position: 11, name: "Isack Hadjar",      acronym: "HAD", team: "Red Bull Racing", points: 8,   wins: 0, nationality: "French" },
  { position: 12, name: "Gabriel Bortoleto", acronym: "BOR", team: "Audi",            points: 2,   wins: 0, nationality: "Brazilian" },
  { position: 13, name: "Carlos Sainz Jr.",  acronym: "SAI", team: "Williams",        points: 2,   wins: 0, nationality: "Spanish" },
  { position: 14, name: "Arvid Lindblad",    acronym: "LIN", team: "Racing Bulls",    points: 2,   wins: 0, nationality: "British" },
  { position: 15, name: "Franco Colapinto",  acronym: "COL", team: "Alpine",          points: 1,   wins: 0, nationality: "Argentine" },
  { position: 16, name: "Esteban Ocon",      acronym: "OCO", team: "Haas F1 Team",    points: 0,   wins: 0, nationality: "French" },
  { position: 17, name: "Alexander Albon",   acronym: "ALB", team: "Williams",        points: 0,   wins: 0, nationality: "Thai" },
  { position: 18, name: "Sergio Pérez",      acronym: "PER", team: "Cadillac",        points: 0,   wins: 0, nationality: "Mexican" },
  { position: 19, name: "Valtteri Bottas",   acronym: "BOT", team: "Cadillac",        points: 0,   wins: 0, nationality: "Finnish" },
  { position: 20, name: "Fernando Alonso",   acronym: "ALO", team: "Aston Martin",    points: 0,   wins: 0, nationality: "Spanish" },
  { position: 21, name: "Lance Stroll",      acronym: "STR", team: "Aston Martin",    points: 0,   wins: 0, nationality: "Canadian" },
];

const FALLBACK_TEAMS_STANDINGS = [
  { position: 1,  name: "Mercedes",        nationality: "German",  points: 135, wins: 3 },
  { position: 2,  name: "Ferrari",         nationality: "Italian", points: 90,  wins: 0 },
  { position: 3,  name: "McLaren",         nationality: "British", points: 46,  wins: 0 },
  { position: 4,  name: "Haas F1 Team",    nationality: "American",points: 17,  wins: 0 },
  { position: 5,  name: "Alpine",          nationality: "French",  points: 16,  wins: 0 },
  { position: 6,  name: "Red Bull Racing", nationality: "Austrian",points: 20,  wins: 0 },
  { position: 7,  name: "Racing Bulls",    nationality: "Italian", points: 12,  wins: 0 },
  { position: 8,  name: "Audi",            nationality: "German",  points: 2,   wins: 0 },
  { position: 9,  name: "Williams",        nationality: "British", points: 2,   wins: 0 },
  { position: 10, name: "Cadillac",        nationality: "American",points: 0,   wins: 0 },
  { position: 11, name: "Aston Martin",    nationality: "British", points: 0,   wins: 0 },
];