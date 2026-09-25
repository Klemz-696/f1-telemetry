/**
 * radio_player.js
 * Composant de lecture audio et transcription des communications radio d'équipes (Team Radio F1).
 * Comprend :
 *  - Ingestion en temps réel via WebSocket (store.team_radios) et API REST (/api/radio)
 *  - Lecteur audio HTML5 broadcast avec oscillateur Web Audio (bips d'ouverture de radio F1)
 *  - Visualiseur d'ondes (waveform animé) synchronisé avec la lecture
 *  - Filtrage par pilote et par catégorie tactique (Stratégie, Pneus, Technique, Incidents)
 *  - Auto-play optionnel pour le pilote favori ou épinglé
 */

import { onUpdate, store } from "../store.js";

// Cache local des messages radio
let _radios = [];
let _currentPlayingId = null;
let _selectedDriver = "all";
let _selectedCategory = "ALL";
let _autoPlayFav = false;
let _audioCtx = null;
let _audioElement = null;

// Catégories tactiques et couleurs associées
const CATEGORY_META = {
  STRATEGY:  { label: "STRATÉGIE", color: "#ff9100", icon: "📋" },
  TIRE:      { label: "PNEUMATIQUES", color: "#ffd600", icon: "🛞" },
  TECHNICAL: { label: "TECHNIQUE", color: "#00e5ff", icon: "⚙️" },
  INCIDENT:  { label: "INCIDENT / SÉCURITÉ", color: "#ff1744", icon: "⚠️" },
  GENERAL:   { label: "COURSE", color: "#76ff03", icon: "💬" },
};

/**
 * Mots-clés F1 mis en valeur dans les transcriptions
 */
const HIGHLIGHT_KEYWORDS = [
  "BOX BOX", "BOX THIS LAP", "BOX", "PLAN A", "PLAN B", "PLAN C",
  "UNDERCUT", "OVERCUT", "STAY OUT", "PIT CONFIRM", "IN-LAP",
  "SAFETY CAR", "VSC", "VIRTUAL SAFETY CAR", "YELLOW FLAG", "DEBRIS",
  "TYRES ARE OVERHEATING", "TYRE TEMPS", "GRAINING", "BLISTERING",
  "ENGINE MODE", "LIFT AND COAST", "BRAKE BALANCE", "RECHARGE", "DIFF",
  "FASTEST LAP", "DRS ENABLED", "PUSH NOW", "DELTA POSITIVE"
];

function highlightTranscript(text) {
  if (!text) return "";
  let highlighted = text;
  for (const kw of HIGHLIGHT_KEYWORDS) {
    const regex = new RegExp(`\\b(${kw})\\b`, "gi");
    highlighted = highlighted.replace(regex, '<span class="radio-kw-glow">$1</span>');
  }
  return highlighted;
}

/**
 * Initialise le contexte Web Audio pour jouer le bip radio F1 officiel
 */
function getAudioContext() {
  if (!_audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) _audioCtx = new AudioCtx();
  }
  if (_audioCtx && _audioCtx.state === "suspended") {
    _audioCtx.resume();
  }
  return _audioCtx;
}

/**
 * Génère le double-bip caractéristique d'ouverture de radio F1 (880 Hz puis 1320 Hz)
 */
function playRadioBeep(onComplete) {
  try {
    const ctx = getAudioContext();
    if (!ctx) {
      if (onComplete) onComplete();
      return;
    }

    const now = ctx.currentTime;

    // Bip 1 (Grave ~880 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.08, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.07);

    // Bip 2 (Aigu ~1320 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1320, now + 0.08);
    gain2.gain.setValueAtTime(0.09, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.16);

    setTimeout(() => {
      if (onComplete) onComplete();
    }, 180);
  } catch (e) {
    if (onComplete) onComplete();
  }
}

/**
 * Initialisation du composant Radio
 */
export function initRadioPlayer() {
  const container = document.getElementById("ov-radio");
  if (!container) return;

  _audioElement = document.getElementById("html5-radio-audio") || new Audio();
  _audioElement.id = "html5-radio-audio";

  // Récupération de la préférence autoplay
  const autoPlayCb = document.getElementById("radio-autoplay-fav");
  if (autoPlayCb) {
    _autoPlayFav = localStorage.getItem("f1_radio_autoplay") === "true";
    autoPlayCb.checked = _autoPlayFav;
    autoPlayCb.addEventListener("change", (e) => {
      _autoPlayFav = e.target.checked;
      localStorage.setItem("f1_radio_autoplay", String(_autoPlayFav));
    });
  }

  // Écouteur sur le filtre pilote
  const drvFilter = document.getElementById("radio-driver-filter");
  if (drvFilter) {
    drvFilter.addEventListener("change", (e) => {
      _selectedDriver = e.target.value;
      renderFeed();
    });
  }

  // Écouteur sur les pilules de catégorie
  const catPills = container.querySelectorAll(".radio-cat-pill");
  catPills.forEach(pill => {
    pill.addEventListener("click", () => {
      catPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      _selectedCategory = pill.dataset.cat || "ALL";
      renderFeed();
    });
  });

  // Bouton play/pause du lecteur principal
  const masterPlayBtn = document.getElementById("radio-master-play-btn");
  if (masterPlayBtn) {
    masterPlayBtn.addEventListener("click", () => {
      if (!_currentPlayingId && _radios.length > 0) {
        playMessage(_radios[0]);
        return;
      }
      if (_audioElement.paused) {
        _audioElement.play().catch(() => {});
      } else {
        _audioElement.pause();
      }
    });
  }

  // Contrôles de volume
  const volSlider = document.getElementById("radio-volume-slider");
  if (volSlider) {
    const savedVol = parseFloat(localStorage.getItem("f1_radio_vol") || "0.8");
    volSlider.value = savedVol;
    _audioElement.volume = savedVol;
    volSlider.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      _audioElement.volume = v;
      localStorage.setItem("f1_radio_vol", String(v));
    });
  }

  // Événements audio
  _audioElement.addEventListener("play", () => {
    setWaveformActive(true);
    updateMasterPlayIcon(true);
    updateFeedPlayStates();
  });

  _audioElement.addEventListener("pause", () => {
    setWaveformActive(false);
    updateMasterPlayIcon(false);
    updateFeedPlayStates();
  });

  _audioElement.addEventListener("ended", () => {
    setWaveformActive(false);
    updateMasterPlayIcon(false);
    _currentPlayingId = null;
    updateFeedPlayStates();
  });

  _audioElement.addEventListener("timeupdate", () => {
    updateProgress();
  });

  _audioElement.addEventListener("error", () => {
    // Si l'URL distante échoue (ex: CORS OpenF1), simule la lecture pour garder l'animation
    setWaveformActive(false);
    updateMasterPlayIcon(false);
  });

  // Chargement initial depuis l'API REST
  fetchLatestRadios();

  // Écoute du flux temps réel (WebSocket)
  onUpdate((state) => {
    if (Array.isArray(state.team_radios) && state.team_radios.length > 0) {
      ingestNewRadios(state.team_radios);
    }
    populateDriverFilter(state);
  });
}

/**
 * Récupère les radios récentes via l'API REST FastAPI
 */
async function fetchLatestRadios() {
  try {
    const res = await fetch("/api/radio?limit=40");
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.radios) && data.radios.length > 0) {
      ingestNewRadios(data.radios);
    }
  } catch (e) {
    // Silencieux
  }
}

/**
 * Intègre de nouveaux messages radio et gère l'auto-play
 */
function ingestNewRadios(incomingList) {
  let hasNew = false;
  const existingIds = new Set(_radios.map(r => r.id));

  for (const item of incomingList) {
    if (!existingIds.has(item.id)) {
      _radios.unshift(item);
      existingIds.add(item.id);
      hasNew = true;

      // Auto-play si favori ou épinglé
      if (_autoPlayFav && isFavoriteDriver(item.driver_number)) {
        playMessage(item);
      }
    }
  }

  if (hasNew) {
    // Trie chronologique inverse
    _radios.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    renderFeed();
  }
}

function isFavoriteDriver(driverNumber) {
  if (store.pinnedDrivers && store.pinnedDrivers.has(driverNumber)) return true;
  if (store.pinnedDriver && String(store.pinnedDriver) === String(driverNumber)) return true;
  return false;
}

/**
 * Peuple le sélecteur de pilotes avec la liste des concurrents
 */
function populateDriverFilter(state) {
  const select = document.getElementById("radio-driver-filter");
  if (!select) return;

  const currentVal = select.value;
  const driversMap = new Map();

  // Standings ou drivers meta
  const standings = state.standings || [];
  for (const d of standings) {
    driversMap.set(String(d.driver_number), `${d.acronym || d.driver_number} - ${d.team}`);
  }

  // Complète avec store.drivers si dispo
  if (store.drivers) {
    for (const [k, d] of Object.entries(store.drivers)) {
      if (!driversMap.has(String(k))) {
        driversMap.set(String(k), `${d.acronym || k} - ${d.team || "F1"}`);
      }
    }
  }

  if (driversMap.size === 0) return;

  // Reconstruit les options si le nombre a changé
  if (select.children.length - 1 !== driversMap.size) {
    select.innerHTML = '<option value="all">📻 Tous les pilotes</option>';
    for (const [num, label] of driversMap.entries()) {
      const opt = document.createElement("option");
      opt.value = num;
      opt.textContent = `#${num} ${label}`;
      select.appendChild(opt);
    }
    select.value = currentVal || "all";
  }
}

/**
 * Joue un message radio avec bip radio F1 préalable
 */
export function playMessage(radio) {
  if (!radio) return;

  _currentPlayingId = radio.id;
  updateNowPlayingHeader(radio);

  // Déclenche le bip radio officiel
  playRadioBeep(() => {
    if (_audioElement) {
      if (radio.recording_url) {
        _audioElement.src = radio.recording_url;
        _audioElement.play().catch(() => {
          // Si le navigateur bloque l'autoplay ou si l'audio distant a un problème CORS,
          // on simule la durée de lecture (3.5s) pour animer le waveform
          simulatePlayback();
        });
      } else {
        simulatePlayback();
      }
    }
  });

  updateFeedPlayStates();
}

function simulatePlayback() {
  setWaveformActive(true);
  updateMasterPlayIcon(true);
  setTimeout(() => {
    setWaveformActive(false);
    updateMasterPlayIcon(false);
    _currentPlayingId = null;
    updateFeedPlayStates();
  }, 3800);
}

/**
 * Met à jour le bloc "En cours d'écoute"
 */
function updateNowPlayingHeader(radio) {
  const driverTag = document.getElementById("now-playing-driver");
  const timeTag   = document.getElementById("now-playing-time");
  const textBox   = document.getElementById("now-playing-text");
  const catBadge  = document.getElementById("now-playing-cat");

  const catMeta = CATEGORY_META[radio.category] || CATEGORY_META.GENERAL;

  if (driverTag) {
    driverTag.innerHTML = `
      <span class="np-color-bar" style="background:${radio.team_color}"></span>
      <span class="np-acronym">${radio.driver_acronym}</span>
      <span class="np-num">#${radio.driver_number}</span>
      <span class="np-team">${radio.team_name}</span>
    `;
  }

  if (timeTag) timeTag.textContent = radio.timestamp || "--:--:--";
  if (catBadge) {
    catBadge.textContent = `${catMeta.icon} ${catMeta.label}`;
    catBadge.style.color = catMeta.color;
    catBadge.style.borderColor = `${catMeta.color}66`;
    catBadge.style.background = `${catMeta.color}15`;
  }

  if (textBox) {
    textBox.innerHTML = `
      <span class="radio-quote-icon">“</span>
      ${highlightTranscript(radio.transcript)}
      <span class="radio-quote-icon">”</span>
    `;
  }
}

function setWaveformActive(active) {
  const waveWrap = document.getElementById("radio-waveform");
  if (waveWrap) {
    waveWrap.classList.toggle("is-active", active);
  }
}

function updateMasterPlayIcon(isPlaying) {
  const btn = document.getElementById("radio-master-play-btn");
  if (btn) {
    btn.innerHTML = isPlaying ? "⏸" : "▶";
    btn.title = isPlaying ? "Mettre en pause" : "Écouter";
  }
}

function updateProgress() {
  if (!_audioElement || !_audioElement.duration) return;
  const pct = (_audioElement.currentTime / _audioElement.duration) * 100;
  const fill = document.getElementById("radio-progress-fill");
  const timeCur = document.getElementById("radio-time-current");
  const timeDur = document.getElementById("radio-time-total");

  if (fill) fill.style.width = `${pct}%`;
  if (timeCur) timeCur.textContent = formatSecs(_audioElement.currentTime);
  if (timeDur) timeDur.textContent = formatSecs(_audioElement.duration);
}

function formatSecs(sec) {
  if (isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/**
 * Met à jour les icônes play/pause des cartes de la liste
 */
function updateFeedPlayStates() {
  const feed = document.getElementById("radio-messages-feed");
  if (!feed) return;

  const isAudioPlaying = _audioElement && !_audioElement.paused;

  feed.querySelectorAll(".radio-card").forEach(card => {
    const cardId = card.dataset.id;
    const isThisPlaying = cardId === _currentPlayingId;
    card.classList.toggle("is-playing", isThisPlaying && isAudioPlaying);

    const playBtn = card.querySelector(".card-play-btn");
    if (playBtn) {
      playBtn.textContent = (isThisPlaying && isAudioPlaying) ? "⏸" : "▶";
    }
  });
}

/**
 * Rendu de la liste chronologique des cartes radio
 */
function renderFeed() {
  const feed = document.getElementById("radio-messages-feed");
  if (!feed) return;

  // Filtrage
  let filtered = _radios;
  if (_selectedDriver !== "all") {
    filtered = filtered.filter(r => String(r.driver_number) === String(_selectedDriver));
  }
  if (_selectedCategory !== "ALL") {
    filtered = filtered.filter(r => (r.category || "").toUpperCase() === _selectedCategory);
  }

  if (filtered.length === 0) {
    feed.innerHTML = `
      <div class="radio-feed-empty">
        <span class="empty-icon">📻</span>
        <span>Aucune communication radio trouvée pour ces filtres.</span>
      </div>
    `;
    return;
  }

  feed.innerHTML = "";

  for (const radio of filtered) {
    const isPlaying = radio.id === _currentPlayingId && _audioElement && !_audioElement.paused;
    const catMeta = CATEGORY_META[radio.category] || CATEGORY_META.GENERAL;
    const urgentClass = radio.is_urgent ? "is-urgent-msg" : "";

    const card = document.createElement("div");
    card.className = `radio-card ${urgentClass} ${isPlaying ? "is-playing" : ""}`;
    card.dataset.id = radio.id;
    card.style.borderLeftColor = radio.team_color || "#888";

    card.innerHTML = `
      <div class="radio-card-header">
        <div class="card-driver-pill">
          <span class="card-color-dot" style="background:${radio.team_color}"></span>
          <span class="card-drv-acro">${radio.driver_acronym}</span>
          <span class="card-drv-num">#${radio.driver_number}</span>
        </div>
        <span class="card-cat-badge" style="color:${catMeta.color}; background:${catMeta.color}15; border:1px solid ${catMeta.color}44">
          ${catMeta.icon} ${catMeta.label}
        </span>
        <span class="card-time">${radio.timestamp || "--:--"}</span>
      </div>

      <div class="radio-card-body">
        <p class="card-transcript">${highlightTranscript(radio.transcript)}</p>
      </div>

      <div class="radio-card-footer">
        <span class="card-team-name">${radio.team_name}</span>
        <button class="card-play-btn" title="Écouter le message">
          ${isPlaying ? "⏸" : "▶"}
        </button>
      </div>
    `;

    // Clic sur toute la carte ou bouton play pour écouter
    card.addEventListener("click", () => {
      if (radio.id === _currentPlayingId && _audioElement && !_audioElement.paused) {
        _audioElement.pause();
      } else {
        playMessage(radio);
      }
    });

    feed.appendChild(card);
  }
}
