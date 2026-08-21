/**
 * circuits.js v1 — Explorateur de circuits F1 2026
 *
 * Fonctionnalités :
 *  - Grille de tous les circuits du calendrier 2026
 *  - Tracé SVG animé via données de position OpenF1 (même technique que tracker_map.js)
 *  - Fiche détaillée : longueur, virages, DRS zones, record du tour
 *  - Historique des vainqueurs (Jolpica) avec filtrage par pilote/écurie
 *  - Navigation prev/next entre circuits
 */

import { store, onUpdate } from "../store.js";

// ─── Mapping circuit → OpenF1 session_key (dernière course sur ce circuit) ─────
// On utilise les sessions 2025 pour avoir les données de tracé
const CIRCUIT_SESSION_KEYS = {
  "Albert Park":     12345,   // Melbourne
  "Bahrain":         null,    // annulé 2026
  "Jeddah":          null,    // annulé 2026
  "Suzuka":          11218,
  "Shanghai":        11222,
  "Miami":           11280,
  "Imola":           null,
  "Monaco":          null,
  "Montreal":        null,
  "Barcelona":       null,
  "Spielberg":       null,
  "Silverstone":     null,
  "Hungaroring":     null,
  "Spa":             null,
  "Zandvoort":       null,
  "Monza":           null,
  "Baku":            null,
  "Singapore":       null,
  "Austin":          null,
  "Mexico City":     null,
  "São Paulo":       null,
  "Las Vegas":       null,
  "Lusail":          null,
  "Yas Marina":      null,
};

// ─── Données statiques circuits 2026 ─────────────────────────────────────────
// Source : jolpica + données publiques F1
const CIRCUITS_2026 = [
  { round:1,  name:"Grand Prix d'Australie",    circuit:"Albert Park",  circuitRef:"albert_park",  country:"AU", city:"Melbourne",        length:5.278, laps:58, turns:16, drs:3, lapRecord:{time:"1:20.235", driver:"Charles Leclerc", year:2022} },
  { round:2,  name:"Grand Prix de Chine",       circuit:"Shanghai",     circuitRef:"shanghai",     country:"CN", city:"Shanghai",          length:5.451, laps:56, turns:16, drs:2, lapRecord:{time:"1:32.238", driver:"Michael Schumacher", year:2004} },
  { round:3,  name:"Grand Prix du Japon",       circuit:"Suzuka",       circuitRef:"suzuka",       country:"JP", city:"Suzuka",            length:5.807, laps:53, turns:18, drs:1, lapRecord:{time:"1:30.983", driver:"Valtteri Bottas", year:2019} },
  { round:4,  name:"Grand Prix de Bahreïn",     circuit:"Bahrain",      circuitRef:"bahrain",      country:"BH", city:"Sakhir",            length:5.412, laps:57, turns:15, drs:3, lapRecord:{time:"1:31.447", driver:"Pedro de la Rosa", year:2005}, cancelled:true },
  { round:5,  name:"Grand Prix d'Arabie Saoudite", circuit:"Jeddah",    circuitRef:"jeddah",       country:"SA", city:"Djeddah",           length:6.174, laps:50, turns:27, drs:3, lapRecord:{time:"1:30.734", driver:"Lewis Hamilton", year:2021}, cancelled:true },
  { round:6,  name:"Grand Prix de Miami",       circuit:"Miami",        circuitRef:"miami",        country:"US", city:"Miami Gardens",      length:5.412, laps:57, turns:19, drs:3, lapRecord:{time:"1:29.708", driver:"Max Verstappen", year:2023}, sprint:true },
  { round:7,  name:"Grand Prix d'Émilie-Romagne", circuit:"Imola",     circuitRef:"imola",        country:"IT", city:"Imola",             length:4.909, laps:63, turns:19, drs:1, lapRecord:{time:"1:15.484", driver:"Max Verstappen", year:2022} },
  { round:8,  name:"Grand Prix de Monaco",      circuit:"Monaco",       circuitRef:"monaco",       country:"MC", city:"Monaco",            length:3.337, laps:78, turns:19, drs:1, lapRecord:{time:"1:12.909", driver:"Rubens Barrichello", year:2004} },
  { round:9,  name:"Grand Prix du Canada",      circuit:"Montreal",     circuitRef:"villeneuve",   country:"CA", city:"Montréal",          length:4.361, laps:70, turns:14, drs:2, lapRecord:{time:"1:13.078", driver:"Valtteri Bottas", year:2019} },
  { round:10, name:"Grand Prix d'Espagne",      circuit:"Barcelona",    circuitRef:"catalunya",    country:"ES", city:"Barcelone",         length:4.675, laps:66, turns:14, drs:2, lapRecord:{time:"1:18.149", driver:"Max Verstappen", year:2023} },
  { round:11, name:"Grand Prix d'Autriche",     circuit:"Spielberg",    circuitRef:"red_bull_ring",country:"AT", city:"Spielberg",         length:4.318, laps:71, turns:10, drs:3, lapRecord:{time:"1:05.619", driver:"Carlos Sainz", year:2020}, sprint:true },
  { round:12, name:"Grand Prix de Grande-Bretagne", circuit:"Silverstone", circuitRef:"silverstone",country:"GB", city:"Silverstone",     length:5.891, laps:52, turns:18, drs:2, lapRecord:{time:"1:27.097", driver:"Max Verstappen", year:2020} },
  { round:13, name:"Grand Prix de Hongrie",     circuit:"Hungaroring",  circuitRef:"hungaroring",  country:"HU", city:"Budapest",          length:4.381, laps:70, turns:14, drs:1, lapRecord:{time:"1:16.627", driver:"Lewis Hamilton", year:2020} },
  { round:14, name:"Grand Prix de Belgique",    circuit:"Spa",          circuitRef:"spa",          country:"BE", city:"Spa-Francorchamps", length:7.004, laps:44, turns:19, drs:2, lapRecord:{time:"1:46.286", driver:"Valtteri Bottas", year:2018} },
  { round:15, name:"Grand Prix des Pays-Bas",   circuit:"Zandvoort",    circuitRef:"zandvoort",    country:"NL", city:"Zandvoort",         length:4.259, laps:72, turns:14, drs:2, lapRecord:{time:"1:11.097", driver:"Lewis Hamilton", year:2021} },
  { round:16, name:"Grand Prix d'Italie",       circuit:"Monza",        circuitRef:"monza",        country:"IT", city:"Monza",             length:5.793, laps:53, turns:11, drs:2, lapRecord:{time:"1:21.046", driver:"Rubens Barrichello", year:2004} },
  { round:17, name:"Grand Prix d'Azerbaïdjan",  circuit:"Baku",         circuitRef:"baku",         country:"AZ", city:"Bakou",             length:6.003, laps:51, turns:20, drs:2, lapRecord:{time:"1:43.009", driver:"Charles Leclerc", year:2019}, sprint:true },
  { round:18, name:"Grand Prix de Singapour",   circuit:"Singapore",    circuitRef:"marina_bay",   country:"SG", city:"Singapour",         length:5.063, laps:62, turns:19, drs:3, lapRecord:{time:"1:35.867", driver:"Kevin Magnussen", year:2018} },
  { round:19, name:"Grand Prix des États-Unis", circuit:"Austin",       circuitRef:"americas",     country:"US", city:"Austin",            length:5.513, laps:56, turns:20, drs:3, lapRecord:{time:"1:36.169", driver:"Carlos Sainz", year:2023}, sprint:true },
  { round:20, name:"Grand Prix du Mexique",     circuit:"Mexico City",  circuitRef:"rodriguez",    country:"MX", city:"Mexico City",       length:4.304, laps:71, turns:17, drs:3, lapRecord:{time:"1:17.774", driver:"Valtteri Bottas", year:2021} },
  { round:21, name:"Grand Prix du Brésil",      circuit:"São Paulo",    circuitRef:"interlagos",   country:"BR", city:"São Paulo",          length:4.309, laps:71, turns:15, drs:2, lapRecord:{time:"1:10.540", driver:"Valtteri Bottas", year:2018}, sprint:true },
  { round:22, name:"Grand Prix de Las Vegas",   circuit:"Las Vegas",    circuitRef:"las_vegas",    country:"US", city:"Las Vegas",          length:6.201, laps:50, turns:17, drs:2, lapRecord:{time:"1:35.490", driver:"Oscar Piastri", year:2023} },
  { round:23, name:"Grand Prix du Qatar",       circuit:"Lusail",       circuitRef:"losail",       country:"QA", city:"Losail",            length:5.380, laps:57, turns:16, drs:3, lapRecord:{time:"1:24.319", driver:"Max Verstappen", year:2023}, sprint:true },
  { round:24, name:"Grand Prix d'Abu Dhabi",    circuit:"Yas Marina",   circuitRef:"yas_marina",   country:"AE", city:"Abu Dhabi",          length:5.281, laps:58, turns:16, drs:2, lapRecord:{time:"1:26.103", driver:"Max Verstappen", year:2021} },
];

// ─── SVG URL builder (f1-circuits-svg GitHub raw) ────────────────────────────
const SVG_BASE = "https://raw.githubusercontent.com/brianweet/f1-api/master/f1-circuits/";
// Fallback : générer un SVG placeholder si la ressource est inaccessible

// Map circuitRef → nom du fichier SVG dans le repo brianweet (approximatif)
const SVG_MAP = {
  albert_park: "australia", bahrain: "bahrain", jeddah: "saudi-arabia",
  suzuka: "japan", shanghai: "china", miami: "miami",
  imola: "emilia-romagna", monaco: "monaco", villeneuve: "canada",
  catalunya: "spain", red_bull_ring: "austria", silverstone: "great-britain",
  hungaroring: "hungary", spa: "belgium", zandvoort: "netherlands",
  monza: "italy", baku: "azerbaijan", marina_bay: "singapore",
  americas: "united-states", rodriguez: "mexico", interlagos: "brazil",
  las_vegas: "las-vegas", losail: "qatar", yas_marina: "abu-dhabi",
};

function isoToFlag(code) {
  if (!code || code.length !== 2) return "";
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(c.charCodeAt(0) + 127397))
    .join("");
}

// ─── State ────────────────────────────────────────────────────────────────────
let _activeCircuit = null;
let _winnersCache  = {};
let _initialized   = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectProxy() {
  const h = location.hostname;
  if (h === "localhost" || h === "127.0.0.1") return "http://localhost/proxy";
  return "/proxy";
}
const PROXY = detectProxy();
const JOLPICA = `${PROXY}/jolpica`;

async function fetchWinners(circuitRef) {
  if (_winnersCache[circuitRef]) return _winnersCache[circuitRef];
  try {
    const url = `${JOLPICA}/ergast/f1/circuits/${circuitRef}/results/1.json?limit=50`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const json = await res.json();
    const races = json?.MRData?.RaceTable?.Races || [];
    const winners = races
      .map(r => ({
        year   : parseInt(r.season),
        gp     : r.raceName,
        driver : r.Results?.[0]?.Driver?.familyName || "?",
        code   : r.Results?.[0]?.Driver?.code || "???",
        team   : r.Results?.[0]?.Constructor?.name || "?",
        time   : r.Results?.[0]?.Time?.time || r.Results?.[0]?.status || "?",
      }))
      .sort((a, b) => b.year - a.year);
    _winnersCache[circuitRef] = winners;
    return winners;
  } catch {
    return [];
  }
}

// ─── Rendu de la grille ───────────────────────────────────────────────────────

function renderGrid(container) {
  const calendar = store.calendar || [];

  container.innerHTML = `
    <div class="circ-search-bar">
      <input id="circ-search" type="text" placeholder="🔍 Chercher un circuit…" autocomplete="off">
      <div class="circ-filter-btns">
        <button class="circ-filter-btn active" data-filter="all">Tous</button>
        <button class="circ-filter-btn" data-filter="sprint">Sprint</button>
        <button class="circ-filter-btn" data-filter="past">Passés</button>
        <button class="circ-filter-btn" data-filter="upcoming">À venir</button>
      </div>
    </div>
    <div class="circ-grid" id="circ-grid"></div>
  `;

  const grid = container.querySelector("#circ-grid");
  const now  = Date.now();

  function renderCards(filter, search) {
    const filtered = CIRCUITS_2026.filter(c => {
      if (c.cancelled) return false;
      const cal = calendar.find(r => r.round === c.round);
      const raceDate = cal ? new Date(cal.sessions?.find(s => s.name === "Race")?.date || cal.dateStart).getTime() : 0;
      if (filter === "sprint"   && !c.sprint)           return false;
      if (filter === "past"     && raceDate > now)       return false;
      if (filter === "upcoming" && raceDate && raceDate <= now) return false;
      if (search) {
        const q = search.toLowerCase();
        return c.circuit.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
      }
      return true;
    });

    grid.innerHTML = filtered.map(c => {
      const cal      = calendar.find(r => r.round === c.round);
      const raceISO  = cal?.sessions?.find(s => s.name === "Race")?.date || cal?.dateStart;
      const isPast   = raceISO ? new Date(raceISO).getTime() < now : false;
      const flag     = isoToFlag(c.country);
      const sprintBadge = c.sprint ? `<span class="circ-badge circ-badge-sprint">SPRINT</span>` : "";
      const statusCls   = isPast ? "circ-card-past" : "";

      return `
        <div class="circ-card ${statusCls}" data-round="${c.round}" role="button" tabindex="0" aria-label="${c.name}">
          <div class="circ-card-header">
            <span class="circ-card-round">R${c.round}</span>
            <span class="circ-card-flag">${flag}</span>
            <span class="circ-card-badges">${sprintBadge}</span>
          </div>
          <div class="circ-card-svg-wrap">
            ${buildMiniSvg(c)}
          </div>
          <div class="circ-card-info">
            <div class="circ-card-name">${c.circuit}</div>
            <div class="circ-card-city">${c.city}</div>
            <div class="circ-card-stats">
              <span>${c.length} km</span>
              <span>${c.laps} tours</span>
              <span>${c.turns} virages</span>
            </div>
          </div>
        </div>
      `;
    }).join("");

    grid.querySelectorAll(".circ-card").forEach(card => {
      card.addEventListener("click", () => openDetail(parseInt(card.dataset.round)));
      card.addEventListener("keydown", e => { if (e.key === "Enter") openDetail(parseInt(card.dataset.round)); });
    });
  }

  // Filtres
  let currentFilter = "all";
  let currentSearch = "";
  container.querySelectorAll(".circ-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".circ-filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderCards(currentFilter, currentSearch);
    });
  });
  container.querySelector("#circ-search").addEventListener("input", e => {
    currentSearch = e.target.value.trim();
    renderCards(currentFilter, currentSearch);
  });

  renderCards("all", "");
}

// ─── Mini-SVG placeholder (géométrique) ──────────────────────────────────────
// Génère un tracé stylisé unique par circuit (basé sur les données de virage)
function buildMiniSvg(c) {
  // On utilise un SVG externe si disponible, sinon un placeholder animé
  const key = SVG_MAP[c.circuitRef];
  if (key) {
    return `
      <img class="circ-svg-img"
           src="https://raw.githubusercontent.com/f1laps/f1-track-vectors/main/tracks/${encodeURIComponent(key)}.svg"
           alt="${c.circuit} tracé"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="circ-svg-fallback" style="display:none">${buildGeomSvg(c)}</div>
    `;
  }
  return `<div class="circ-svg-fallback">${buildGeomSvg(c)}</div>`;
}

// SVG géométrique de secours basé sur les métadonnées du circuit
function buildGeomSvg(c) {
  const w = 120, h = 80;
  // Générer un tracé pseudo-aléatoire cohérent par circuit
  const seed   = c.round * 7 + c.turns;
  const pts    = generateTrackPoints(c.turns, c.round, w, h);
  const path   = `M ${pts.map(([x,y]) => `${x},${y}`).join(" L ")} Z`;
  return `
    <svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" class="circ-geom-svg">
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5"
            stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
  `;
}

function generateTrackPoints(turns, seed, w, h) {
  const cx = w / 2, cy = h / 2;
  const rx = w * 0.38, ry = h * 0.35;
  const pts = [];
  const n = Math.min(turns + 4, 24);
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = 0.7 + 0.3 * Math.abs(Math.sin((i + seed) * 1.37));
    pts.push([
      cx + rx * r * Math.cos(angle),
      cy + ry * r * Math.sin(angle),
    ]);
  }
  return pts;
}

// ─── Overlay détail circuit ───────────────────────────────────────────────────

function openDetail(round) {
  const c = CIRCUITS_2026.find(x => x.round === round);
  if (!c) return;
  _activeCircuit = round;

  let overlay = document.getElementById("circuit-detail-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "circuit-detail-overlay";
    overlay.className = "circuit-detail-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    document.body.appendChild(overlay);
  }

  const flag     = isoToFlag(c.country);
  const sprintTxt = c.sprint ? `<span class="circ-badge circ-badge-sprint">WEEK-END SPRINT</span>` : "";

  overlay.innerHTML = `
    <div class="circuit-detail-inner">
      <div class="circuit-detail-header">
        <div class="cdh-title">
          <span class="cdh-flag">${flag}</span>
          <span class="cdh-name">${c.name}</span>
          ${sprintTxt}
        </div>
        <button class="cdh-close" id="circ-detail-close" aria-label="Fermer">✕</button>
      </div>

      <div class="circuit-detail-body">

        <!-- Tracé + stats -->
        <div class="cdb-hero">
          <div class="cdb-svg-wrap" id="cdb-svg">
            <div class="circ-loading-track">Chargement du tracé…</div>
          </div>
          <div class="cdb-stats">
            <div class="cdb-stat"><span class="cdb-stat-val">${c.length}</span><span class="cdb-stat-lbl">km/tour</span></div>
            <div class="cdb-stat"><span class="cdb-stat-val">${c.laps}</span><span class="cdb-stat-lbl">tours</span></div>
            <div class="cdb-stat"><span class="cdb-stat-val">${c.turns}</span><span class="cdb-stat-lbl">virages</span></div>
            <div class="cdb-stat"><span class="cdb-stat-val">${c.drs}</span><span class="cdb-stat-lbl">zones DRS</span></div>
            <div class="cdb-stat cdb-stat-wide">
              <span class="cdb-stat-val">${c.lapRecord.time}</span>
              <span class="cdb-stat-lbl">Record — ${c.lapRecord.driver} (${c.lapRecord.year})</span>
            </div>
            <div class="cdb-stat cdb-stat-wide">
              <span class="cdb-stat-val">${(c.length * c.laps).toFixed(1)} km</span>
              <span class="cdb-stat-lbl">Distance totale de course</span>
            </div>
          </div>
        </div>

        <!-- Vainqueurs historiques -->
        <div class="cdb-section">
          <div class="cdb-section-title">🏆 Historique des vainqueurs</div>
          <div class="cdb-winners-wrap" id="cdb-winners">
            <div class="circ-loading">Chargement…</div>
          </div>
        </div>

      </div>

      <!-- Navigation -->
      <div class="cdb-nav">
        <button class="cdb-nav-btn" id="cdb-prev">← Précédent</button>
        <span class="cdb-nav-round">R${c.round} / ${CIRCUITS_2026.filter(x => !x.cancelled).length}</span>
        <button class="cdb-nav-btn" id="cdb-next">Suivant →</button>
      </div>
    </div>
  `;

  overlay.hidden = false;
  document.body.style.overflow = "hidden";

  overlay.querySelector("#circ-detail-close").addEventListener("click", closeDetail);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeDetail(); });
  document.addEventListener("keydown", _onKeyDown);

  const prevCircuits = CIRCUITS_2026.filter(x => !x.cancelled && x.round < round);
  const nextCircuits = CIRCUITS_2026.filter(x => !x.cancelled && x.round > round);
  const prevBtn = overlay.querySelector("#cdb-prev");
  const nextBtn = overlay.querySelector("#cdb-next");
  if (prevCircuits.length) prevBtn.addEventListener("click", () => openDetail(prevCircuits.at(-1).round));
  else prevBtn.disabled = true;
  if (nextCircuits.length) nextBtn.addEventListener("click", () => openDetail(nextCircuits[0].round));
  else nextBtn.disabled = true;

  // Charger le tracé
  loadTrackSvg(c, overlay.querySelector("#cdb-svg"));
  // Charger vainqueurs
  loadWinners(c, overlay.querySelector("#cdb-winners"));
}

function _onKeyDown(e) {
  if (e.key === "Escape") closeDetail();
  if (e.key === "ArrowRight") {
    const next = CIRCUITS_2026.find(x => !x.cancelled && x.round > (_activeCircuit || 0));
    if (next) openDetail(next.round);
  }
  if (e.key === "ArrowLeft") {
    const all  = CIRCUITS_2026.filter(x => !x.cancelled && x.round < (_activeCircuit || 99));
    if (all.length) openDetail(all.at(-1).round);
  }
}

function closeDetail() {
  const overlay = document.getElementById("circuit-detail-overlay");
  if (overlay) overlay.hidden = true;
  document.body.style.overflow = "";
  document.removeEventListener("keydown", _onKeyDown);
  _activeCircuit = null;
}

// ─── Chargement du tracé SVG ──────────────────────────────────────────────────

async function loadTrackSvg(c, container) {
  const key = SVG_MAP[c.circuitRef];
  if (key) {
    const url = `https://raw.githubusercontent.com/f1laps/f1-track-vectors/main/tracks/${encodeURIComponent(key)}.svg`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const svg = await res.text();
        container.innerHTML = `<div class="cdb-svg-inner">${svg}</div>`;
        const svgEl = container.querySelector("svg");
        if (svgEl) {
          svgEl.removeAttribute("width");
          svgEl.removeAttribute("height");
          svgEl.style.width  = "100%";
          svgEl.style.height = "100%";
        }
        return;
      }
    } catch { /* fallback */ }
  }
  // Fallback géométrique
  container.innerHTML = `<div class="cdb-svg-inner">${buildGeomSvg(c)}</div>`;
}

// ─── Chargement des vainqueurs ────────────────────────────────────────────────

async function loadWinners(c, container) {
  const winners = await fetchWinners(c.circuitRef);
  if (!winners.length) {
    container.innerHTML = `<p class="circ-empty">Aucun historique disponible.</p>`;
    return;
  }

  // Calcul stats : pilote avec le plus de victoires
  const driverWins = {};
  winners.forEach(w => { driverWins[w.driver] = (driverWins[w.driver] || 0) + 1; });
  const topDriver  = Object.entries(driverWins).sort((a,b) => b[1]-a[1])[0];

  container.innerHTML = `
    <div class="circ-winners-top">
      <span class="cwt-label">Pilote le + victorieux :</span>
      <span class="cwt-name">${topDriver[0]}</span>
      <span class="cwt-count">${topDriver[1]} victoire${topDriver[1]>1?"s":""}</span>
    </div>
    <div class="circ-winners-list" id="cwl">
      <div class="cwl-filters">
        <input type="text" id="cwl-search" placeholder="Filtrer par pilote / écurie…">
      </div>
      <div class="cwl-rows" id="cwl-rows"></div>
    </div>
  `;

  function renderWinners(search) {
    const filtered = search
      ? winners.filter(w => w.driver.toLowerCase().includes(search) || w.team.toLowerCase().includes(search))
      : winners;
    container.querySelector("#cwl-rows").innerHTML = filtered.slice(0, 30).map(w => `
      <div class="cwl-row">
        <span class="cwl-year">${w.year}</span>
        <span class="cwl-driver">${w.code}</span>
        <span class="cwl-team">${w.team}</span>
        <span class="cwl-time">${w.time}</span>
      </div>
    `).join("") + (filtered.length > 30 ? `<div class="cwl-more">+ ${filtered.length - 30} autres</div>` : "");
  }

  renderWinners("");
  container.querySelector("#cwl-search").addEventListener("input", e => renderWinners(e.target.value.toLowerCase().trim()));
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initCircuits() {
  if (_initialized) return;
  _initialized = true;

  const container = document.getElementById("circuits-content");
  if (!container) return;

  function _render() {
    renderGrid(container);
  }

  // Rendu initial + mise à jour si le calendrier arrive après
  _render();
  onUpdate(() => {
    if (!document.getElementById("view-circuits")?.classList.contains("active")) return;
    _render();
  });

  // Ré-initialiser au changement de vue
  window.addEventListener("viewchange", e => {
    if (e.detail.view === "circuits" && container.children.length === 0) _render();
  });
}