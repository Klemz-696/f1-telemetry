/**
 * nav.js v2 — Singleton de navigation centralisé
 * Nouvelles vues : #home (accueil) et #results (résultats de saison)
 */

export const KNOWN_HASHES = ["#home", "#telemetry", "#results", "#calendar", "#standings"];

let _playSound = () => {};
export function setNavSoundPlayer(fn) { _playSound = fn; }

// ─── Activation d'une vue ─────────────────────────────────────────────────────

export function activateView(hash) {
  if (!KNOWN_HASHES.includes(hash)) hash = "#home";
  const target = hash.replace("#", "");

  document.querySelectorAll(".view").forEach(v => {
    v.classList.toggle("active", v.id === "view-" + target);
  });
  document.querySelectorAll(".nav-link, .drawer-link").forEach(l => {
    l.classList.toggle("active", l.getAttribute("href") === hash);
  });

  // Expose la vue active sur body pour le CSS (mode switcher, etc.)
  document.body.dataset.view = target;

  // Émettre un événement custom pour que home.js/results.js puissent réagir
  // sans dépendre de popstate (qui n'est pas déclenché par history.pushState)
  window.dispatchEvent(new CustomEvent("viewchange", { detail: { hash, view: target } }));
}

// ─── Settings ────────────────────────────────────────────────────────────────

let _prevHash = "#home";

export function openSettings() {
  _prevHash = KNOWN_HASHES.includes(location.hash) ? location.hash : "#home";

  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const sv = document.getElementById("view-settings");
  if (sv) sv.classList.add("active");

  history.pushState(null, "", "#settings");
  _playSound("settings_open");
}

export function closeSettings() {
  history.replaceState(null, "", _prevHash);
  activateView(_prevHash);
  _playSound("settings_close");
}

// ─── Init navigation ──────────────────────────────────────────────────────────

export function initNavLinks() {
  document.querySelectorAll(".nav-link, .drawer-link").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const hash = link.getAttribute("href");
      if (hash === "#settings") return;
      _playSound("nav");
      history.pushState(null, "", hash);
      activateView(hash);
      document.getElementById("mobile-drawer")?.classList.remove("open");
      document.getElementById("drawer-backdrop")?.classList.remove("open");
    });
  });

  window.addEventListener("popstate", () => {
    const hash = location.hash || "#home";
    if (hash === "#settings") {
      activateView(_prevHash);
      return;
    }
    activateView(hash);
  });

  // Chargement initial — jamais afficher settings au démarrage
  const initHash = KNOWN_HASHES.includes(location.hash) ? location.hash : "#home";
  if (location.hash === "#settings" || !KNOWN_HASHES.includes(location.hash)) {
    history.replaceState(null, "", initHash);
  }
  activateView(initHash);
}