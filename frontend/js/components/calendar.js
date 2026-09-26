/**
 * calendar.js
 * Calendrier 2026 complet avec :
 *  - Drapeaux de pays sur chaque carte GP
 *  - GP annulés (Bahreïn, Djeddah) affichés en grisé
 *  - Bannière double compte à rebours (prochain GP Course + prochaine séance)
 *  - Badge Sprint pour les week-ends sprint
 *  - Overlay flottant redimensionnable/déplaçable au clic sur une carte
 */

import { onUpdate, store } from "../store.js";
import { makeDraggable } from "./draggable.js";

const grid       = document.getElementById("calendar-grid");
const banner     = document.getElementById("next-event-banner");
const nebGpName  = document.getElementById("neb-gp-name");
const nebGpCd    = document.getElementById("neb-gp-countdown");
const nebSesName = document.getElementById("neb-session-name");
const nebSesCd   = document.getElementById("neb-session-countdown");

const overlay      = document.getElementById("gp-overlay");
const overlayTitle = document.getElementById("fp-title");
const overlayBody  = document.getElementById("gp-overlay-body");
const overlayClose = document.getElementById("gp-overlay-close");
const overlayHandle= document.getElementById("gp-overlay-handle");
const overlayResize= document.getElementById("gp-overlay-resize");

let rendered = false;
let cdInterval = null;

// ─── Drapeaux pays (ISO 3166-1 alpha-2) ──────────────────────────────

function isoToFlag(code) {
  if (!code || code.length !== 2) return "";
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(c.charCodeAt(0) + 127397))
    .join("");
}

// ─── Utilitaires temps ────────────────────────────────────────────────

function formatCountdown(targetISO) {
  const diff = new Date(targetISO).getTime() - Date.now();
  if (diff <= 0) return "EN COURS";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (d > 0) return `${d}j ${h}h ${m}m`;
  return `${h}h ${m}m ${s}s`;
}

function formatLocalDate(isoWithTZ) {
  try {
    return new Date(isoWithTZ).toLocaleString("fr-FR", {
      weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return isoWithTZ; }
}

function formatDateRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${e.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;
}

// ─── Recherche prochain GP (pointe vers la COURSE, pas la FP1) ───────

function findNextGP(calendar) {
  const now = Date.now();
  return calendar.find(r => {
    if (r.cancelled) return false;
    // Chercher la date de la Course (Race) pour le compte à rebours GP
    const raceSession = (r.sessions || []).find(s => s.type === "Race");
    const target = raceSession
      ? new Date(raceSession.date).getTime()
      : new Date(r.date_end).getTime();
    return target > now;
  }) || null;
}

// ─── Recherche prochaine séance individuelle ──────────────────────────

function findNextSession(calendar) {
  const now = Date.now();
  for (const race of calendar) {
    if (race.cancelled) continue;
    for (const s of (race.sessions || [])) {
      if (new Date(s.date).getTime() > now) {
        return { gpName: race.name, session: s };
      }
    }
  }
  return null;
}

// ─── Session type label (traduction) ──────────────────────────────────

function sessionLabel(type) {
  const MAP = {
    "Practice 1": "EL1", "Practice 2": "EL2", "Practice 3": "EL3",
    "Qualifying": "Qualifications", "Race": "Course",
    "Sprint": "Sprint", "Sprint Qualifying": "Qualifs Sprint",
    "Sprint Shootout": "Sprint Shootout",
  };
  return MAP[type] || type || "";
}

// ─── Overlay flottant ────────────────────────────────────────────────

// ─── Cache des données Jolpica ────────────────────────────────────────
const _ergastCache = {};

function detectProxy() {
  const h = window.location.hostname;
  const p = window.location.port;
  if (p === "8080" || p === "80" || p === "443" || p === "" || (h !== "localhost" && h !== "127.0.0.1")) {
    return `${window.location.origin}/proxy`;
  }
  return "http://localhost:3001";
}

async function fetchCircuitWinners(circuitId) {
  if (_ergastCache[circuitId]) return _ergastCache[circuitId];
  try {
    const PROXY = detectProxy();
    const res = await fetch(`${PROXY}/jolpica/ergast/f1/circuits/${circuitId}/results/1.json?limit=10`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const races = data?.MRData?.RaceTable?.Races || [];
    _ergastCache[circuitId] = races;
    return races;
  } catch (e) {
    console.warn("[calendar] fetchCircuitWinners:", e);
    return [];
  }
}

async function fetchLastResultForRace(season, round) {
  const key = `${season}_${round}`;
  if (_ergastCache[key]) return _ergastCache[key];
  try {
    const PROXY = detectProxy();
    const res = await fetch(`${PROXY}/jolpica/ergast/f1/${season}/${round}/results.json?limit=25`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const race = data?.MRData?.RaceTable?.Races?.[0] || null;
    _ergastCache[key] = race;
    return race;
  } catch (e) {
    return null;
  }
}

const TEAM_COLORS_OVL = {
  "Mercedes":"#27F4D2","Red Bull":"#3671C6","Ferrari":"#E8002D","McLaren":"#FF8000",
  "Aston Martin":"#229971","Alpine":"#00A1E8","Haas":"#DEE1E2","Williams":"#1868DB",
  "Racing Bulls":"#6692FF","RB":"#6692FF","Audi":"#FF2D00","Cadillac":"#AAAAAD",
};
function resolveTeamColorOvl(n){if(!n)return"#888";if(TEAM_COLORS_OVL[n])return TEAM_COLORS_OVL[n];for(const[k,v]of Object.entries(TEAM_COLORS_OVL)){if(n.toLowerCase().includes(k.toLowerCase()))return v;}return"#888";}

function showOverlay(race) {
  if (!overlay || !overlayTitle || !overlayBody) return;

  const flag = isoToFlag(race.country_code);
  overlayTitle.textContent = `${flag} ${race.name}`;
  overlayBody.replaceChildren();

  // ── Badges statut week-end ──────────────────────────────────────────
  const badgesDiv = document.createElement("div");
  badgesDiv.className = "gpd-badges";
  if (race.cancelled) {
    badgesDiv.innerHTML = `<span class="gpd-badge cancelled">❌ ANNULÉ</span>`;
  } else {
    if (race.sprint) badgesDiv.innerHTML += `<span class="gpd-badge sprint">⚡ SPRINT</span>`;
    const now = Date.now();
    const raceSession = (race.sessions || []).find(s => s.name === "Course" || s.type === "Race");
    const raceTime = raceSession ? new Date(raceSession.date).getTime() : new Date(race.date_end).getTime();
    if (raceTime < now) {
      badgesDiv.innerHTML += `<span class="gpd-badge done">✓ TERMINÉ</span>`;
    } else if (new Date(race.date_start).getTime() <= now) {
      badgesDiv.innerHTML += `<span class="gpd-badge live">● EN COURS</span>`;
    } else {
      badgesDiv.innerHTML += `<span class="gpd-badge upcoming">À VENIR</span>`;
    }
  }
  overlayBody.appendChild(badgesDiv);

  // ── Info & Illustration circuit ──────────────────────────────────────
  const cid = race.circuit_id;
  const spec = (cid && store.circuits_meta && store.circuits_meta[cid])
    || (store.circuits_meta && store.circuits_meta[race.circuit])
    || (store.circuits_meta && Object.values(store.circuits_meta).find(c => 
        (c.name && race.circuit && c.name.toLowerCase().includes(race.circuit.toLowerCase())) ||
        (race.circuit && c.name && race.circuit.toLowerCase().includes(c.name.toLowerCase()))
    ))
    || race;

  const circuitCard = document.createElement("div");
  circuitCard.className = "gpd-circuit-card";

  const imgSource = spec?.track_image_url || spec?.image_url || race.image_url;
  const trackImg = imgSource
    ? `<div class="gpd-track-banner"><img src="${imgSource}" alt="Tracé de ${race.circuit}" onerror="this.parentElement.style.display='none'" /></div>`
    : "";

  const recordStr = spec?.lap_record
    ? `${spec.lap_record.time} (${spec.lap_record.driver} · ${spec.lap_record.year})`
    : "—";

  const histText = spec?.history || spec?.history_summary || "";

  circuitCard.innerHTML = `
    ${trackImg}
    <div class="gpd-circuit-info">
      <span class="gpd-circuit-icon">📍</span>
      <span class="gpd-circuit-name">${race.circuit}</span>
      <span class="gpd-country">${race.country || ""}</span>
    </div>
    <div class="gpd-specs-grid">
      <div class="gpd-spec-item"><span class="gpd-spec-val">${spec?.length_km || race.circuit_length_km || "—"} km</span><span class="gpd-spec-lbl">Longueur</span></div>
      <div class="gpd-spec-item"><span class="gpd-spec-val">${spec?.turns || "—"}</span><span class="gpd-spec-lbl">Virages</span></div>
      <div class="gpd-spec-item"><span class="gpd-spec-val">${spec?.drs_zones || "—"}</span><span class="gpd-spec-lbl">Zones DRS</span></div>
      <div class="gpd-spec-item"><span class="gpd-spec-val">${race.circuit_laps || spec?.circuit_laps || "—"}</span><span class="gpd-spec-lbl">Tours GP</span></div>
    </div>
    <div class="gpd-record-bar">
      <span class="gpd-record-title">⚡ Record du tour :</span>
      <span class="gpd-record-val">${recordStr}</span>
    </div>
    ${spec?.characteristics ? `
    <div class="gpd-chars-bar">
      <span class="gpd-char-chip">Appui : ${spec.characteristics.downforce || "Moyen"}</span>
      <span class="gpd-char-chip">Grip : ${spec.characteristics.grip || spec.characteristics.tire_stress || "Moyen"}</span>
      <span class="gpd-char-chip">Pneus : ${spec.characteristics.tyre_stress || spec.characteristics.tire_stress || "Moyen"}</span>
    </div>` : ""}
    ${histText ? `
    <div class="gpd-circuit-history">
      <p>${histText}</p>
    </div>` : ""}`;
  overlayBody.appendChild(circuitCard);

  if (race.cancelled) {
    const msg = document.createElement("p");
    msg.className = "fp-cancelled-msg";
    msg.textContent = race.cancel_reason || "GP annulé";
    overlayBody.appendChild(msg);
    overlay.style.left = Math.max(0, (window.innerWidth - 420) / 2) + "px";
    overlay.style.top  = Math.max(44, (window.innerHeight - 280) / 2) + "px";
    overlay.hidden = false;
    return;
  }

  // ── Sessions ─────────────────────────────────────────────────────────
  const sessSection = document.createElement("div");
  sessSection.className = "gpd-section";
  const sessTitle = document.createElement("div");
  sessTitle.className = "gpd-section-title";
  sessTitle.textContent = "🗓 Programme";
  sessSection.appendChild(sessTitle);
  const now = Date.now();
  for (const s of (race.sessions || [])) {
    const isPast = new Date(s.date).getTime() < now;
    const isNext = !isPast && (race.sessions || []).filter(x => new Date(x.date).getTime() > now)[0] === s;
    const row = document.createElement("div");
    row.className = "fp-session-row" + (isPast ? " fp-session-past" : "") + (isNext ? " fp-session-next" : "");
    const isSprint = (s.type || "").toLowerCase().includes("sprint");
    const typeBadge = document.createElement("span");
    typeBadge.className = "fp-session-type-badge" + (isSprint ? " sprint" : "");
    typeBadge.textContent = sessionLabel(s.type || s.name);
    const dateObj = new Date(s.date);
    const dayStr = dateObj.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
    const timeStr = dateObj.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const dayEl = document.createElement("span"); dayEl.className = "fp-session-day"; dayEl.textContent = dayStr;
    const timeEl = document.createElement("span"); timeEl.className = "fp-session-time"; timeEl.textContent = timeStr;
    const statusEl = document.createElement("span"); statusEl.className = "fp-session-status";
    if (isNext) statusEl.textContent = "PROCHAIN";
    else if (isPast) statusEl.textContent = "✓";
    row.append(typeBadge, dayEl, timeEl, statusEl);
    sessSection.appendChild(row);
  }
  overlayBody.appendChild(sessSection);

  // ── Résultats 2026 (si course passée) ────────────────────────────────
  const raceMs = (() => {
    const r = (race.sessions || []).find(s => s.name === "Course" || s.type === "Race");
    return r ? new Date(r.date).getTime() : new Date(race.date_end).getTime();
  })();
  if (raceMs < now - 3600000 && race.round) {
    const resultsSection = document.createElement("div");
    resultsSection.className = "gpd-section";
    resultsSection.innerHTML = `<div class="gpd-section-title">🏁 Résultats 2026</div><div class="gpd-loading">Chargement…</div>`;
    overlayBody.appendChild(resultsSection);

    fetchLastResultForRace(new Date().getFullYear(), race.round).then(ergastRace => {
      const loadDiv = resultsSection.querySelector(".gpd-loading");
      if (!ergastRace?.Results?.length) {
        if (loadDiv) loadDiv.textContent = "Résultats non disponibles.";
        return;
      }
      if (loadDiv) loadDiv.remove();
      const top3 = ergastRace.Results.slice(0, 3);
      const podHTML = top3.map((r, i) => {
        const team = r.Constructor?.name || "";
        const color = resolveTeamColorOvl(team);
        const code = (r.Driver?.code || "???").toUpperCase();
        const name = `${r.Driver?.givenName || ""} ${r.Driver?.familyName || ""}`.trim();
        const time = i === 0 ? (r.Time?.time || r.status || "—") : (r.Time?.time ? `+${r.Time.time}` : r.status || "—");
        return `<div class="gpd-pod-item" style="--tc:${color}">
          <span class="gpd-pod-pos">P${i+1}</span>
          <span class="gpd-pod-code">${code}</span>
          <span class="gpd-pod-name">${name}</span>
          <span class="gpd-pod-time">${time}</span>
        </div>`;
      }).join("");
      const podDiv = document.createElement("div");
      podDiv.className = "gpd-podium";
      podDiv.innerHTML = podHTML;
      resultsSection.appendChild(podDiv);

      // Fastest lap
      const fl = ergastRace.Results.find(r => r.FastestLap?.rank === "1");
      if (fl) {
        const flDiv = document.createElement("div");
        flDiv.className = "gpd-fl";
        flDiv.innerHTML = `⚡ <strong>${fl.Driver?.code}</strong> — ${fl.FastestLap?.Time?.time || "—"} (Tour ${fl.FastestLap?.lap || "?"})`;
        resultsSection.appendChild(flDiv);
      }
    });
  }

  // ── Palmarès circuit (10 derniers vainqueurs) ─────────────────────────
  if (race.circuit_id || race.jolpica_circuit_id) {
    const circuitId = race.jolpica_circuit_id || race.circuit_id;
    const winnersSection = document.createElement("div");
    winnersSection.className = "gpd-section";
    winnersSection.innerHTML = `<div class="gpd-section-title">🏆 Palmarès (10 derniers vainqueurs)</div><div class="gpd-loading">Chargement…</div>`;
    overlayBody.appendChild(winnersSection);

    fetchCircuitWinners(circuitId).then(races => {
      const loadDiv = winnersSection.querySelector(".gpd-loading");
      if (!races.length) {
        if (loadDiv) loadDiv.textContent = "Historique non disponible.";
        return;
      }
      if (loadDiv) loadDiv.remove();
      const listDiv = document.createElement("div");
      listDiv.className = "gpd-winners-list";
      for (const r of [...races].reverse()) {
        const winner = r.Results?.[0];
        if (!winner) continue;
        const color = resolveTeamColorOvl(winner.Constructor?.name || "");
        const code = (winner.Driver?.code || "???").toUpperCase();
        const name = `${winner.Driver?.givenName || ""} ${winner.Driver?.familyName || ""}`.trim();
        const row = document.createElement("div");
        row.className = "gpd-winner-row";
        row.innerHTML = `<span class="gpd-winner-year">${r.season}</span><span class="gpd-winner-code" style="color:${color}">${code}</span><span class="gpd-winner-name">${name}</span><span class="gpd-winner-team" style="color:${color}">${winner.Constructor?.name || ""}</span>`;
        listDiv.appendChild(row);
      }
      winnersSection.appendChild(listDiv);
    });
  }

  overlay.style.left = Math.max(0, (window.innerWidth - 420) / 2) + "px";
  overlay.style.top  = Math.max(44, (window.innerHeight - 480) / 2) + "px";
  overlay.style.width  = "";
  overlay.style.height = "";
  overlay.hidden = false;
}

if (overlayClose) {
  overlayClose.addEventListener("click", () => { if (overlay) overlay.hidden = true; });
}

// ─── Drag (déplacement) — via utilitaire ─────────────────────────────
makeDraggable(overlay, overlayHandle);

// ─── Resize ──────────────────────────────────────────────────────────

let resizeState = null;
if (overlayResize) {
  overlayResize.addEventListener("mousedown", e => {
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    resizeState = { startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height };
  });
}
window.addEventListener("mousemove", e => {
  if (!resizeState || !overlay) return;
  const w = Math.max(220, resizeState.startW + (e.clientX - resizeState.startX));
  const h = Math.max(160, resizeState.startH + (e.clientY - resizeState.startY));
  overlay.style.width  = w + "px";
  overlay.style.height = h + "px";
});
window.addEventListener("mouseup", () => { resizeState = null; });

// ─── Rendu du calendrier ──────────────────────────────────────────────

function renderCalendar(calendar) {
  if (rendered) return;
  rendered = true;

  if (!grid) return;

  const now     = Date.now();
  const nextGP  = findNextGP(calendar);
  const nextSes = findNextSession(calendar);

  // Bannière avec double compte à rebours
  if (banner && (nextGP || nextSes)) {
    banner.hidden = false;
    if (nextGP && nebGpName) {
      nebGpName.textContent = `${isoToFlag(nextGP.country_code)} ${nextGP.name}`;
    }
    if (nextSes && nebSesName) {
      nebSesName.textContent = `${nextSes.gpName} — ${sessionLabel(nextSes.session.type || nextSes.session.name)}`;
    }
  }

  // Compteurs live - Utiliser setInterval pour mise à jour chaque seconde
  if (cdInterval) clearInterval(cdInterval);
  cdInterval = setInterval(() => {
    if (nextGP && nebGpCd) {
      // Le compteur GP pointe vers la COURSE (Race), pas le début du week-end
      const raceSession = (nextGP.sessions || []).find(s => s.type === "Race");
      const gpTarget = raceSession ? raceSession.date : nextGP.date_start;
      nebGpCd.textContent = formatCountdown(gpTarget);
    }
    if (nextSes && nebSesCd) {
      // Le compteur séance pointe vers la prochaine séance individuelle
      nebSesCd.textContent = formatCountdown(nextSes.session.date);
    }
  }, 1000);

  // Cartes GP
  grid.replaceChildren();

  for (const race of calendar) {
    const isPast = !race.cancelled && new Date(race.date_end).getTime() < now;
    const isNext = nextGP && race.round === nextGP.round;

    const card = document.createElement("div");
    card.className = [
      "race-card",
      isPast       ? "past"      : "",
      isNext       ? "next"      : "",
      race.sprint  ? "sprint"    : "",
      race.cancelled ? "cancelled" : "",
    ].filter(Boolean).join(" ");

    // Header de la carte avec drapeau + manche
    const header = document.createElement("div");
    header.className = "rc-card-header";

    const flag = document.createElement("span");
    flag.className = "rc-country-flag";
    flag.textContent = isoToFlag(race.country_code);

    const round = document.createElement("span");
    round.className = "round";
    round.textContent = `MANCHE ${race.round}`;

    header.append(flag, round);

    const name = document.createElement("div");
    name.className = "gp-name";
    name.textContent = race.name;

    const circuit = document.createElement("div");
    circuit.className = "circuit";
    circuit.textContent = `📍 ${race.circuit}, ${race.country}`;

    const dates = document.createElement("div");
    dates.className = "dates";
    dates.textContent = `📅 ${formatDateRange(race.date_start, race.date_end)}`;

    // Badges de type (Sprint, Annulé, Prochain, Terminé) — pas la liste des sessions
    const badgesRow = document.createElement("div");
    badgesRow.className = "card-badges-row";

    if (race.cancelled) {
      const reason = document.createElement("div");
      reason.className = "cancel-reason";
      reason.textContent = race.cancel_reason || "Annulé";
      card.appendChild(reason);
      const b = document.createElement("span");
      b.className = "badge badge-cancelled";
      b.textContent = "ANNULÉ";
      badgesRow.appendChild(b);
    } else {
      const now = Date.now();
      const raceSession = (race.sessions || []).find(s => s.type === "Race" || s.name === "Course");
      const raceTime = raceSession ? new Date(raceSession.date).getTime() : new Date(race.date_end).getTime();
      const startTime = new Date(race.date_start).getTime();

      if (isNext) {
        const b = document.createElement("span");
        b.className = "badge badge-next";
        b.textContent = "PROCHAIN";
        badgesRow.appendChild(b);
      } else if (raceTime < now) {
        const b = document.createElement("span");
        b.className = "badge badge-done";
        b.textContent = "✓ TERMINÉ";
        badgesRow.appendChild(b);
      } else if (startTime <= now) {
        const b = document.createElement("span");
        b.className = "badge badge-live";
        b.textContent = "● EN COURS";
        badgesRow.appendChild(b);
      }

      if (race.sprint) {
        const b = document.createElement("span");
        b.className = "badge badge-sprint";
        b.textContent = "⚡ SPRINT";
        badgesRow.appendChild(b);
      }

      card.addEventListener("click", () => showOverlay(race));
    }

    card.append(header, name, circuit, dates, badgesRow);

    grid.appendChild(card);
  }

  // Auto-scroll vers la prochaine course après rendu
  // Mobile : scroll dans la vue calendrier (pas window.scroll)
  function _scrollToNext() {
    const nextCard = grid.querySelector(".race-card.next");
    if (!nextCard) return;
    if (window.innerWidth <= 768) {
      const calView = document.getElementById("view-calendar");
      if (calView) {
        calView.scrollTo({ top: nextCard.offsetTop - 100, behavior: "smooth" });
      }
    } else {
      nextCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  requestAnimationFrame(() => setTimeout(_scrollToNext, 80));
  // Sur mobile : re-scroller quand on navigue vers la vue calendrier
  document.querySelectorAll('[href="#calendar"], [data-target-view="calendar"]').forEach(el => {
    el.addEventListener("click", () => setTimeout(_scrollToNext, 200));
  });
}

export { showOverlay };

export function initCalendar() {
  onUpdate(state => {
    if (state.calendar?.length) renderCalendar(state.calendar);
  });
}