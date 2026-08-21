/**
 * settings.js v6
 * - Modale draggable via son header
 * - Animation trou noir (ouverture/fermeture)
 * - Correction bug display:flex vs [hidden]
 */

import { store, updateStore, savePrefs, onUpdate } from "../store.js";
import { loadImportedTrack } from "./tracker_map.js";
import { applyPreset, PRESET_LAYOUTS } from "./overlay_manager.js";
import { playSound } from "./sound_engine.js";
import { makeDraggable, centerPanel } from "./draggable.js";

const modal    = document.getElementById("settings-modal");
const backdrop = document.getElementById("settings-backdrop");

const TOGGLES = {
  "pref-car-metrics":    "carMetrics",
  "pref-corner-numbers": "cornerNumbers",
  "pref-tower-header":   "towerHeader",
  "pref-best-sectors":   "bestSectors",
  "pref-oled":           "oled",
  "pref-sc-colors":      "scColors",
  "pref-rc-sound":       "rcSound",
  "pref-ui-sound":       "uiSound",
  "pref-event-sound":    "eventSound",
};

// ── Drag ─────────────────────────────────────────────────────────────────────

let _wasMoved = false;
const _handle = modal?.querySelector(".settings-modal-header");
if (modal && _handle) {
  makeDraggable(modal, _handle, { onDragStart: () => { _wasMoved = true; } });
}

// ─── Ouverture / fermeture ────────────────────────────────────────────────────

export function openSettings() {
  _syncToUI();
  if (!modal) return;

  modal.classList.remove("is-closing");
  modal.hidden = false;
  modal.removeAttribute("aria-hidden");
  if (backdrop) { backdrop.hidden = false; backdrop.classList.remove("is-closing"); }

  if (!_wasMoved) centerPanel(modal);

  requestAnimationFrame(() => {
    modal.classList.add("is-opening");
    modal.addEventListener("animationend", () => modal.classList.remove("is-opening"), { once: true });
  });

  document.body.classList.add("settings-open");
  playSound("settings_open");
}

export function closeSettings() {
  savePrefs();
  if (!modal || modal.hidden) return;

  modal.classList.add("is-closing");
  if (backdrop) backdrop.classList.add("is-closing");

  modal.addEventListener("animationend", () => {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.classList.remove("is-closing");
    if (backdrop) { backdrop.hidden = true; backdrop.classList.remove("is-closing"); }
    document.body.classList.remove("settings-open");
  }, { once: true });

  playSound("settings_close");
}

// ─── Boutons ouverture ────────────────────────────────────────────────────────

document.getElementById("settings-toggle")?.addEventListener("click", () => {
  playSound("click");
  openSettings();
});
document.getElementById("drawer-settings-btn")?.addEventListener("click", () => {
  document.getElementById("mobile-drawer")?.classList.remove("open");
  document.getElementById("drawer-backdrop")?.classList.remove("open");
  openSettings();
});

// ─── Boutons fermeture ────────────────────────────────────────────────────────

document.getElementById("settings-close-btn")?.addEventListener("click", closeSettings);
document.getElementById("settings-save-btn")?.addEventListener("click", closeSettings);
backdrop?.addEventListener("click", closeSettings);

// ─── Touche Échap ─────────────────────────────────────────────────────────────

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (modal && !modal.hidden) { e.preventDefault(); closeSettings(); return; }
  const gpOverlay = document.getElementById("gp-overlay");
  if (gpOverlay && !gpOverlay.hidden) { e.preventDefault(); gpOverlay.hidden = true; return; }
  const drawer = document.getElementById("mobile-drawer");
  if (drawer?.classList.contains("open")) {
    e.preventDefault();
    drawer.classList.remove("open");
    document.getElementById("drawer-backdrop")?.classList.remove("open");
    document.getElementById("hamburger-btn")?.classList.remove("open");
  }
});

// ─── Thème ────────────────────────────────────────────────────────────────────

function _applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = theme === "dark" ? "☽ Sombre" : "☀ Clair";
  updateStore({ theme });
}
document.getElementById("theme-toggle")?.addEventListener("click", () => {
  playSound("click");
  _applyTheme(store.theme === "dark" ? "light" : "dark");
});

// ─── Sync store → UI ─────────────────────────────────────────────────────────

function _syncToUI() {
  for (const [id, key] of Object.entries(TOGGLES)) {
    const el = document.getElementById(id);
    if (el) el.checked = !!store[key];
  }
  const volSlider  = document.getElementById("pref-rc-volume");
  const volDisplay = document.getElementById("rc-vol-display");
  if (volSlider)  volSlider.value        = store.rcVolume ?? 50;
  if (volDisplay) volDisplay.textContent = store.rcVolume ?? 50;
  const delayInput = document.getElementById("pref-delay");
  if (delayInput) delayInput.value = store.delay ?? 0;
  document.querySelectorAll(".btn-choice[data-unit]").forEach(b =>
    b.classList.toggle("active", b.dataset.unit === (store.speedUnit || "kmh")));
  document.documentElement.dataset.oled = store.oled ? "true" : "false";
  _applyTheme(store.theme || "dark");
  _syncTrackRadios();
}

// ─── Wiring toggles ──────────────────────────────────────────────────────────

for (const [id, key] of Object.entries(TOGGLES)) {
  const el = document.getElementById(id);
  if (!el) continue;
  el.addEventListener("change", () => {
    updateStore({ [key]: el.checked });
    if (key === "oled") document.documentElement.dataset.oled = el.checked ? "true" : "false";
  });
}
const volSlider  = document.getElementById("pref-rc-volume");
const volDisplay = document.getElementById("rc-vol-display");
volSlider?.addEventListener("input", () => {
  if (volDisplay) volDisplay.textContent = volSlider.value;
  updateStore({ rcVolume: Number(volSlider.value) });
});
document.querySelectorAll(".btn-choice[data-unit]").forEach(btn => {
  btn.addEventListener("click", () => {
    playSound("click");
    document.querySelectorAll(".btn-choice[data-unit]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    updateStore({ speedUnit: btn.dataset.unit });
  });
});
const delayInput = document.getElementById("pref-delay");
delayInput?.addEventListener("change", () => updateStore({ delay: Number(delayInput.value) }));
document.getElementById("delay-reset")?.addEventListener("click", () => {
  if (delayInput) delayInput.value = 0;
  updateStore({ delay: 0 });
});
document.getElementById("delay-pause")?.addEventListener("click", e => {
  e.currentTarget.textContent = e.currentTarget.textContent === "⏸" ? "▶" : "⏸";
});

// ─── Pilotes épinglés ─────────────────────────────────────────────────────────

const favSelect = document.getElementById("pref-favorite-driver");
function _populateFavorites(drivers) {
  if (!favSelect) return;
  const pinned = store.pinnedDrivers || new Set();
  favSelect.replaceChildren();
  Object.entries(drivers)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .forEach(([num, d]) => {
      const opt = document.createElement("option");
      opt.value = num;
      opt.textContent = `#${d.number} ${d.acronym} — ${d.name}`;
      if (pinned.has(Number(num))) opt.selected = true;
      favSelect.appendChild(opt);
    });
}
favSelect?.addEventListener("change", () => {
  const selected = [...favSelect.selectedOptions].map(o => Number(o.value)).filter(Boolean);
  updateStore({ pinnedDrivers: new Set(selected) });
});
onUpdate(state => {
  if (Object.keys(state.drivers || {}).length > 0 && favSelect && favSelect.children.length <= 1) {
    _populateFavorites(state.drivers);
  }
});

// ─── Disposition des panneaux ─────────────────────────────────────────────────

function _initLayoutSection() {
  const presetSel = document.getElementById("layout-preset-select");
  const applyBtn  = document.getElementById("apply-preset-btn");
  const editBtn   = document.getElementById("edit-mode-toggle");
  applyBtn?.addEventListener("click", () => {
    const val = presetSel?.value;
    if (val && PRESET_LAYOUTS?.[val]) applyPreset(val);
  });
  if (editBtn) {
    editBtn.textContent = store.editMode ? "✓ Actif" : "Activer";
    editBtn.classList.toggle("active", !!store.editMode);
  }
  if (presetSel && store.activePreset) presetSel.value = store.activePreset;
}

// ─── Circuit ─────────────────────────────────────────────────────────────────

function _syncTrackRadios() {
  const mode = store.trackDisplayMode || "api";
  document.querySelectorAll('input[name="track-display-mode"]').forEach(r => { r.checked = r.value === mode; });
  const fileSection = document.getElementById("track-import-section");
  if (fileSection) fileSection.hidden = (mode !== "imported");
}

function _initCircuitSection() {
  const radios      = document.querySelectorAll('input[name="track-display-mode"]');
  const fileSection = document.getElementById("track-import-section");
  const fileInput   = document.getElementById("track-geojson-file");
  const fileStatus  = document.getElementById("track-import-status");
  _syncTrackRadios();
  radios.forEach(radio => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      updateStore({ trackDisplayMode: radio.value });
      if (fileSection) fileSection.hidden = (radio.value !== "imported");
      if (fileStatus)  fileStatus.textContent = "";
    });
  });
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (fileStatus) fileStatus.textContent = "Lecture…";
    try {
      const geo = JSON.parse(await file.text());
      const ok  = loadImportedTrack(geo);
      if (ok) {
        updateStore({ trackDisplayMode: "imported", importedTrackGeoJSON: geo });
        radios.forEach(r => { r.checked = r.value === "imported"; });
        if (fileStatus) { fileStatus.textContent = `✅ ${file.name} chargé`; fileStatus.style.color = "#00d2be"; }
      } else {
        if (fileStatus) { fileStatus.textContent = "❌ Format non reconnu"; fileStatus.style.color = "#e10600"; }
      }
    } catch (err) {
      if (fileStatus) { fileStatus.textContent = "❌ Erreur : " + err.message; fileStatus.style.color = "#e10600"; }
    }
  });
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function initSettings() {
  _syncToUI();
  _initLayoutSection();
  _initCircuitSection();
}

// ─── FAQ Accordion ────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".settings-faq .faq-q").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".faq-item");
      const isOpen = item.classList.contains("open");
      // Fermer tous
      document.querySelectorAll(".settings-faq .faq-item.open").forEach(el => {
        el.classList.remove("open");
        el.querySelector(".faq-q").setAttribute("aria-expanded", "false");
      });
      if (!isOpen) {
        item.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });
});