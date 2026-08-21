/**
 * draggable.js — Utilitaire drag pour modales et panneaux flottants
 * Supporte souris + tactile. Contrainte aux bords de l'écran.
 *
 * Usage :
 *   makeDraggable(panelEl, handleEl, { onDragStart })
 *   centerPanel(panelEl)
 */

export function makeDraggable(panel, handle, { onDragStart } = {}) {
  if (!panel || !handle) return;

  let dragging = false;
  let offX = 0, offY = 0;

  // S'assurer que le panneau est positionnable
  const pos = getComputedStyle(panel).position;
  if (pos === "static" || pos === "") panel.style.position = "fixed";

  handle.addEventListener("mousedown", _startMouse);
  handle.addEventListener("touchstart", _startTouch, { passive: false });

  function _startMouse(e) {
    if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;
    dragging = true;
    if (onDragStart) onDragStart();
    // Figer la position (retire transform: translate(-50%,-50%) si présent)
    panel.style.transition = "none";
    panel.style.transform  = "none";
    panel.style.left = rect.left + "px";
    panel.style.top  = rect.top  + "px";
    handle.style.cursor = "grabbing";
    document.addEventListener("mousemove", _onMove);
    document.addEventListener("mouseup",   _onUp);
  }

  function _startTouch(e) {
    if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
    e.preventDefault();
    const t = e.touches[0];
    const rect = panel.getBoundingClientRect();
    offX = t.clientX - rect.left;
    offY = t.clientY - rect.top;
    dragging = true;
    if (onDragStart) onDragStart();
    panel.style.transition = "none";
    panel.style.transform  = "none";
    panel.style.left = rect.left + "px";
    panel.style.top  = rect.top  + "px";
    document.addEventListener("touchmove", _onMoveTouch, { passive: false });
    document.addEventListener("touchend",  _onUpTouch);
  }

  function _onMove(e)      { if (dragging) _move(e.clientX, e.clientY); }
  function _onMoveTouch(e) { if (dragging) { e.preventDefault(); _move(e.touches[0].clientX, e.touches[0].clientY); } }

  function _move(x, y) {
    const W = window.innerWidth,  H = window.innerHeight;
    const w = panel.offsetWidth,  h = panel.offsetHeight;
    panel.style.left = Math.max(0, Math.min(W - w, x - offX)) + "px";
    panel.style.top  = Math.max(0, Math.min(H - h, y - offY)) + "px";
  }

  function _onUp() {
    dragging = false;
    handle.style.cursor = "";
    document.removeEventListener("mousemove", _onMove);
    document.removeEventListener("mouseup",   _onUp);
  }
  function _onUpTouch() {
    dragging = false;
    document.removeEventListener("touchmove", _onMoveTouch);
    document.removeEventListener("touchend",  _onUpTouch);
  }

  // Recadrer si redimensionnement fait sortir le panneau
  window.addEventListener("resize", () => {
    if (panel.hidden || panel.style.display === "none") return;
    const r = panel.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    if (r.right  > W) panel.style.left = Math.max(0, W - panel.offsetWidth)  + "px";
    if (r.bottom > H) panel.style.top  = Math.max(0, H - panel.offsetHeight) + "px";
  });
}

/**
 * Centre un panneau fixed dans la fenêtre (reset position initiale).
 * À appeler avant de montrer le panneau pour la 1ère fois, ou après reset.
 */
export function centerPanel(panel) {
  if (!panel) return;
  panel.style.transform = "none";
  // requestAnimationFrame garantit que offsetWidth/Height sont connus
  requestAnimationFrame(() => {
    panel.style.left = Math.max(0, (window.innerWidth  - panel.offsetWidth)  / 2) + "px";
    panel.style.top  = Math.max(0, (window.innerHeight - panel.offsetHeight) / 2) + "px";
  });
}
