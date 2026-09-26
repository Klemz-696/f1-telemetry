/**
 * commentary.js v2
 * - Graceful degradation si le proxy est indisponible (502 / réseau)
 * - Utilise les données race_control du store en fallback
 * - Polling uniquement en mode live, désactivé si proxy KO
 */

import { onUpdate, store, updateStore } from "../store.js";

function detectProxy() {
  const h = window.location.hostname;
  const p = window.location.port;
  if (p === "8080" || p === "80" || p === "443" || p === "" || (h !== "localhost" && h !== "127.0.0.1")) {
    return `${window.location.origin}/proxy`;
  }
  return "http://localhost:3001";
}
const PROXY = detectProxy();

const panel   = document.getElementById("commentary-messages");
const overlay = document.getElementById("ov-commentary");

const MAX_MESSAGES = 60;
const _messages   = [];
let   _lastFetch  = 0;
let   _pollTimer  = null;
let   _lastSessionKey = null;
let   _proxyFailed    = false;

// ─── Rendu d'un message ────────────────────────────────────────────────────────

function _renderMessage(msg) {
  const el = document.createElement("div");
  el.className = "rc-msg rc-msg-commentary" + (msg._new ? " rc-msg-new" : "");
  const time = document.createElement("span");
  time.className = "rc-time";
  time.textContent = msg.time || "";
  const source = document.createElement("span");
  source.className = "commentary-source";
  source.textContent = msg.source || "Session";
  const text = document.createElement("span");
  text.className = "rc-text";
  text.textContent = msg.message || msg.text || "";
  el.append(time, source, text);
  return el;
}

// ─── Ajout d'un message (dédupliqué) ──────────────────────────────────────────

function addMessage(msg) {
  if (!msg || !(msg.message || msg.text)) return;
  const key = (msg.date || msg.time || "") + (msg.message || msg.text || "");
  if (_messages.some(m => (m.date || m.time || "") + (m.message || m.text || "") === key)) return;
  msg._new = true;
  _messages.push(msg);
  if (_messages.length > MAX_MESSAGES) _messages.shift();
  if (!panel) return;
  const el = _renderMessage(msg);
  panel.insertBefore(el, panel.firstChild);
  if (panel.children.length > MAX_MESSAGES) panel.removeChild(panel.lastChild);
  setTimeout(() => { el.classList.remove("rc-msg-new"); }, 3000);
}

// ─── Injecter depuis les données race_control du store ────────────────────────

function _ingestFromStore(rcData) {
  if (!Array.isArray(rcData) || rcData.length === 0) return;
  for (const item of rcData) {
    addMessage({
      date:    item.date || "",
      time:    item.date ? new Date(item.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "",
      source:  item.category || "Info",
      message: item.message || "",
    });
  }
}

// ─── Polling API (live uniquement) ────────────────────────────────────────────

async function _fetchCommentary(sessionKey) {
  if (!sessionKey || _proxyFailed) return;
  try {
    const url = `${PROXY}/openf1/race_control?session_key=${sessionKey}&category=Other&limit=30`;
    const res = await fetch(url);
    if (!res.ok) {
      _proxyFailed = true;
      _stopPolling();
      _showProxyWarning();
      return;
    }
    _proxyFailed = false;
    const data = await res.json();
    if (!Array.isArray(data)) return;
    for (const item of [...data].reverse()) {
      addMessage({
        date:    item.date,
        time:    item.date ? new Date(item.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "",
        source:  item.category || "Info",
        message: item.message,
      });
    }
  } catch {
    _proxyFailed = true;
    _stopPolling();
    _showProxyWarning();
  }
}

function _showProxyWarning() {
  if (!panel || panel.querySelector(".commentary-proxy-warn")) return;
  const warn = document.createElement("div");
  warn.className = "rc-msg commentary-proxy-warn";
  warn.innerHTML = `<span class="rc-text" style="color:var(--text-dim);font-style:italic">
    ⚠ Commentaires live indisponibles (proxy hors-ligne).<br>
    Les messages restent disponibles dans le panneau DIR. COURSE.
  </span>`;
  panel.appendChild(warn);
}

function _startPolling(sessionKey) {
  if (_proxyFailed) return;
  if (_pollTimer) clearInterval(_pollTimer);
  _fetchCommentary(sessionKey);
  _pollTimer = setInterval(() => _fetchCommentary(sessionKey), 15_000);
}

function _stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// ─── Écoute du store ──────────────────────────────────────────────────────────

onUpdate(state => {
  const mode = state.sessionMode;

  if (mode === "offline") {
    if (overlay) overlay.hidden = true;
    _stopPolling();
    return;
  }

  if (overlay) overlay.hidden = false;

  const sessionKey = state.session?.session_key;

  if (sessionKey && sessionKey !== _lastSessionKey) {
    _lastSessionKey = sessionKey;
    _messages.length = 0;
    _proxyFailed = false;
    if (panel) panel.replaceChildren();
    if (mode === "live") _startPolling(sessionKey);
  }

  // Toujours ingérer depuis le store (disponible en archive + live)
  if (state.raceControl?.length) _ingestFromStore(state.raceControl);

  if (state._wsCommentary && state._wsCommentary !== _lastFetch) {
    _lastFetch = state._wsCommentary;
    addMessage(state._wsCommentaryMsg);
  }
});

export function initCommentary() {
  if (panel && _messages.length === 0) {
    const el = document.createElement("div");
    el.className = "rc-msg";
    const t = document.createElement("span");
    t.className = "rc-text";
    t.style.color = "var(--text-dim)";
    t.textContent = "En attente de commentaires…";
    el.appendChild(t);
    panel.appendChild(el);
  }
}
