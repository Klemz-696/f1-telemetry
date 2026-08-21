/**
 * race_control.js  v2
 *
 * AMÉLIORATIONS :
 *  - Panel scrollable (overflow-y: auto déjà dans le CSS, maintenu)
 *  - Défilement automatique vers le haut à l'arrivée de nouveaux messages
 *    (les messages les plus récents sont en tête de liste)
 *  - Intl.DateTimeFormat instancié une seule fois → fuseau horaire local du client
 *  - Badge de catégorie (SafetyCar, Incident, etc.) si présent
 *  - textContent uniquement → zéro XSS ni fuite mémoire DOM
 */

import { onUpdate } from "../store.js";

const container = document.getElementById("rc-messages");

// Mapping drapeaux → classe CSS
const FLAG_CLASS = {
  GREEN:  "rc-flag-green",
  YELLOW: "rc-flag-yellow",
  RED:    "rc-flag-red",
  SC:     "rc-flag-yellow",
  VSC:    "rc-flag-yellow",
};

// Formateur Intl — instancié une fois (coût CPU non négligeable)
// Respecte le fuseau horaire LOCAL de la machine du client
const _timeFmt = new Intl.DateTimeFormat(navigator.language, {
  hour:     "2-digit",
  minute:   "2-digit",
  second:   "2-digit",
  hour12:   false,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

function formatTime(iso) {
  if (!iso) return "";
  try { return _timeFmt.format(new Date(iso)); }
  catch { return String(iso); }
}

// Timestamp du premier message lors du dernier rendu (détection nouveaux messages)
let _lastFirstTimestamp = null;

function render(state) {
  const messages = state.raceControl || [];
  if (!messages.length) {
    if (container && (container.children.length === 0 || !container.querySelector(".rc-empty-placeholder"))) {
      container.replaceChildren();
      const placeholder = document.createElement("div");
      placeholder.className = "rc-item rc-empty-placeholder";
      placeholder.style.color = "var(--text-dim)";
      placeholder.style.fontStyle = "italic";
      placeholder.style.textAlign = "center";
      placeholder.style.padding = "12px";
      placeholder.textContent = "Aucun message pour le moment.";
      container.appendChild(placeholder);
    }
    return;
  }

  // Skip si rien n'a changé
  const firstTs = messages[0]?.timestamp;
  if (firstTs === _lastFirstTimestamp) return;
  _lastFirstTimestamp = firstTs;

  // Mémoriser la position de scroll (pour préserver l'intention de l'utilisateur)
  const wasAtTop = container.scrollTop < 4;

  container.replaceChildren();

  for (const msg of messages) {
    const item = document.createElement("div");
    item.className = ["rc-item", FLAG_CLASS[msg.flag] || ""].filter(Boolean).join(" ");

    // Horodatage
    const time = document.createElement("div");
    time.className   = "rc-time";
    time.textContent = formatTime(msg.timestamp);

    // Badge catégorie (SafetyCar, Incident, StewardDecision…)
    if (msg.category && msg.category !== "Other") {
      const cat = document.createElement("span");
      cat.className   = "rc-category";
      cat.textContent = msg.category;
      item.append(time, cat);
    } else {
      item.append(time);
    }

    // Texte du message
    const text = document.createElement("div");
    text.className   = "rc-msg-text";
    text.textContent = msg.message || "";
    item.appendChild(text);

    container.appendChild(item);
  }

  // Ramener au début si l'utilisateur y était (nouveau message en tête)
  if (wasAtTop) container.scrollTop = 0;
}

export function initRaceControl() {
  onUpdate(render);
}