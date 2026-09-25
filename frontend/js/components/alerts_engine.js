/**
 * alerts_engine.js
 * Moteur d'alertes personnalisables et système de notifications Toasts & Desktop OS.
 * Détecte les micro-événements stratégiques en comparant l'état N vs N-1 du store.
 */

import { onUpdate, store } from "../store.js";
import { playSound } from "./sound_engine.js";

// Conteneur DOM pour les toasts
let _toastContainer = null;

// État mémoire de référence (N-1) pour le moteur différentiel
let _isWarmedUp = false;
let _lastTrackStatus = null;
let _lastLeaderNumber = null;
let _lastBestLapAcro = null;
let _lastPitStates = new Map();
let _lastPositions = new Map();
let _lastRainfall = false;
let _processedRcKeys = new Set();
let _lastCliffAlerted = new Set();

/**
 * Initialise le moteur d'alertes et crée le conteneur de toasts
 */
export function initAlertsEngine() {
  _getOrCreateContainer();

  // Écoute les mises à jour du store
  onUpdate((state) => {
    evaluateAlerts(state);
  });
}

function _getOrCreateContainer() {
  if (!_toastContainer) {
    _toastContainer = document.getElementById("alerts-toast-container");
    if (!_toastContainer) {
      _toastContainer = document.createElement("div");
      _toastContainer.id = "alerts-toast-container";
      _toastContainer.className = "alerts-toast-container";
      _toastContainer.setAttribute("aria-live", "polite");
      document.body.appendChild(_toastContainer);
    }
  }
  return _toastContainer;
}

/**
 * Demande d'autorisation pour les notifications natives du navigateur (Desktop OS)
 */
export async function requestDesktopNotificationPermission() {
  if (!("Notification" in window)) {
    alert("Votre navigateur ne supporte pas les notifications de bureau.");
    return false;
  }
  if (Notification.permission === "granted") return true;
  const perm = await Notification.requestPermission();
  return perm === "granted";
}

/**
 * Déclenche une alerte visuelle (Toast), sonore et système (Desktop)
 */
export function spawnAlert({
  title,
  message,
  severity = "info",    // "critical" | "warning" | "info" | "success"
  soundName = null,
  category = "COURSE",
  onClick = null
}) {
  const cfg = store.alertsConfig || {};
  if (cfg.enabled === false) return;

  // 1. Rendu Sonore
  if (cfg.soundAlerts !== false && soundName) {
    try {
      playSound(soundName);
    } catch (e) {}
  }

  // 2. Notification Système (Desktop OS) si onglet en arrière-plan
  if (cfg.desktopNotifications && "Notification" in window && Notification.permission === "granted") {
    if (document.hidden || !document.hasFocus()) {
      try {
        const notif = new Notification(`F1 Telemetry · ${title}`, {
          body: message,
          icon: "/favicon.ico",
          tag: `f1-${title}`,
        });
        if (onClick) notif.onclick = onClick;
      } catch (e) {}
    }
  }

  // 3. Rendu Toast Visuel
  const container = _getOrCreateContainer();
  if (!container) return;

  // Limite le nombre simultané de toasts à 4 (supprime le plus vieux)
  if (container.children.length >= 4) {
    const oldest = container.firstElementChild;
    if (oldest) _removeToast(oldest);
  }

  const toast = document.createElement("div");
  toast.className = `alert-toast toast-${severity}`;

  const iconMap = {
    critical: "🔴",
    warning: "⚠️",
    info: "ℹ️",
    success: "⚡"
  };
  const icon = iconMap[severity] || "🏁";

  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-cat-badge">${icon} ${category}</span>
      <button class="toast-close-btn" title="Fermer">✕</button>
    </div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${message}</div>
    </div>
    <div class="toast-progress">
      <div class="toast-progress-bar"></div>
    </div>
  `;

  // Fermeture au clic sur le bouton close
  const closeBtn = toast.querySelector(".toast-close-btn");
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    _removeToast(toast);
  });

  // Action optionnelle au clic sur le corps du toast
  if (onClick) {
    toast.style.cursor = "pointer";
    toast.addEventListener("click", () => {
      onClick();
      _removeToast(toast);
    });
  }

  // Gestion du timer de fermeture automatique (5 secondes)
  const DURATION_MS = 5000;
  let remainingMs = DURATION_MS;
  let startTime = Date.now();
  let timerId = null;

  const startTimer = () => {
    startTime = Date.now();
    timerId = setTimeout(() => {
      _removeToast(toast);
    }, remainingMs);
  };

  const pauseTimer = () => {
    clearTimeout(timerId);
    remainingMs -= (Date.now() - startTime);
  };

  toast.addEventListener("mouseenter", pauseTimer);
  toast.addEventListener("mouseleave", startTimer);

  container.appendChild(toast);
  startTimer();
}

function _removeToast(toast) {
  if (!toast || toast.classList.contains("is-leaving")) return;
  toast.classList.add("is-leaving");
  toast.addEventListener("animationend", () => {
    toast.remove();
  }, { once: true });
}

/**
 * Analyse différentielle de l'état entrant du store
 */
function evaluateAlerts(state) {
  const cfg = store.alertsConfig;
  if (!cfg || cfg.enabled === false) return;

  const triggers = cfg.triggers || {};
  const pinned = store.pinnedDrivers || new Set();
  const onlyFav = !!cfg.onlyFavoriteDrivers;

  // Initialisation à froid au 1er appel pour éviter un flood de notifications au chargement
  if (!_isWarmedUp) {
    _warmUpState(state);
    _isWarmedUp = true;
    return;
  }

  // ── 1. Sécurité / Neutralisation Course ─────────────────────────────────────
  const currentTrackStatus = String(state.session?.track_status || "1");
  if (triggers.safetyCar && _lastTrackStatus !== null && currentTrackStatus !== _lastTrackStatus) {
    if (currentTrackStatus === "4") {
      spawnAlert({
        title: "SAFETY CAR DÉPLOYÉ",
        message: "Voiture de sécurité en piste — Rythme neutralisé.",
        severity: "critical",
        soundName: "yellow_flag",
        category: "SÉCURITÉ",
      });
    } else if (currentTrackStatus === "6") {
      spawnAlert({
        title: "VIRTUAL SAFETY CAR",
        message: "VSC activé — Respectez le delta de temps obligatoire.",
        severity: "warning",
        soundName: "yellow_flag",
        category: "SÉCURITÉ",
      });
    } else if (currentTrackStatus === "5") {
      spawnAlert({
        title: "DRAPEAU ROUGE",
        message: "Séance interrompue — Retournez immédiatement aux stands.",
        severity: "critical",
        soundName: "red_flag",
        category: "SÉCURITÉ",
      });
    } else if (currentTrackStatus === "1" && ["4", "5", "6"].includes(_lastTrackStatus)) {
      spawnAlert({
        title: "DRAPEAU VERT",
        message: "Piste dégagée — Reprise de la course !",
        severity: "success",
        soundName: "green_flag",
        category: "COURSE",
      });
    }
  }
  _lastTrackStatus = currentTrackStatus;

  // ── 2. Arrêts aux stands & Dépassements ─────────────────────────────────────
  const standings = state.standings || [];
  if (standings.length > 0) {

    // Changement de leader
    if (triggers.leadChange && standings[0]) {
      const leaderNum = standings[0].driver_number;
      if (_lastLeaderNumber !== null && leaderNum !== _lastLeaderNumber && (state.session?.lap_current || 0) > 1) {
        spawnAlert({
          title: "NOUVEAU LEADER",
          message: `${standings[0].acronym} (#${leaderNum}) prend la tête du Grand Prix !`,
          severity: "info",
          soundName: "lead_change",
          category: "LEADER",
        });
      }
      _lastLeaderNumber = leaderNum;
    }

    // Parcours de tous les pilotes pour stands, dépassements, record tour
    for (const d of standings) {
      const num = d.driver_number;
      const isPinned = pinned.has(num) || (store.pinnedDriver && String(store.pinnedDriver) === String(num));
      const shouldNotify = !onlyFav || isPinned;

      // Arrêts aux stands
      if (triggers.pitStops && shouldNotify) {
        const wasInPit = _lastPitStates.get(num) ?? false;
        const isNowInPit = !!d.in_pit;
        if (!wasInPit && isNowInPit) {
          spawnAlert({
            title: "ARRÊT AUX STANDS",
            message: `${d.acronym} (#${num}) rentre dans la voie des stands.`,
            severity: "info",
            soundName: "pit",
            category: "STRATÉGIE",
          });
        }
      }
      _lastPitStates.set(num, !!d.in_pit);

      // Meilleur tour absolu
      if (triggers.fastestLap && d.best_lap && _lastBestLapAcro !== d.acronym) {
        spawnAlert({
          title: "MEILLEUR TOUR EN COURSE",
          message: `Nouveau meilleur tour absolu pour ${d.acronym} (#${num}) !`,
          severity: "success",
          soundName: "best_lap",
          category: "CHRONO",
        });
        _lastBestLapAcro = d.acronym;
      }

      // Changement de position pour pilotes suivis
      if (triggers.positionChanges && isPinned) {
        const oldPos = _lastPositions.get(num);
        const curPos = d.position;
        if (oldPos !== undefined && curPos && curPos !== oldPos) {
          const delta = oldPos - curPos;
          if (delta > 0) {
            spawnAlert({
              title: "DÉPASSEMENT",
              message: `${d.acronym} gagne +${delta} place${delta > 1 ? "s" : ""} (P${curPos}) !`,
              severity: "success",
              soundName: "overtake",
              category: "PILOTE SUIVI",
            });
          } else if (delta < 0) {
            spawnAlert({
              title: "POSITION PERDUE",
              message: `${d.acronym} rétrograde en P${curPos} (${delta}).`,
              severity: "warning",
              soundName: "overtake",
              category: "PILOTE SUIVI",
            });
          }
        }
      }
      if (d.position) _lastPositions.set(num, d.position);
    }
  }

  // ── 3. Direction de Course (Enquêtes & Pénalités) ───────────────────────────
  if (triggers.stewardsDecisions && Array.isArray(state.raceControl)) {
    for (const msg of state.raceControl) {
      const msgKey = `${msg.timestamp}_${msg.message}`;
      if (!_processedRcKeys.has(msgKey)) {
        _processedRcKeys.add(msgKey);
        const text = (msg.message || "").toUpperCase();
        if (text.includes("INVESTIGATION") || text.includes("PENALTY") || text.includes("TIME PENALTY") || text.includes("INCIDENT")) {
          spawnAlert({
            title: "DÉCISION COMMISSAIRES",
            message: msg.message,
            severity: "warning",
            soundName: "steward",
            category: "COMMISSAIRES",
          });
        }
      }
    }
  }

  // ── 4. Alerte Météo (Pluie) ────────────────────────────────────────────────
  const isRaining = !!state.weather?.rainfall;
  if (triggers.rainArrival && isRaining && !_lastRainfall) {
    spawnAlert({
      title: "PLUIE DÉTECTÉE",
      message: "Précipitations signalées sur le circuit ! Préparer les gommes intermédiaires.",
      severity: "warning",
      soundName: "rain",
      category: "MÉTÉO",
    });
  }
  _lastRainfall = isRaining;
}

/**
 * Enregistre l'état initial sans déclencher d'alertes
 */
function _warmUpState(state) {
  _lastTrackStatus = String(state.session?.track_status || "1");
  if (state.standings && state.standings[0]) {
    _lastLeaderNumber = state.standings[0].driver_number;
    for (const d of state.standings) {
      _lastPitStates.set(d.driver_number, !!d.in_pit);
      if (d.position) _lastPositions.set(d.driver_number, d.position);
      if (d.best_lap) _lastBestLapAcro = d.acronym;
    }
  }
  if (Array.isArray(state.raceControl)) {
    for (const m of state.raceControl) {
      _processedRcKeys.add(`${m.timestamp}_${m.message}`);
    }
  }
  _lastRainfall = !!state.weather?.rainfall;
}
