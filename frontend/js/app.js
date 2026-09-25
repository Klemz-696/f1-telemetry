/**
 * app.js v5 — Navigation avec #home comme vue par défaut
 * Nouvelles pages : #home (accueil) et #results (résultats saison)
 */

import { store, updateStore, savePrefs, onUpdate } from "./store.js";
import { loadStaticData, watchSessionState, scheduleStandingsRefresh } from "./api.js";
import { initSimulation }     from "./components/simulation.js";
import { initTrackerMap }     from "./components/tracker_map.js";
import { initTimingTower }    from "./components/timing_tower.js";
import { initRaceControl }    from "./components/race_control.js";
import { initStandings, initStandingsWithDetail } from "./components/standings.js";
import { initCalendar, showOverlay as showGpOverlay } from "./components/calendar.js";
import { initSettings }       from "./components/settings.js";
import { initLiveEvents }     from "./components/live_events.js";
import { initOverlayManager } from "./components/overlay_manager.js";
import { initCommentary }     from "./components/commentary.js";
import { initHeadToHead }     from "./components/head_to_head.js";
import { initRadioPlayer }    from "./components/radio_player.js";
import { initAlertsEngine }   from "./components/alerts_engine.js";
import { initHome }           from "./components/home.js";
import { initResults }        from "./components/results.js";
import { initNews }           from "./components/news.js";
import { playSound, setSoundEnabled, setSoundVolume } from "./components/sound_engine.js";
import { initNavLinks, activateView, setNavSoundPlayer, KNOWN_HASHES } from "./nav.js";

const COUNTRY_FLAGS = {
  AU:"🇦🇺",CN:"🇨🇳",JP:"🇯🇵",US:"🇺🇸",CA:"🇨🇦",MC:"🇲🇨",ES:"🇪🇸",
  AT:"🇦🇹",GB:"🇬🇧",BE:"🇧🇪",HU:"🇭🇺",IT:"🇮🇹",NL:"🇳🇱",SG:"🇸🇬",
  MX:"🇲🇽",BR:"🇧🇷",AE:"🇦🇪",SA:"🇸🇦",BH:"🇧🇭",QA:"🇶🇦",AZ:"🇦🇿",
  FR:"🇫🇷",DE:"🇩🇪",FI:"🇫🇮",NZ:"🇳🇿",TH:"🇹🇭",AR:"🇦🇷",SE:"🇸🇪",
};

const TRACK_STATUS_LABELS = {
  "1":{ text:"● VERT",           cls:"flag-green"  },
  "2":{ text:"● JAUNE",          cls:"flag-yellow" },
  "3":{ text:"● JAUNE SCT",      cls:"flag-yellow" },
  "4":{ text:"🟡 SAFETY CAR",    cls:"flag-sc"     },
  "5":{ text:"🔴 DRAPEAU ROUGE", cls:"flag-red"    },
  "6":{ text:"🟡 VIRTUAL SC",    cls:"flag-vsc"    },
  "7":{ text:"● MEDICAL CAR",    cls:"flag-yellow" },
};

// ─── Mode Switcher ─────────────────────────────────────────────────────────────

const MODE_LABELS = {
  auto:"🔄 AUTO", live:"📡 DIRECT", simulation:"🎮 SIM", archive:"📼 ARCHIVE", offline:"✈ OFFLINE",
};

function initModeSwitcher() {
  const toggleBtn = document.getElementById("mode-toggle-btn");
  const dropdown  = document.getElementById("mode-dropdown");
  let _currentMode = "live";

  function _syncLabel(mode) {
    if (toggleBtn) toggleBtn.textContent = (MODE_LABELS[mode] || mode) + " ▾";
    document.querySelectorAll(".mode-drop-item").forEach(b =>
      b.classList.toggle("mode-drop-active", b.dataset.mode === mode));
    _currentMode = mode;
  }

  function _applyMode(mode) {
    _syncLabel(mode);
    if (mode === "auto") {
      // Mode auto : laisser watchSessionState() décider via le proxy
      updateStore({ _forcedMode: null, _simulation: false });
    } else if (mode === "offline") {
      updateStore({ _forcedMode: mode });
      updateStore({ sessionMode: "offline" });
    } else if (mode === "simulation") {
      updateStore({ _forcedMode: mode, sessionMode:"simulation", _simulation:true });
    } else if (mode === "archive") {
      updateStore({ _forcedMode: mode, sessionMode:"archive", _archive:true, _simulation:false });
    } else if (mode === "live") {
      // Forcer le mode live même si le proxy dit archive
      updateStore({ _forcedMode: mode, _simulation:false, _archive:false });
    } else {
      updateStore({ _forcedMode: mode, _simulation:false, _archive:false });
    }
  }

  // .is-open class au lieu de [hidden] — évite le conflit CSS body[data-view=telemetry]
  function openDropdown()  { dropdown?.classList.add("is-open"); }
  function closeDropdown() { dropdown?.classList.remove("is-open"); }
  function toggleDropdown() { dropdown?.classList.toggle("is-open"); }

  toggleBtn?.addEventListener("click", e => {
    e.stopPropagation();
    toggleDropdown();
  });
  document.addEventListener("click", e => {
    if (!dropdown?.contains(e.target) && e.target !== toggleBtn) closeDropdown();
  });
  dropdown?.addEventListener("click", e => e.stopPropagation());

  document.querySelectorAll(".mode-drop-item").forEach(btn => {
    btn.addEventListener("click", () => {
      playSound("click");
      _applyMode(btn.dataset.mode);
      closeDropdown();
      document.getElementById("mobile-drawer")?.classList.remove("open");
      document.getElementById("drawer-backdrop")?.classList.remove("open");
    });
  });

  onUpdate(state => {
    const m = state._forcedMode || state.sessionMode;
    if (m && m !== _currentMode) _syncLabel(m);
  });

  // Mode auto par défaut : laisser le système détecter live/archive
  _applyMode("auto");
}

// ─── Bouton horaires week-end ─────────────────────────────────────────────────

function initScheduleToggle() {
  const btn = document.getElementById("schedule-toggle");
  if (!btn) return;
  onUpdate(state => {
    const sess = state.session || {};
    const cal  = state.calendar || [];
    const gp   = cal.find(r => r.meeting_key === sess.meeting_key
                            || r.meeting_key === String(sess.meeting_key));
    btn.hidden = !gp;
    btn._currentGp = gp || null;
  });
  btn.addEventListener("click", () => {
    playSound("click");
    if (btn._currentGp) showGpOverlay(btn._currentGp);
  });
}

// ─── Session Banner ───────────────────────────────────────────────────────────

const _sbFlag      = document.getElementById("sb-flag-country");
const _sbCircuit   = document.getElementById("sb-circuit");
const _sbType      = document.getElementById("sb-session-type");
const _sbTrackFlag = document.getElementById("sb-track-flag");
const _sbLaps      = document.getElementById("sb-laps");
const _sbLapCur    = document.getElementById("sb-lap-cur");
const _sbLapTot    = document.getElementById("sb-lap-tot");
const _sbRemaining = document.getElementById("sb-time-remaining");
const _sbAir       = document.getElementById("sb-air");
const _sbTrackTemp = document.getElementById("sb-track-temp");
const _sbWind      = document.getElementById("sb-wind");
const _sbRain      = document.getElementById("sb-rain");
const _sbLocalTime = document.getElementById("sb-local-time");
const _sbSessionKey= document.getElementById("sb-session-key");
const _livePill    = document.getElementById("live-status-pill");
const _liveLabel   = document.getElementById("live-status-label");
const _sbSource    = document.getElementById("sb-live-source");

function _updateLiveStatus(state) {
  const ing = state.ingestionStatus;
  const mode = state.sessionMode;
  const isSim = state._simulation || mode === "simulation";
  const isArchive = state._archive || mode === "archive";

  let label = "En attente";
  let cls = "status-connecting";
  let tooltip = "Initialisation de la connexion...";
  let sourceTag = "DÉTECTION";

  if (isSim) {
    label = "Simulation active";
    cls = "status-simulation";
    tooltip = "Mode simulation : Rejeu haute fréquence de télémétrie";
    sourceTag = "🎮 SIMULATION";
  } else if (mode === "offline") {
    label = "Mode Hors-ligne";
    cls = "status-offline";
    tooltip = "Données locales en cache";
    sourceTag = "✈ OFFLINE";
  } else if (mode === "preparing") {
    label = "Séance en préparation";
    cls = "status-preparing";
    tooltip = "En attente du signal vert de la FIA";
    sourceTag = "⏱ PRÉPARATION";
  } else if (ing && (ing.has_token || ing.mode === "live_f1tv_token")) {
    label = "Direct officiel (Token actif)";
    cls = "status-official-live";
    tooltip = `Flux officiel F1 TV actif · Latence temps réel : ~${ing.latency_ms || 100}ms`;
    sourceTag = `⚡ F1TV LIVE (${ing.latency_ms || 100}ms)`;
  } else if (ing && ing.mode === "live_openf1") {
    const latSec = Math.round((ing.latency_ms || 2500) / 1000);
    label = `En direct (Délai OpenF1 ~${latSec}s)`;
    cls = "status-openf1-live";
    tooltip = `Flux public OpenF1 (Polling optimisé à 900ms) · Tolérance 429/502 active`;
    sourceTag = `📡 OPENF1 (+${latSec}s)`;
  } else if (mode === "live") {
    label = "En direct (API)";
    cls = "status-live";
    tooltip = "Connexion télémétrie active";
    sourceTag = "📡 LIVE";
  } else if (isArchive) {
    label = "Session Archivée";
    cls = "status-archive";
    tooltip = "Dernière séance terminée consultable en replay complet";
    sourceTag = "📼 ARCHIVE";
  }

  if (_livePill) {
    _livePill.className = `live-status-pill ${cls}`;
    _livePill.title = tooltip;
  }
  if (_liveLabel) _liveLabel.textContent = label;
  if (_sbSource) {
    _sbSource.textContent = sourceTag;
    _sbSource.className = `sb-live-source-pill ${cls}`;
    _sbSource.title = tooltip;
  }
}

function _updateBanner(state) {
  const sess    = state.session || {};
  const weather = state.weather || {};
  if (_sbFlag) {
    const code = sess.country_code || sess.meeting_country_code || "";
    _sbFlag.textContent = COUNTRY_FLAGS[code] || "";
  }
  if (_sbCircuit)    _sbCircuit.textContent    = sess.circuit_short_name || sess.circuit_name || sess.location || "—";
  if (_sbType)       _sbType.textContent       = sess.session_type || sess.session_name || "—";
  if (_sbSessionKey) _sbSessionKey.textContent = sess.session_key ? "#" + sess.session_key : "";
  const status = String(sess.track_status || "1");
  const label  = TRACK_STATUS_LABELS[status] || TRACK_STATUS_LABELS["1"];
  if (_sbTrackFlag) { _sbTrackFlag.textContent = label.text; _sbTrackFlag.className = "sb-track-status " + label.cls; }
  const trackFlagMap = document.getElementById("track-flag");
  if (trackFlagMap) { trackFlagMap.textContent = "●"; trackFlagMap.className = label.cls; }
  const isRace = sess.session_type === "Race" || sess.session_type === "Sprint";
  if (_sbLaps) _sbLaps.classList.toggle("hidden", !isRace);
  if (isRace && sess.lap_current != null) {
    if (_sbLapCur) _sbLapCur.textContent = sess.lap_current;
    if (_sbLapTot) _sbLapTot.textContent = sess.laps_in_session || sess.lap_total || "—";
  }
  if (_sbRemaining) {
    _sbRemaining.textContent = (sess.race_total_time && isRace)
      ? "⏱ " + sess.race_total_time : (sess.time_remaining || "");
  }
  const airTemp   = weather.air_temp   ?? weather.air_temperature   ?? null;
  const trackTemp = weather.track_temp ?? weather.track_temperature ?? null;
  const windSpeed = weather.wind_speed ?? null;
  if (airTemp != null) {
    if (_sbAir)       _sbAir.textContent      = airTemp.toFixed(1) + "°C";
    if (_sbTrackTemp) _sbTrackTemp.textContent = (trackTemp != null ? trackTemp.toFixed(1) : "—") + "°C";
    if (_sbWind)      _sbWind.textContent      = windSpeed != null ? Math.round(windSpeed * 3.6) + " km/h" : "—";
    if (_sbRain)      _sbRain.hidden           = !weather.rainfall;
  }
  const sessNameEl = document.getElementById("session-name");
  if (sessNameEl) {
    sessNameEl.textContent = [
      sess.circuit_short_name || sess.location || "",
      sess.session_name || sess.session_type || "",
    ].filter(Boolean).join(" · ") || "—";
  }
  _updateLiveStatus(state);
}

setInterval(() => {
  if (_sbLocalTime) {
    _sbLocalTime.textContent = new Date().toLocaleTimeString("fr-FR",
      { hour:"2-digit", minute:"2-digit", second:"2-digit" });
  }
}, 1000);

// ─── Bannière hors-ligne ──────────────────────────────────────────────────────

function initOfflineBanner() {
  const banner = document.getElementById("offline-banner");
  if (!banner) return;
  window.addEventListener("offline", () => { banner.hidden = false; });
  window.addEventListener("online",  () => { banner.hidden = true;  });
}

// ─── Onglets mobiles (vue Télémétrie) ─────────────────────────────────────────

function initMobileTabs() {
  const tabs = document.querySelectorAll(".mob-tab");
  if (!tabs.length) return;
  const tabOrder = ["ov-timing", "ov-map", "ov-rc", "ov-commentary", "ov-compare", "ov-radio"];
  let currentTabIndex = 0;

  function activateMobileTab(targetId) {
    document.querySelectorAll(".dashboard-overlay").forEach(el => el.classList.remove("mob-visible"));
    document.getElementById(targetId)?.classList.add("mob-visible");
    tabs.forEach(t => t.classList.toggle("active", t.dataset.target === targetId));
    const idx = tabOrder.indexOf(targetId);
    if (idx !== -1) currentTabIndex = idx;
    document.querySelectorAll(".tab-dot").forEach(d =>
      d.classList.toggle("active", parseInt(d.dataset.index) === currentTabIndex));
    if (targetId === "ov-timing") {
      setTimeout(() => {
        rebuildMobileTowerRows();
        const tower = document.getElementById("timing-tower");
        if (tower) { tower.style.display = "none"; void tower.offsetHeight; tower.style.display = ""; }
      }, 50);
    }
  }

  tabs.forEach(tab => tab.addEventListener("click", () => {
    playSound("tab");
    activateMobileTab(tab.dataset.target);
  }));

  const dashboard = document.getElementById("dashboard");
  if (dashboard) {
    let touchStartX = 0, touchStartY = 0;
    dashboard.addEventListener("touchstart", e => {
      touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY;
    }, { passive: true });
    dashboard.addEventListener("touchend", e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0 && currentTabIndex < tabOrder.length - 1) activateMobileTab(tabOrder[currentTabIndex + 1]);
        else if (dx > 0 && currentTabIndex > 0) activateMobileTab(tabOrder[currentTabIndex - 1]);
      }
    }, { passive: true });
  }

  function checkMobile() {
    if (window.innerWidth <= 768) {
      const active = document.querySelector(".mob-tab.active");
      if (active) activateMobileTab(active.dataset.target);
    } else {
      document.querySelectorAll(".dashboard-overlay").forEach(el => el.classList.remove("mob-visible"));
    }
  }
  checkMobile();
  window.addEventListener("resize", checkMobile);
}

// ─── Hamburger ────────────────────────────────────────────────────────────────

function initHamburger() {
  const btn      = document.getElementById("hamburger-btn");
  const drawer   = document.getElementById("mobile-drawer");
  const backdrop = document.getElementById("drawer-backdrop");
  if (!btn || !drawer) return;
  const openDrawer = () => {
    drawer.classList.add("open"); backdrop?.classList.add("open");
    btn.classList.add("open"); btn.setAttribute("aria-expanded", "true");
    drawer.setAttribute("aria-hidden", "false");
  };
  const closeDrawer = () => {
    drawer.classList.remove("open"); backdrop?.classList.remove("open");
    btn.classList.remove("open"); btn.setAttribute("aria-expanded", "false");
    drawer.setAttribute("aria-hidden", "true");
  };
  btn.addEventListener("click", () => drawer.classList.contains("open") ? closeDrawer() : openDrawer());
  backdrop?.addEventListener("click", closeDrawer);
  drawer.querySelectorAll(".drawer-link").forEach(link => link.addEventListener("click", closeDrawer));
}

// ─── Mobile timing tower rebuild ─────────────────────────────────────────────

function rebuildMobileTowerRows() {
  if (window.innerWidth > 768) return;
  document.querySelectorAll("#tower-rows .tower-row").forEach(row => {
    if (row.querySelector(".mob-row-a")) return;
    const driverBlock = row.querySelector(".driver-block");
    if (!driverBlock) return;
    const gapEl   = row.querySelector(".gap");
    const sectors = row.querySelectorAll(".sector");
    const lapEl   = row.querySelector(".lap-time");
    const tyreEl  = row.querySelector(".tyre-pill");
    const posEl   = driverBlock.querySelector(".pos-badge");
    const acroEl  = driverBlock.querySelector(".driver-acro");
    const color   = driverBlock.style.borderLeftColor || "#888";
    const bg      = driverBlock.style.background || "";
    const rowA = document.createElement("div"); rowA.className = "mob-row-a";
    const mobBlock = document.createElement("div"); mobBlock.className = "mob-driver-block";
    mobBlock.style.borderLeftColor = color; mobBlock.style.background = bg;
    const mobPos  = document.createElement("span"); mobPos.className = "mob-pos"; mobPos.textContent  = posEl?.textContent || "";
    const mobAcro = document.createElement("span"); mobAcro.className = "mob-acro"; mobAcro.textContent = acroEl?.textContent || "";
    mobBlock.append(mobPos, mobAcro);
    const mobGap  = document.createElement("span"); mobGap.className = "mob-gap"; mobGap.textContent = gapEl?.textContent || "";
    const mobTyre = document.createElement("div"); mobTyre.className = "mob-tyre";
    if (tyreEl) {
      const dot = tyreEl.querySelector(".tyre-dot");
      const age = tyreEl.querySelector("span");
      if (dot) { const c = document.createElement("div"); c.className = dot.className; mobTyre.appendChild(c); }
      if (age) { const c = document.createElement("span"); c.textContent = age.textContent; mobTyre.appendChild(c); }
    }
    rowA.append(mobBlock, mobGap, mobTyre);
    const rowB = document.createElement("div"); rowB.className = "mob-row-b";
    ["S1","S2","S3"].forEach((lbl, i) => {
      const s = sectors[i];
      const lblEl = document.createElement("span"); lblEl.className = "mob-sector-label"; lblEl.textContent = lbl;
      const cell  = document.createElement("span");
      cell.className = s?.className.includes("purple") ? "mob-sector purple"
                     : s?.className.includes("green")  ? "mob-sector green"
                     : s?.className.includes("yellow") ? "mob-sector yellow" : "mob-sector";
      cell.textContent = s?.textContent || "—";
      rowB.append(lblEl, cell);
    });
    const mobLap = document.createElement("span");
    mobLap.className = lapEl?.classList.contains("purple") ? "mob-lap purple" : "mob-lap";
    mobLap.textContent = lapEl?.textContent || "";
    const badge = document.createElement("span");
    badge.className = "mob-best-lap-badge" + (lapEl?.classList.contains("purple") ? " visible" : "");
    badge.textContent = "⚡ BEST";
    rowB.append(mobLap, badge);
    row.append(rowA, rowB);
  });
}

// ─── Init principale ──────────────────────────────────────────────────────────

async function init() {
  document.documentElement.dataset.theme = store.theme || "dark";
  document.documentElement.dataset.oled  = store.oled ? "true" : "false";
  setSoundEnabled(store.uiSound ?? true);
  setSoundVolume((store.uiVolume ?? 60) / 100);

  setNavSoundPlayer(playSound);
  initNavLinks();
  initMobileTabs();
  initHamburger();
  initOfflineBanner();
  initModeSwitcher();
  initScheduleToggle();

  initSettings();
  initOverlayManager();
  initTimingTower();
  initRaceControl();
  initCalendar();
  initStandings();
  initStandingsWithDetail();
  initTrackerMap();
  initSimulation();
  initLiveEvents();
  initCommentary();
  initHeadToHead();
  initRadioPlayer();
  initAlertsEngine();

  // Nouvelles pages
  initHome();
  initResults();
  initNews();

  onUpdate(_updateBanner);

  await loadStaticData();
  watchSessionState();
  scheduleStandingsRefresh();

  console.info("[app] Dashboard F1 v5 initialisé — Home + Résultats actifs");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}