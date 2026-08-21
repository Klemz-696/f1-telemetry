/**
 * evolution.js v1 — Graphique d'évolution du championnat pilotes
 *
 * Affiche les trajectoires de points/positions de chaque pilote
 * au fil des courses de la saison, via store.season_results
 */

import { store, onUpdate } from "../store.js";

const TEAM_COLORS = {
  "McLaren":       "#FF8000",
  "Ferrari":       "#E8002D",
  "Red Bull":      "#3671C6",
  "Mercedes":      "#27F4D2",
  "Aston Martin":  "#229971",
  "Alpine":        "#FF87BC",
  "Williams":      "#64C4FF",
  "Racing Bulls":  "#6692FF",
  "Haas":          "#B6BABD",
  "Kick Sauber":   "#52E252",
  "Audi":          "#52E252",
  "Cadillac":      "#FFFFFF",
};

function getTeamColor(teamName) {
  if (!teamName) return "#888";
  const key = Object.keys(TEAM_COLORS).find(k => teamName.includes(k));
  return key ? TEAM_COLORS[key] : "#888";
}

function getPointsForPosition(pos) {
  const pts = [25,18,15,12,10,8,6,4,2,1];
  return pts[pos - 1] || 0;
}

// ─── Extraction des données depuis season_results ─────────────────────────────

function buildEvolutionData(seasonResults) {
  if (!seasonResults?.length) return null;

  // Trier par round
  const sorted = [...seasonResults].sort((a,b) => a.round - b.round);

  // Accumuler les points par pilote
  const drivers = {};   // code → { name, team, points: [cumul par round] }
  const rounds  = [];   // { round, name }

  for (const race of sorted) {
    if (!race.Results?.length) continue;
    rounds.push({ round: race.round, name: race.raceName?.replace("Grand Prix","GP").replace("Formula 1","F1") || `R${race.round}` });

    // Tous les pilotes déjà connus → ajouter 0 si absent
    for (const code of Object.keys(drivers)) {
      drivers[code].points.push(drivers[code].points.at(-1) || 0);
    }

    for (const res of race.Results) {
      const code = res.Driver?.code || res.Driver?.familyName?.slice(0,3).toUpperCase() || "UNK";
      const team = res.Constructor?.name || "?";
      const pos  = parseInt(res.position || "0", 10);
      const pts  = getPointsForPosition(pos) + (res.FastestLap?.rank === "1" && pos <= 10 ? 1 : 0);

      if (!drivers[code]) {
        // Nouveau pilote vu pour la 1ère fois — backfill avec 0
        drivers[code] = { code, name: `${res.Driver?.givenName || ""} ${res.Driver?.familyName || ""}`.trim(), team, points: Array(rounds.length - 1).fill(0) };
      }
      const prev = drivers[code].points.at(-1) || 0;
      drivers[code].points[drivers[code].points.length - 1] = prev + pts;
      drivers[code].team = team; // màj team
    }
  }

  // Trier par total de points décroissant
  const ranked = Object.values(drivers)
    .filter(d => d.points.some(p => p > 0))
    .sort((a, b) => (b.points.at(-1) || 0) - (a.points.at(-1) || 0));

  return { rounds, drivers: ranked };
}

// ─── Rendu SVG du graphique ───────────────────────────────────────────────────

function renderChart(container, data, opts = {}) {
  const { rounds, drivers } = data;
  if (!rounds.length || !drivers.length) {
    container.innerHTML = `<p class="evo-empty">Pas encore de données de course disponibles.</p>`;
    return;
  }

  const W  = container.clientWidth  || 700;
  const H  = Math.min(420, Math.max(280, W * 0.55));
  const ML = 48, MR = opts.showAll ? 80 : 80, MT = 20, MB = 60;
  const CW = W - ML - MR;
  const CH = H - MT - MB;

  const maxPts = Math.max(...drivers.map(d => d.points.at(-1) || 0), 25);
  const nR     = rounds.length;

  // Filtre : top N ou tous
  const visDrivers = opts.showAll ? drivers : drivers.slice(0, Math.min(10, drivers.length));

  // Scales
  const xScale = i => ML + (i / (nR - 1 || 1)) * CW;
  const yScale = v => MT + CH - (v / maxPts) * CH;

  // Grille horizontale
  const gridLines = [];
  const step = maxPts > 200 ? 50 : maxPts > 100 ? 25 : 10;
  for (let v = 0; v <= maxPts; v += step) {
    const y = yScale(v);
    gridLines.push(`
      <line x1="${ML}" y1="${y}" x2="${ML + CW}" y2="${y}" stroke="rgba(255,255,255,.07)" stroke-width="1"/>
      <text x="${ML - 6}" y="${y + 4}" text-anchor="end" fill="#888" font-size="9">${v}</text>
    `);
  }

  // Lignes verticales (rounds)
  const vLines = rounds.map((r, i) => {
    const x = xScale(i);
    return `
      <line x1="${x}" y1="${MT}" x2="${x}" y2="${MT + CH}" stroke="rgba(255,255,255,.04)" stroke-width="1"/>
      <text x="${x}" y="${MT + CH + 14}" text-anchor="middle" fill="#666" font-size="8"
            transform="rotate(-40,${x},${MT + CH + 14})">${r.name.replace(/Grand Prix |GP /gi,"").slice(0,10)}</text>
    `;
  });

  // Lignes de chaque pilote
  const driverLines = visDrivers.map((d, di) => {
    const color = getTeamColor(d.team);
    const pts   = [0, ...d.points];  // ajouter 0 au départ (avant R1)
    const xPts  = [-1, ...rounds.map((_,i) => i)]; // -1 = origine

    const pathD = pts.map((v, i) => {
      const x = i === 0 ? ML : xScale(xPts[i]);
      const y = yScale(v);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");

    // Point final
    const lastX = xScale(rounds.length - 1);
    const lastY = yScale(d.points.at(-1) || 0);
    const rank  = di + 1;

    return `
      <path d="${pathD}" fill="none" stroke="${color}" stroke-width="${di < 3 ? 2.5 : 1.5}"
            opacity="${opts.highlight === d.code ? 1 : di < 3 ? 0.9 : 0.55}"
            class="evo-line" data-code="${d.code}" data-di="${di}"/>
      <circle cx="${lastX}" cy="${lastY}" r="4" fill="${color}" opacity="0.9"/>
      <text x="${lastX + 7}" y="${lastY + 4}" fill="${color}" font-size="9" font-weight="700">${rank}. ${d.code}</text>
    `;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
         class="evo-svg" style="width:100%;height:${H}px;overflow:visible">
      <!-- Grille -->
      ${gridLines.join("")}
      ${vLines.join("")}
      <!-- Lignes pilotes -->
      ${driverLines.join("")}
      <!-- Axe Y label -->
      <text x="12" y="${MT + CH/2}" text-anchor="middle" fill="#888" font-size="9"
            transform="rotate(-90,12,${MT + CH/2})">POINTS</text>
    </svg>
    <div class="evo-legend" id="evo-legend">
      ${visDrivers.slice(0, 20).map((d,i) => `
        <span class="evo-legend-item" data-code="${d.code}">
          <svg width="14" height="4"><line x1="0" y1="2" x2="14" y2="2" stroke="${getTeamColor(d.team)}" stroke-width="2.5"/></svg>
          ${d.code}
        </span>
      `).join("")}
    </div>
  `;

  // Hover interactif
  container.querySelectorAll(".evo-legend-item").forEach(item => {
    item.addEventListener("mouseenter", () => {
      const code = item.dataset.code;
      container.querySelectorAll(".evo-line").forEach(l => {
        l.style.opacity = l.dataset.code === code ? "1" : "0.15";
        l.style.strokeWidth = l.dataset.code === code ? "3" : "1";
      });
    });
    item.addEventListener("mouseleave", () => {
      container.querySelectorAll(".evo-line").forEach(l => {
        l.style.opacity = "";
        l.style.strokeWidth = "";
      });
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initEvolution() {
  const panel = document.getElementById("standings-evolution");
  if (!panel) return;

  panel.innerHTML = `
    <div class="evo-controls">
      <label class="evo-toggle">
        <input type="checkbox" id="evo-show-all">
        <span>Afficher tous les pilotes</span>
      </label>
    </div>
    <div class="evo-chart-wrap" id="evo-chart-wrap">
      <div class="evo-empty">Chargement des données…</div>
    </div>
  `;

  let _showAll = false;

  const wrap = panel.querySelector("#evo-chart-wrap");
  panel.querySelector("#evo-show-all").addEventListener("change", e => {
    _showAll = e.target.checked;
    draw();
  });

  function draw() {
    const results = store.season_results;
    if (!results?.length) {
      wrap.innerHTML = `<p class="evo-empty">Pas encore de résultats de course disponibles pour la saison en cours.</p>`;
      return;
    }
    const data = buildEvolutionData(results);
    if (!data) { wrap.innerHTML = `<p class="evo-empty">Données insuffisantes.</p>`; return; }
    renderChart(wrap, data, { showAll: _showAll });
  }

  // Redessiner à chaque resize
  let _resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(draw, 200);
  });

  // Redessiner quand on revient sur l'onglet
  window.addEventListener("viewchange", e => {
    if (e.detail.view === "standings") setTimeout(draw, 50);
  });
  document.addEventListener("click", e => {
    if (e.target.dataset?.tab === "evolution") setTimeout(draw, 50);
  });

  onUpdate(() => draw());
  draw();
}