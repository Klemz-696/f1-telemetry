/**
 * live_events.js — Comparateur d'état live → animations temps réel
 *
 * Ce module surveille les changements du store en mode live et déclenche
 * les mêmes animations que la simulation (via animations.js) sans aucun
 * script préétabli.
 *
 * Événements détectés :
 *   - Début de séance (session_type change ou premier appel avec données valides)
 *   - Dépassement    (position d'un pilote diminue)
 *   - Perte de place (position augmente)
 *   - Pit stop       (in_pit passe à false → true)
 *   - Abandon        (retired passe à false → true)
 *   - Meilleur tour  (best_lap passe à false → true)
 *   - Safety Car / VSC / Drapeau rouge (track_status change)
 *   - Drapeau à damier (message "CHEQUERED" dans race_control)
 *
 * Le délai store.delay est respecté : les animations sont planifiées avec
 * le même offset que l'affichage des données.
 *
 * Import dans app.js :
 *   import { initLiveEvents } from "./components/live_events.js";
 *   // appeler dans init() après initSimulation()
 *   initLiveEvents();
 */

import { onUpdate, store }                            from "../store.js";
import { ensureAnimDOMReady, triggerAnim, hlRow }     from "./animations.js";

// ─── État précédent ──────────────────────────────────────────────────────────

/**
 * @type {Map<number, {position: number, in_pit: boolean, retired: boolean, best_lap: boolean}>}
 */
const _prevDrivers  = new Map();
let   _prevStatus   = null;   // track_status
let   _prevSessType = null;   // session_type
let   _initialized  = false;  // premier appel avec données valides
let   _prevRcFirst  = null;   // premier message race_control (détection damier)

// ─── Utilitaire : drapeaux pays pour le début de séance ──────────────────────

const COUNTRY_FLAGS = {
  AU:"🇦🇺", CN:"🇨🇳", JP:"🇯🇵", US:"🇺🇸", CA:"🇨🇦", MC:"🇲🇨", ES:"🇪🇸",
  AT:"🇦🇹", GB:"🇬🇧", BE:"🇧🇪", HU:"🇭🇺", IT:"🇮🇹", NL:"🇳🇱", SG:"🇸🇬",
  MX:"🇲🇽", BR:"🇧🇷", AE:"🇦🇪", SA:"🇸🇦", BH:"🇧🇭", QA:"🇶🇦", AZ:"🇦🇿",
  FR:"🇫🇷", DE:"🇩🇪", FI:"🇫🇮", DK:"🇩🇰",
};

function countryFlag(code) {
  return COUNTRY_FLAGS[code] || "🏁";
}

// ─── Planification avec délai ────────────────────────────────────────────────

/**
 * Déclenche une animation en tenant compte du store.delay.
 * Si delay > 0, les animations sont programmées pour coïncider avec
 * l'affichage des données décalées.
 *
 * @param {Function} animFn  Fonction sans paramètre qui exécute l'animation
 */
function _scheduledAnim(animFn) {
  const delayMs = (store.delay || 0) * 1000;
  if (delayMs > 0) {
    setTimeout(animFn, delayMs);
  } else {
    animFn();
  }
}

// ─── Comparateur principal ───────────────────────────────────────────────────

function _compare(state) {
  // Ne rien faire hors du mode live
  if (state.sessionMode !== "live") return;

  const sess      = state.session  || {};
  const standings = state.standings || [];
  if (!standings.length) return;

  const curStatus   = sess.track_status;
  const curSessType = sess.session_type;

  // ── 1. Début de séance ────────────────────────────────────────────────────
  if (!_initialized || (curSessType && curSessType !== _prevSessType)) {
    if (_initialized) {
      // Changement de type de séance (ex. FP1 → FP2, Quali → Course)
      _scheduledAnim(() => triggerAnim("session_start", {
        flag:        countryFlag(sess.country_code || ""),
        sessionName: curSessType || sess.session_name || "SESSION",
        circuit:     sess.circuit_name || "",
      }));
    }
    _initialized  = true;
    _prevSessType = curSessType;
    // Initialiser l'état précédent sans déclencher d'animation de position
    for (const d of standings) {
      _prevDrivers.set(d.driver_number, {
        position: d.position,
        in_pit:   !!d.in_pit,
        retired:  !!d.retired,
        best_lap: !!d.best_lap,
      });
    }
    _prevStatus = curStatus;
    return;
  }

  // ── 2. Track status (SC / VSC / Drapeau rouge / Retour vert) ─────────────
  if (curStatus !== _prevStatus) {
    _scheduledAnim(() => {
      if      (curStatus === "4") triggerAnim("sc");
      else if (curStatus === "6") triggerAnim("vsc");
      else if (curStatus === "5") triggerAnim("red_flag");
      else if (
        curStatus === "1" &&
        (_prevStatus === "4" || _prevStatus === "5" || _prevStatus === "6")
      ) triggerAnim("green");
    });
    _prevStatus = curStatus;
  }

  // ── 3. Drapeau à damier (race_control) ───────────────────────────────────
  const rc = state.raceControl || [];
  if (rc.length > 0) {
    const firstMsg = rc[0]?.message || "";
    if (firstMsg !== _prevRcFirst) {
      if (firstMsg.toUpperCase().includes("CHEQUERED")) {
        _scheduledAnim(() => triggerAnim("chequered"));
      }
      _prevRcFirst = firstMsg;
    }
  }

  // ── 4. Événements pilotes ─────────────────────────────────────────────────
  for (const d of standings) {
    const prev = _prevDrivers.get(d.driver_number);

    if (!prev) {
      // Pilote nouvellement apparu → initialiser sans animation
      _prevDrivers.set(d.driver_number, {
        position: d.position,
        in_pit:   !!d.in_pit,
        retired:  !!d.retired,
        best_lap: !!d.best_lap,
      });
      continue;
    }

    // Dépassement / perte de place
    if (
      d.position > 0 &&
      prev.position > 0 &&
      d.position !== prev.position
    ) {
      if (d.position < prev.position) {
        // Ce pilote a gagné une place → il a dépassé quelqu'un
        // Chercher le pilote perdant (celui qui avait sa position)
        const loser = standings.find(
          x => x.driver_number !== d.driver_number && x.position === prev.position
        );
        const winner = d;
        _scheduledAnim(() => triggerAnim("overtake", { winner, loser }));
      } else {
        // Ce pilote a perdu une place (la fonction overtake couvre déjà le loser,
        // mais si l'overtaker n'est pas trouvé on envoie quand même un flash de ligne)
        // On évite le double-flash : seulement si l'overtaker n'a pas déjà géré ce cas
        const overtaker = standings.find(
          x => x.driver_number !== d.driver_number && x.position === prev.position
        );
        if (!overtaker) {
          // Perte de place sans overtaker identifiable (ex. pénalité, pit)
          _scheduledAnim(() => hlRow(d.driver_number, "lost-pos-flash"));
        }
      }
    }

    // Pit stop
    if (!prev.in_pit && !!d.in_pit) {
      const driver = d;
      _scheduledAnim(() => triggerAnim("pit", { driver }));
    }

    // Abandon
    if (!prev.retired && !!d.retired) {
      const driver = d;
      _scheduledAnim(() => triggerAnim("retire", { driver }));
    }

    // Meilleur tour (purple lap)
    if (!prev.best_lap && !!d.best_lap) {
      const driver = d;
      _scheduledAnim(() => triggerAnim("purple", { driver }));
    }

    // Mettre à jour l'état précédent
    _prevDrivers.set(d.driver_number, {
      position: d.position,
      in_pit:   !!d.in_pit,
      retired:  !!d.retired,
      best_lap: !!d.best_lap,
    });
  }
}

// ─── Réinitialisation lors d'un changement de session ────────────────────────

/**
 * Réinitialise l'état interne (à appeler lors d'un basculement vers une
 * nouvelle session live, depuis watchSessionState() dans api.js si besoin).
 */
export function resetLiveEvents() {
  _prevDrivers.clear();
  _prevStatus   = null;
  _prevSessType = null;
  _initialized  = false;
  _prevRcFirst  = null;
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────

/**
 * Initialise le module de détection d'événements live.
 * À appeler une seule fois depuis app.js après initSimulation().
 */
export function initLiveEvents() {
  // S'assurer que les éléments DOM d'animation existent
  ensureAnimDOMReady();

  // S'abonner aux mises à jour du store
  onUpdate(_compare);

  console.info("[live_events] Initialisé — détection d'événements live active");
}