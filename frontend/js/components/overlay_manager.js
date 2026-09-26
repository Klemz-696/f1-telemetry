/**
 * overlay_manager.js v3
 * NOUVEAUTÉS v3 :
 *  - ov-commentary ajouté aux overlays gérés
 *  - Boutons A+/A− dans chaque poignée (font-size indépendant par overlay)
 *  - Resize toujours disponible (pas besoin du mode edit)
 *  - Fix bug flash vide au démarrage : visibility:hidden → visible au 1er rendu
 */

import { store, updateStore, savePrefs } from "../store.js";

export const PRESET_LAYOUTS = {
  broadcast: {
    "ov-timing":     { x: 0,  y: 0, w: 31, h: 100, visible: true,  z: 11 },
    "ov-map":        { x: 31, y: 0, w: 46, h: 100, visible: true,  z: 10 },
    "ov-rc":         { x: 77, y: 0, w: 23, h: 100, visible: true,  z: 12 },
    "ov-commentary": { x: 77, y: 55, w: 23, h: 45, visible: false, z: 13 },
    "ov-compare":    { x: 31, y: 55, w: 46, h: 45, visible: false, z: 14 },
    "ov-radio":      { x: 77, y: 55, w: 23, h: 45, visible: false, z: 15 },
  },
  "focus-map": {
    "ov-timing":     { x: 0,  y: 62, w: 26, h: 38, visible: true,  z: 12 },
    "ov-map":        { x: 0,  y: 0,  w: 100, h: 100, visible: true, z: 10 },
    "ov-rc":         { x: 74, y: 62, w: 26, h: 38, visible: true,  z: 11 },
    "ov-commentary": { x: 74, y: 0,  w: 26, h: 38, visible: false, z: 13 },
    "ov-compare":    { x: 0,  y: 62, w: 74, h: 38, visible: false, z: 14 },
    "ov-radio":      { x: 74, y: 0,  w: 26, h: 38, visible: false, z: 15 },
  },
  compare: {
    "ov-timing":     { x: 0,  y: 0,  w: 24, h: 100, visible: true,  z: 11 },
    "ov-map":        { x: 24, y: 0,  w: 42, h: 54,  visible: true,  z: 10 },
    "ov-rc":         { x: 66, y: 0,  w: 34, h: 54,  visible: true,  z: 12 },
    "ov-commentary": { x: 66, y: 0,  w: 34, h: 54,  visible: false, z: 13 },
    "ov-compare":    { x: 24, y: 54, w: 76, h: 46,  visible: true,  z: 15 },
    "ov-radio":      { x: 66, y: 0,  w: 34, h: 54,  visible: false, z: 16 },
  },
  radios: {
    "ov-timing":     { x: 0,  y: 0,  w: 26, h: 100, visible: true,  z: 11 },
    "ov-map":        { x: 26, y: 0,  w: 42, h: 100, visible: true,  z: 10 },
    "ov-rc":         { x: 68, y: 0,  w: 32, h: 48,  visible: true,  z: 12 },
    "ov-commentary": { x: 68, y: 0,  w: 32, h: 48,  visible: false, z: 13 },
    "ov-compare":    { x: 26, y: 55, w: 42, h: 45, visible: false, z: 14 },
    "ov-radio":      { x: 68, y: 48, w: 32, h: 52, visible: true,  z: 16 },
  },
  minimal: {
    "ov-timing":     { x: 0,  y: 0, w: 36, h: 100, visible: true,  z: 11 },
    "ov-map":        { x: 36, y: 0, w: 64, h: 100, visible: true,  z: 10 },
    "ov-rc":         { x: 80, y: 0, w: 20, h: 0,   visible: false, z: 12 },
    "ov-commentary": { x: 80, y: 0, w: 20, h: 0,   visible: false, z: 13 },
    "ov-compare":    { x: 36, y: 55, w: 64, h: 45, visible: false, z: 14 },
    "ov-radio":      { x: 80, y: 0, w: 20, h: 0,   visible: false, z: 15 },
  },
};

const OVERLAY_IDS = ["ov-timing", "ov-map", "ov-rc", "ov-commentary", "ov-compare", "ov-radio"];

// Font sizes par overlay (en px), stockées dans le store
const DEFAULT_FONT_SIZE = { "ov-timing": 12, "ov-map": 12, "ov-rc": 12, "ov-commentary": 12, "ov-compare": 12, "ov-radio": 12 };
const MIN_FONT = 8;
const MAX_FONT = 22;

function _getFontSizes() {
  return store.overlayFontSizes || { ...DEFAULT_FONT_SIZE };
}

function _applyFontSize(id, size) {
  const el = _getEl(id);
  if (el) el.style.setProperty("--ov-font-size", size + "px");
}

function _changeFontSize(id, delta) {
  const sizes = { ..._getFontSizes() };
  sizes[id] = Math.max(MIN_FONT, Math.min(MAX_FONT, (sizes[id] || 12) + delta));
  _applyFontSize(id, sizes[id]);
  updateStore({ overlayFontSizes: sizes });
  try {
    const prefs = JSON.parse(localStorage.getItem("f1-prefs") || "{}");
    prefs.overlayFontSizes = sizes;
    localStorage.setItem("f1-prefs", JSON.stringify(prefs));
  } catch {}
}

// ─── Gestion z-index ─────────────────────────────────────────────────────────

let _zCounter = 15;

function _getEl(id) { return document.getElementById(id); }

function _applyZ(id, z) {
  const el = _getEl(id);
  if (el) el.style.zIndex = String(z || 10);
}

function _bringToFront(id) {
  _zCounter++;
  _applyZ(id, _zCounter);
  const layouts = { ..._currentLayouts() };
  if (layouts[id]) layouts[id].z = _zCounter;
  _saveLayouts(layouts);
}

function _sendToBack(id) {
  const others = OVERLAY_IDS.filter(i => i !== id);
  const minZ = Math.min(...others.map(i => {
    const el = _getEl(i);
    return el ? parseInt(el.style.zIndex) || 10 : 10;
  }));
  _applyZ(id, Math.max(9, minZ - 1));
  const layouts = { ..._currentLayouts() };
  if (layouts[id]) layouts[id].z = Math.max(9, minZ - 1);
  _saveLayouts(layouts);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _applyLayout(id, layout) {
  const el = _getEl(id);
  if (!el) return;
  el.style.left    = layout.x + "%";
  el.style.top     = layout.y + "%";
  el.style.width   = layout.w + "%";
  el.style.height  = layout.h + "%";
  el.style.display = layout.visible === false ? "none" : "";
  if (layout.z) el.style.zIndex = String(layout.z);
}

function _applyAllLayouts(layouts) {
  for (const id of OVERLAY_IDS) {
    if (layouts[id]) _applyLayout(id, layouts[id]);
  }
}

function _currentLayouts() {
  return store.overlayLayouts || PRESET_LAYOUTS.broadcast;
}

function _saveLayouts(layouts) {
  updateStore({ overlayLayouts: layouts });
  try {
    const prefs = JSON.parse(localStorage.getItem("f1-prefs") || "{}");
    prefs.overlayLayouts = layouts;
    localStorage.setItem("f1-prefs", JSON.stringify(prefs));
  } catch {}
}

export function applyPreset(name) {
  const layout = PRESET_LAYOUTS[name];
  if (!layout) return;
  _applyAllLayouts(layout);
  _saveLayouts({ ...layout });
  updateStore({ activePreset: name });
  _syncVisibilityToggles();
}

function _syncVisibilityToggles() {
  const layouts = _currentLayouts();
  for (const id of OVERLAY_IDS) {
    const toggleEl = document.getElementById("ov-vis-" + id);
    if (toggleEl) toggleEl.checked = layouts[id]?.visible !== false;
  }
}

// ─── Utilitaires de clamp ─────────────────────────────────────────────────────

function _pxToPercent(dashboard, px, axis) {
  const rect = dashboard.getBoundingClientRect();
  return axis === "x" ? (px / rect.width * 100) : (px / rect.height * 100);
}

function _clampPos(overlay, newLeft, newTop) {
  const w = parseFloat(overlay.style.width)  || 30;
  const h = parseFloat(overlay.style.height) || 100;
  return {
    left: Math.max(0, Math.min(100 - w, newLeft)),
    top:  Math.max(0, Math.min(100 - h, newTop)),
  };
}

function _clampSize(overlay, newW, newH) {
  const left = parseFloat(overlay.style.left) || 0;
  const top  = parseFloat(overlay.style.top)  || 0;
  return {
    w: Math.max(8,  Math.min(100 - left, newW)),
    h: Math.max(10, Math.min(100 - top,  newH)),
  };
}

// ─── Drag ─────────────────────────────────────────────────────────────────────

function _makeDraggable(overlay, handle, dashboard) {
  const startDrag = (clientX, clientY) => {
    if (!store.editMode) return false;
    _bringToFront(overlay.id);
    overlay.classList.add("dragging");
    const startLeft = parseFloat(overlay.style.left) || 0;
    const startTop  = parseFloat(overlay.style.top)  || 0;
    return { clientX, clientY, startLeft, startTop };
  };

  const onMove = (state, clientX, clientY) => {
    const dx = _pxToPercent(dashboard, clientX - state.clientX, "x");
    const dy = _pxToPercent(dashboard, clientY - state.clientY, "y");
    const { left, top } = _clampPos(overlay, state.startLeft + dx, state.startTop + dy);
    overlay.style.left = left + "%";
    overlay.style.top  = top  + "%";
  };

  const onEnd = () => {
    overlay.classList.remove("dragging");
    _persistCurrentGeometry(overlay.id, dashboard);
  };

  handle.addEventListener("mousedown", e => {
    // Ne pas déclencher sur les boutons dans la poignée
    if (e.target.tagName === "BUTTON") return;
    const state = startDrag(e.clientX, e.clientY);
    if (!state) return;
    e.preventDefault();
    const mmove = ev => onMove(state, ev.clientX, ev.clientY);
    const mup   = ()  => { document.removeEventListener("mousemove", mmove); document.removeEventListener("mouseup", mup); onEnd(); };
    document.addEventListener("mousemove", mmove);
    document.addEventListener("mouseup",   mup);
  });

  handle.addEventListener("touchstart", e => {
    if (e.target.tagName === "BUTTON") return;
    const t = e.touches[0];
    const state = startDrag(t.clientX, t.clientY);
    if (!state) return;
    const tmove = ev => { const t2 = ev.touches[0]; onMove(state, t2.clientX, t2.clientY); ev.preventDefault(); };
    const tend  = ()  => { handle.removeEventListener("touchmove", tmove); handle.removeEventListener("touchend", tend); onEnd(); };
    handle.addEventListener("touchmove", tmove, { passive: false });
    handle.addEventListener("touchend",  tend);
  }, { passive: true });
}

// ─── Resize — toujours actif (pas besoin du mode edit) ────────────────────────

function _makeResizable(overlay, resizeHandle, dashboard) {
  const startResize = (clientX, clientY) => {
    _bringToFront(overlay.id);
    overlay.classList.add("resizing");
    return {
      clientX, clientY,
      startW: parseFloat(overlay.style.width)  || 30,
      startH: parseFloat(overlay.style.height) || 100,
    };
  };

  const onMove = (state, clientX, clientY) => {
    const dw = _pxToPercent(dashboard, clientX - state.clientX, "x");
    const dh = _pxToPercent(dashboard, clientY - state.clientY, "y");
    const { w, h } = _clampSize(overlay, state.startW + dw, state.startH + dh);
    overlay.style.width  = w + "%";
    overlay.style.height = h + "%";
  };

  const onEnd = () => {
    overlay.classList.remove("resizing");
    _persistCurrentGeometry(overlay.id, dashboard);
  };

  resizeHandle.addEventListener("mousedown", e => {
    const state = startResize(e.clientX, e.clientY);
    e.preventDefault();
    const mmove = ev => onMove(state, ev.clientX, ev.clientY);
    const mup   = ()  => { document.removeEventListener("mousemove", mmove); document.removeEventListener("mouseup", mup); onEnd(); };
    document.addEventListener("mousemove", mmove);
    document.addEventListener("mouseup",   mup);
  });

  resizeHandle.addEventListener("touchstart", e => {
    const t = e.touches[0];
    const state = startResize(t.clientX, t.clientY);
    const tmove = ev => { const t2 = ev.touches[0]; onMove(state, t2.clientX, t2.clientY); ev.preventDefault(); };
    const tend  = ()  => { resizeHandle.removeEventListener("touchmove", tmove); resizeHandle.removeEventListener("touchend", tend); onEnd(); };
    resizeHandle.addEventListener("touchmove", tmove, { passive: false });
    resizeHandle.addEventListener("touchend",  tend);
  }, { passive: true });
}

// ─── Persistance géométrie ────────────────────────────────────────────────────

function _persistCurrentGeometry(overlayId, dashboard) {
  const el = _getEl(overlayId);
  if (!el) return;
  const layouts = { ..._currentLayouts() };
  layouts[overlayId] = {
    x: parseFloat(el.style.left)    || 0,
    y: parseFloat(el.style.top)     || 0,
    w: parseFloat(el.style.width)   || 30,
    h: parseFloat(el.style.height)  || 100,
    z: parseInt(el.style.zIndex)    || 10,
    visible: el.style.display !== "none",
  };
  _saveLayouts(layouts);
  updateStore({ activePreset: "custom" });
  _syncPresetSelect();
}

// ─── Mode édition ─────────────────────────────────────────────────────────────

function _setEditMode(enabled) {
  updateStore({ editMode: enabled });
  document.getElementById("dashboard")?.classList.toggle("edit-mode", enabled);
  const btn = document.getElementById("edit-mode-toggle");
  if (btn) {
    btn.textContent = enabled ? "✓ Actif" : "Activer";
    btn.classList.toggle("active", enabled);
  }
}

function _syncPresetSelect() {
  const sel = document.getElementById("layout-preset-select");
  if (sel) sel.value = store.activePreset || "broadcast";
}

// ─── Initialisation ───────────────────────────────────────────────────────────

export function initOverlayManager() {
  const dashboard = _getEl("dashboard");
  if (!dashboard) { console.error("[overlay_manager] #dashboard introuvable"); return; }

  const savedLayouts = store.overlayLayouts;
  const layouts = savedLayouts && Object.keys(savedLayouts).length > 0
    ? savedLayouts : PRESET_LAYOUTS.broadcast;
  _applyAllLayouts(layouts);

  // Appliquer les font sizes sauvegardées
  const sizes = _getFontSizes();
  for (const id of OVERLAY_IDS) _applyFontSize(id, sizes[id] || 12);

  for (const id of OVERLAY_IDS) {
    const overlay     = _getEl(id);
    if (!overlay) continue;

    const handle       = overlay.querySelector(".ov-drag-handle");
    const resizeHandle = overlay.querySelector(".ov-resize-handle");

    if (handle)       _makeDraggable(overlay, handle, dashboard);
    if (resizeHandle) _makeResizable(overlay, resizeHandle, dashboard);

    // Clic sur l'overlay → premier plan (mode edit)
    overlay.addEventListener("mousedown", () => { if (store.editMode) _bringToFront(id); }, true);

    // Boutons poignée
    const btnFront = overlay.querySelector(".ov-btn-front");
    const btnBack  = overlay.querySelector(".ov-btn-back");
    if (btnFront) btnFront.addEventListener("click", e => { e.stopPropagation(); _bringToFront(id); });
    if (btnBack)  btnBack.addEventListener("click",  e => { e.stopPropagation(); _sendToBack(id); });

    // Boutons font size
    const btnFontUp   = overlay.querySelector(".ov-btn-font-up");
    const btnFontDown = overlay.querySelector(".ov-btn-font-down");
    if (btnFontUp)   btnFontUp.addEventListener("click",   e => { e.stopPropagation(); _changeFontSize(id, +1); });
    if (btnFontDown) btnFontDown.addEventListener("click", e => { e.stopPropagation(); _changeFontSize(id, -1); });
  }

  // Sélecteur prédispositions
  const presetSel = document.getElementById("layout-preset-select");
  if (presetSel) {
    presetSel.value = store.activePreset || "broadcast";
    presetSel.addEventListener("change", () => applyPreset(presetSel.value));
  }

  const applyBtn = document.getElementById("apply-preset-btn");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      const sel = document.getElementById("layout-preset-select");
      if (sel) applyPreset(sel.value);
    });
  }

  const editBtn = document.getElementById("edit-mode-toggle");
  if (editBtn) {
    editBtn.addEventListener("click", () => _setEditMode(!store.editMode));
    _setEditMode(store.editMode || false);
  }

  // Toggles visibilité
  for (const id of OVERLAY_IDS) {
    const toggleEl = document.getElementById("ov-vis-" + id);
    if (!toggleEl) continue;
    toggleEl.addEventListener("change", () => {
      const el = _getEl(id);
      if (el) el.style.display = toggleEl.checked ? "" : "none";
      const lays = { ..._currentLayouts() };
      if (lays[id]) lays[id].visible = toggleEl.checked;
      _saveLayouts(lays);
      updateStore({ activePreset: "custom" });
      _syncPresetSelect();
    });
  }

  _syncVisibilityToggles();
  _syncPresetSelect();

  console.info("[overlay_manager] Initialisé — layout:", store.activePreset || "broadcast");
}

export function bringOverlayToFront(id)  { _bringToFront(id); }
export function sendOverlayToBack(id)    { _sendToBack(id); }
