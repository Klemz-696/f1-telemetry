/**
 * animations.js — Module d'animations partagé
 *
 * Contient toutes les fonctions d'animation visuelles utilisées à la fois
 * par simulation.js et par live_events.js (mode live temps réel).
 *
 * Exports publics :
 *   ensureAnimDOMReady()   — crée sim-anim-overlay + sim-checkered-rain si absents
 *   triggerAnim(type, data) — déclenche une animation par type
 *   showOv(icon,title,sub,color,cls) — affiche l'overlay animé
 *   hlRow(driverNumber, cls) — flash une ligne de la timing tower
 *   launchRain()            — animation damier (arrivée)
 */

// Timeout interne pour l'auto-disparition de l'overlay
let _ovTimeout = null;

// Référence canvas (injectée par ensureAnimDOMReady ou setCanvas)
let _canvas = null;

// ─── Initialisation DOM ──────────────────────────────────────────────────────

/**
 * S'assure que sim-anim-overlay et sim-checkered-rain existent dans map-container.
 * À appeler depuis initSimulation() ET depuis initLiveEvents().
 * Idempotent : sans effet si les éléments existent déjà.
 * @returns {HTMLCanvasElement|null} Le canvas track-canvas
 */
export function ensureAnimDOMReady() {
  const mc = document.getElementById("map-container");
  if (mc) {
    if (!document.getElementById("sim-anim-overlay")) {
      const ov = document.createElement("div");
      ov.id        = "sim-anim-overlay";
      ov.className = "sim-anim-overlay";
      ov.style.display = "none";
      mc.appendChild(ov);
    }
    if (!document.getElementById("sim-checkered-rain")) {
      const r = document.createElement("div");
      r.id        = "sim-checkered-rain";
      r.className = "sim-checkered-rain";
      r.style.display = "none";
      mc.appendChild(r);
    }
  }
  _canvas = document.getElementById("track-canvas");
  return _canvas;
}

/** Permet d'injecter le canvas depuis l'extérieur (ex. simulation.js qui le crée) */
export function setAnimCanvas(canvas) {
  _canvas = canvas;
}

// ─── Overlay animé ───────────────────────────────────────────────────────────

/**
 * Affiche l'overlay animé centré sur la carte.
 * @param {string} icon   Emoji ou texte icône
 * @param {string} title  Ligne principale (ex. "DÉPASSEMENT")
 * @param {string} sub    Ligne secondaire (ex. "VER P1")
 * @param {string} color  Couleur CSS (hex)
 * @param {string} cls    Classe CSS d'animation (ex. "anim-overtake")
 */
export function showOv(icon, title, sub, color, cls) {
  const ov = document.getElementById("sim-anim-overlay");
  if (!ov) return;

  if (_ovTimeout) clearTimeout(_ovTimeout);
  ov.className   = "sim-anim-overlay";
  ov.innerHTML   = "";
  ov.style.display = "none";
  // Force reflow pour relancer les transitions CSS
  void ov.offsetWidth;

  ov.style.display = "flex";
  ov.style.setProperty("--anim-color", color);
  ov.className = "sim-anim-overlay " + cls;
  ov.innerHTML = `<div class="sim-anim-card">
    <span class="sim-anim-icon">${icon}</span>
    <span class="sim-anim-title" style="color:${color}">${title}</span>
    <span class="sim-anim-sub">${sub}</span>
  </div>`;

  _ovTimeout = setTimeout(() => {
    ov.classList.add("sim-anim-fadeout");
    setTimeout(() => {
      ov.style.display = "none";
      ov.className     = "sim-anim-overlay";
    }, 400);
  }, 3000);
}

// ─── Flash ligne timing tower ────────────────────────────────────────────────

/**
 * Ajoute une classe CSS flash sur la ligne du pilote dans la timing tower.
 * @param {number|string} num  driver_number
 * @param {string}        cls  Classe CSS (ex. "overtake-flash", "pit-flash")
 */
export function hlRow(num, cls) {
  if (!num) return;
  document.querySelectorAll(".tower-row").forEach(r => {
    if (r.dataset.drv == num) {
      r.classList.add(cls);
      setTimeout(() => r.classList.remove(cls), 1800);
    }
  });
}

// ─── Pluie de damiers ────────────────────────────────────────────────────────

/** Lance l'animation de confettis damier (fin de course). */
export function launchRain() {
  const r = document.getElementById("sim-checkered-rain");
  if (!r) return;
  r.innerHTML      = "";
  r.style.display  = "block";
  for (let i = 0; i < 35; i++) {
    const sq = document.createElement("div");
    sq.className            = "checkered-square";
    sq.style.left           = `${Math.random() * 100}%`;
    sq.style.animationDelay    = `${Math.random() * 2}s`;
    sq.style.animationDuration = `${1.5 + Math.random() * 2}s`;
    r.appendChild(sq);
  }
  setTimeout(() => { r.style.display = "none"; r.innerHTML = ""; }, 8000);
}

// ─── Dispatch canvas ─────────────────────────────────────────────────────────

/**
 * Dispatch l'événement "sim-purple-lap" sur le canvas (écouté par tracker_map.js).
 * @param {object} driver  Objet driver avec team_color, acronym, driver_number
 */
export function dispatchPurpleLap(driver) {
  if (_canvas) {
    _canvas.dispatchEvent(new CustomEvent("sim-purple-lap", {
      detail: { color: driver.team_color, driver },
    }));
  }
}

// ─── triggerAnim : point d'entrée unifié ─────────────────────────────────────

/**
 * Déclenche une animation par type. Interface identique à l'ancienne _anim()
 * interne de simulation.js, désormais publique et partagée.
 *
 * @param {string} type   "sc"|"vsc"|"red_flag"|"green"|"purple"|"overtake"|
 *                        "pit"|"retire"|"chequered"|"session_start"
 * @param {object} data   Données contextuelles (driver, winner, loser, sessionName, flag)
 */
export function triggerAnim(type, data = {}) {
  const ov = document.getElementById("sim-anim-overlay");
  if (!ov) return;

  if (_ovTimeout) clearTimeout(_ovTimeout);
  ov.className     = "sim-anim-overlay";
  ov.innerHTML     = "";
  ov.style.display = "none";
  void ov.offsetWidth;

  const mc = document.getElementById("map-container");
  mc && mc.classList.remove("anim-sc", "anim-vsc", "anim-red", "anim-green", "anim-purple");

  switch (type) {
    case "sc":
      showOv("🟡", "SAFETY CAR", "DÉPLOYÉE", "#ffd700", "anim-sc");
      mc && mc.classList.add("anim-sc");
      break;

    case "vsc":
      showOv("🟡", "VIRTUAL SC", "ACTIF", "#ff8800", "anim-vsc");
      mc && mc.classList.add("anim-vsc");
      break;

    case "red_flag":
      showOv("🚩", "DRAPEAU ROUGE", "NEUTRALISATION", "#e10600", "anim-red");
      mc && mc.classList.add("anim-red");
      break;

    case "green":
      showOv("🟢", "PISTE LIBRE", "GO GO GO !", "#00d2be", "anim-green");
      mc && mc.classList.add("anim-green");
      break;

    case "purple":
      if (data.driver) {
        showOv("💜", "MEILLEUR TOUR", data.driver.acronym, "#9b59ff", "anim-purple");
        mc && mc.classList.add("anim-purple");
        dispatchPurpleLap(data.driver);
      }
      break;

    case "overtake":
      if (data.winner) {
        showOv(
          "⚔️", "DÉPASSEMENT",
          "P" + data.winner.position + " " + data.winner.acronym,
          data.winner.team_color || "#ffffff",
          "anim-overtake"
        );
        hlRow(data.winner.driver_number, "overtake-flash");
        hlRow(data.loser?.driver_number, "lost-pos-flash");
      }
      break;

    case "pit":
      if (data.driver) {
        showOv("🔧", "PIT STOP", data.driver.acronym, "#ffd700", "anim-pit");
        hlRow(data.driver.driver_number, "pit-flash");
      }
      break;

    case "retire":
      if (data.driver) {
        showOv("💥", "ABANDON", data.driver.acronym, "#e10600", "anim-retire");
        hlRow(data.driver.driver_number, "retire-flash");
      }
      break;

    case "chequered":
      showOv("🏁", "ARRIVÉE", "FIN DE SESSION", "#ffffff", "anim-chequered");
      launchRain();
      break;

    case "session_start":
      // Overlay de début de séance (live seulement)
      showOv(
        data.flag || "🏁",
        data.sessionName || "SESSION",
        data.circuit    || "",
        "#ffd700",
        "anim-green"
      );
      mc && mc.classList.add("anim-green");
      break;
  }
}