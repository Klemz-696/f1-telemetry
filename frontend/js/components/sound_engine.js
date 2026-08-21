/**
 * sound_engine.js — Moteur audio F1 Dashboard
 *
 * Génère tous les sons de l'interface via Web Audio API (aucun fichier externe).
 * Sons disponibles :
 *   - intro          : démarrage moteur F1 à l'ouverture de la page
 *   - click          : clic sur bouton UI standard
 *   - nav            : changement de vue (nav principale)
 *   - tab            : changement d'onglet mobile
 *   - settings_open  : ouverture du panel paramètres
 *   - settings_close : fermeture du panel paramètres
 *   - ws_connected   : connexion WebSocket établie (statut LIVE)
 *   - rc_message     : nouveau message Direction de Course
 *   - green_flag     : drapeau vert / reprise de course
 *   - yellow_flag    : Safety Car / VSC déployé
 *   - red_flag       : drapeau rouge / interruption
 *   - best_lap       : meilleur tour (secteur violet)
 *   - overtake       : dépassement en course
 *   - pit            : pit stop détecté
 *   - retire         : abandon d'un pilote
 *   - chequered      : drapeau à damier / fin de course
 *
 * Utilisation :
 *   import { playSound, setSoundEnabled, setSoundVolume } from "./sound_engine.js";
 *   playSound("click");
 *   setSoundEnabled(false);
 *   setSoundVolume(0.6);  // 0.0 → 1.0
 */

// ─── Contexte Audio ───────────────────────────────────────────────────────────

let _ctx = null;
let _enabled = true;
let _volume  = 0.5;   // volume maître 0→1

function _getCtx() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Reprendre si suspendu (politique autoplay navigateur)
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}

// ─── Utilitaires bas niveau ───────────────────────────────────────────────────

/** Crée un gain maître + destination pour un son ponctuel */
function _masterGain(vol = 1) {
  const ctx  = _getCtx();
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol * _volume, ctx.currentTime);
  gain.connect(ctx.destination);
  return { ctx, gain };
}

/** Oscillateur simple avec enveloppe ADSR minimale */
function _osc(ctx, gain, type, freq, start, duration, volPeak = 1, fadeDuration = null) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(volPeak, start + 0.01);
  const fadeStart = start + (fadeDuration ?? duration) - 0.05;
  env.gain.setValueAtTime(volPeak, Math.max(start + 0.01, fadeStart));
  env.gain.linearRampToValueAtTime(0, start + duration);
  osc.connect(env);
  env.connect(gain);
  osc.start(start);
  osc.stop(start + duration + 0.01);
  return osc;
}

/** Bruit blanc sur une durée */
function _noise(ctx, gain, start, duration, vol = 1, highpass = 0) {
  const sampleRate  = ctx.sampleRate;
  const bufferSize  = Math.ceil(sampleRate * duration);
  const buffer      = ctx.createBuffer(1, bufferSize, sampleRate);
  const data        = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const env = ctx.createGain();
  env.gain.setValueAtTime(vol, start);
  env.gain.linearRampToValueAtTime(0, start + duration);
  source.connect(env);
  if (highpass > 0) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = highpass;
    env.connect(hp);
    hp.connect(gain);
  } else {
    env.connect(gain);
  }
  source.start(start);
  source.stop(start + duration + 0.01);
  return source;
}

// ─── Définitions des sons ─────────────────────────────────────────────────────

const SOUNDS = {

  /** Clic UI standard : boutons, toggles */
  click() {
    const { ctx, gain } = _masterGain(0.25);
    const t = ctx.currentTime;
    _osc(ctx, gain, "sine", 1200, t, 0.07, 0.8);
    _osc(ctx, gain, "sine", 900,  t + 0.03, 0.06, 0.4);
  },

  /** Navigation principale : changement de vue */
  nav() {
    const { ctx, gain } = _masterGain(0.2);
    const t = ctx.currentTime;
    _osc(ctx, gain, "sine", 660,  t, 0.08, 0.7);
    _osc(ctx, gain, "sine", 880,  t + 0.07, 0.08, 0.5);
  },

  /** Onglet mobile : swipe/tab */
  tab() {
    const { ctx, gain } = _masterGain(0.18);
    const t = ctx.currentTime;
    _osc(ctx, gain, "triangle", 750, t, 0.07, 0.6);
  },

  /** Ouverture du panel paramètres */
  settings_open() {
    const { ctx, gain } = _masterGain(0.2);
    const t = ctx.currentTime;
    _osc(ctx, gain, "sine", 520, t,      0.09, 0.7);
    _osc(ctx, gain, "sine", 660, t + 0.08, 0.09, 0.5);
    _osc(ctx, gain, "sine", 780, t + 0.15, 0.09, 0.3);
  },

  /** Fermeture du panel paramètres */
  settings_close() {
    const { ctx, gain } = _masterGain(0.18);
    const t = ctx.currentTime;
    _osc(ctx, gain, "sine", 780, t,      0.08, 0.6);
    _osc(ctx, gain, "sine", 520, t + 0.08, 0.09, 0.3);
  },

  /** WebSocket connecté → statut LIVE */
  ws_connected() {
    const { ctx, gain } = _masterGain(0.28);
    const t = ctx.currentTime;
    // Arpège montant rapide "connexion établie"
    [440, 550, 660, 880].forEach((f, i) => {
      _osc(ctx, gain, "sine", f, t + i * 0.07, 0.15, 0.6 - i * 0.08);
    });
  },

  /** Nouveau message Direction de Course (remplace le beep existant) */
  rc_message() {
    const { ctx, gain } = _masterGain(0.3);
    const t = ctx.currentTime;
    _osc(ctx, gain, "square", 880, t,      0.08, 0.5);
    _osc(ctx, gain, "square", 880, t + 0.12, 0.08, 0.4);
  },

  /** Drapeau vert / reprise de course */
  green_flag() {
    const { ctx, gain } = _masterGain(0.3);
    const t = ctx.currentTime;
    // Arpège majeur montant joyeux
    [523, 659, 784, 1047].forEach((f, i) => {
      _osc(ctx, gain, "sine", f, t + i * 0.09, 0.2, 0.7 - i * 0.1);
    });
  },

  /** Safety Car / VSC */
  yellow_flag() {
    const { ctx, gain } = _masterGain(0.32);
    const t = ctx.currentTime;
    // Deux bips jaunes descendants, légèrement inquiets
    _osc(ctx, gain, "square", 740, t,      0.18, 0.6);
    _osc(ctx, gain, "square", 620, t + 0.22, 0.18, 0.5);
  },

  /** Drapeau rouge */
  red_flag() {
    const { ctx, gain } = _masterGain(0.4);
    const t = ctx.currentTime;
    // Trois bips descendants graves → tension
    _osc(ctx, gain, "sawtooth", 400, t,      0.25, 0.7);
    _osc(ctx, gain, "sawtooth", 350, t + 0.28, 0.25, 0.6);
    _osc(ctx, gain, "sawtooth", 300, t + 0.56, 0.3,  0.5);
    // Grondement basse
    _noise(ctx, gain, t, 0.9, 0.3, 0);
  },

  /** Meilleur tour / secteur violet */
  best_lap() {
    const { ctx, gain } = _masterGain(0.3);
    const t = ctx.currentTime;
    // Son "électrique" montant
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.3);
    env.gain.setValueAtTime(0.8, t);
    env.gain.linearRampToValueAtTime(0, t + 0.4);
    osc.connect(env);
    env.connect(gain);
    osc.start(t);
    osc.stop(t + 0.45);
    // Shimmer harmonique
    _osc(ctx, gain, "sine", 1800, t + 0.25, 0.2, 0.5);
  },

  /** Dépassement en course */
  overtake() {
    const { ctx, gain } = _masterGain(0.25);
    const t = ctx.currentTime;
    // Swoosh rapide
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(800, t + 0.12);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.25);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.7, t + 0.04);
    env.gain.linearRampToValueAtTime(0, t + 0.28);
    osc.connect(env);
    env.connect(gain);
    osc.start(t);
    osc.stop(t + 0.3);
  },

  /** Pit stop */
  pit() {
    const { ctx, gain } = _masterGain(0.22);
    const t = ctx.currentTime;
    // "Clunk" mécanique
    _noise(ctx, gain, t, 0.05, 1.2, 800);
    _osc(ctx, gain, "triangle", 220, t + 0.05, 0.15, 0.5);
  },

  /** Abandon d'un pilote */
  retire() {
    const { ctx, gain } = _masterGain(0.25);
    const t = ctx.currentTime;
    // Son descendant triste
    _osc(ctx, gain, "sine", 660, t,      0.3, 0.6);
    _osc(ctx, gain, "sine", 440, t + 0.3, 0.4, 0.4);
    _osc(ctx, gain, "sine", 330, t + 0.65, 0.5, 0.3);
  },

  /** Drapeau à damier — fin de course */
  chequered() {
    const { ctx, gain } = _masterGain(0.35);
    const t = ctx.currentTime;
    // Fanfare victoire : accord + arpège rapide
    const fanfare = [523, 659, 784, 1047, 1319];
    fanfare.forEach((f, i) => {
      _osc(ctx, gain, "sine", f, t + i * 0.06, 0.5 - i * 0.05, 0.7 - i * 0.1);
    });
    // Accord final plein
    [523, 659, 784].forEach(f => {
      _osc(ctx, gain, "triangle", f, t + 0.38, 0.8, 0.4);
    });
  },

};

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Joue un son par nom.
 * @param {keyof SOUNDS} name  Nom du son
 */
export function playSound(name) {
  if (!_enabled) return;
  const fn = SOUNDS[name];
  if (!fn) { console.warn(`[sound_engine] Son inconnu : "${name}"`); return; }
  try {
    fn();
  } catch (e) {
    console.warn(`[sound_engine] Erreur lecture son "${name}":`, e);
  }
}

/**
 * Active ou désactive tous les sons de l'interface.
 * @param {boolean} enabled
 */
export function setSoundEnabled(enabled) {
  _enabled = !!enabled;
}

/**
 * Volume maître (0.0 → 1.0).
 * @param {number} vol
 */
export function setSoundVolume(vol) {
  _volume = Math.max(0, Math.min(1, vol));
}

/** Retourne l'état actuel du module */
export function getSoundState() {
  return { enabled: _enabled, volume: _volume };
}
