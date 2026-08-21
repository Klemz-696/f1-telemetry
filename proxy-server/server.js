#!/usr/bin/env node

// proxy-server/server.js
// v4.0 — CORRECTION MAJEURE :
//  - getTrueLatestSession() exclut les sessions avec is_cancelled=true OU sans données
//  - Nouveau endpoint /api/session-state : décide live/archive côté serveur
//  - Nouveau endpoint /api/next-session  : retourne la prochaine séance à venir
//  - backgroundWarmup() retente si le session_key retourné n'a pas de données
//  - Le navigateur ne décide plus jamais du mode live/archive

'use strict';
const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { URL } = require('url');

// ─── Configuration ────────────────────────────────────────────────────────────
const OPENF1   = 'https://api.openf1.org/v1';
const JOLPICA  = 'https://api.jolpi.ca/ergast/f1';
const PORT     = parseInt(process.env.PROXY_PORT || '3001', 10);
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');

const TTL_MAP = {
  meetings:      21_600,
  sessions:       3_600,
  drivers:       86_400,
  position:       3_600,
  laps:           3_600,
  stints:         3_600,
  weather:        3_600,
  race_control:   3_600,
  intervals:          5,
  car_data:           5,
};
const DEFAULT_TTL   = 300;
const STALE_WINDOW  = 7 * 86_400;
const REQ_INTERVAL  = 1_100;
// D3 : grâce maximale au-delà de staleUntil pour le fallback de dernier recours.
// Au-delà de staleUntil + MAX_EXPIRED_GRACE, on refuse de servir le cache périmé.
const MAX_EXPIRED_GRACE = 24 * 3600 * 1000; // 24h

const TIMEOUT_MAP = {
  position:  120_000,
  laps:      120_000,
  car_data:   30_000,
  default:    60_000,
};

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
const memCache = new Map();

// ─── Cache mémoire + disque ───────────────────────────────────────────────────

function cacheKey(prefix, endpoint, params) {
  const qs  = new URLSearchParams(params).toString();
  return crypto.createHash('sha1').update(`${prefix}__${endpoint}__${qs}`).digest('hex');
}
function diskPath(key) { return path.join(CACHE_DIR, `${key}.json`); }

function readCache(key) {
  let entry = memCache.get(key);
  if (!entry) {
    try {
      if (fs.existsSync(diskPath(key))) {
        entry = JSON.parse(fs.readFileSync(diskPath(key), 'utf8'));
        memCache.set(key, entry);
      }
    } catch {}
  }
  if (!entry) return null;
  const now = Date.now();
  if (entry.expiresAt > now) return { data: entry.data, fresh: true };
  if (entry.staleUntil > now) return { data: entry.data, fresh: false };
  return null;
}

// Lit le cache même périmé (au-delà de staleUntil) — fallback de dernier recours.
// D3 : on refuse de servir une entrée périmée depuis trop longtemps (borne MAX_EXPIRED_GRACE).
function readExpiredCache(key) {
  let entry = memCache.get(key);
  if (!entry) {
    try {
      if (fs.existsSync(diskPath(key))) {
        entry = JSON.parse(fs.readFileSync(diskPath(key), 'utf8'));
        memCache.set(key, entry);
      }
    } catch {}
  }
  if (!entry) return null;
  // Refus si l'entrée est périmée au-delà de la grâce maximale.
  if (Date.now() - entry.staleUntil > MAX_EXPIRED_GRACE) return null;
  return entry.data ?? null;
}


function writeCache(key, data, ttlSecs) {
  // D1 : ne jamais persister undefined (pollution du cache après 429 épuisé).
  if (data === undefined || data === null) return;
  const entry = {
    data,
    expiresAt:  Date.now() + ttlSecs * 1_000,
    staleUntil: Date.now() + STALE_WINDOW * 1_000,
  };
  memCache.set(key, entry);
  try { fs.writeFileSync(diskPath(key), JSON.stringify(entry)); } catch {}
}

// ─── File d'attente (Rate-limiter) ────────────────────────────────────────────

const reqQueue = [];
let qRunning   = false;

async function upstreamFetch(url, timeoutMs = TIMEOUT_MAP.default, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'F1Dashboard-Backend/4.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429) {
        // D1 : à la dernière tentative, on LÈVE au lieu de revenir sans valeur
        // (sinon upstreamFetch retourne undefined → writeCache(undefined) pollue le cache).
        if (i === retries) throw new Error('HTTP 429 — rate limit épuisé');
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 3_000));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 1_000));
    }
  }
}

async function drainQueue() {
  if (qRunning) return;
  qRunning = true;
  while (reqQueue.length > 0) {
    const item = reqQueue.shift();
    try {
      const data = await upstreamFetch(item.url, item.timeoutMs);
      writeCache(item.key, data, item.ttl);
      item.resolve(data);
    } catch (e) { item.reject(e); }
    if (reqQueue.length > 0) await new Promise(r => setTimeout(r, REQ_INTERVAL));
  }
  qRunning = false;
}

function enqueue(url, key, ttl, endpoint) {
  const timeoutMs = TIMEOUT_MAP[endpoint] || TIMEOUT_MAP.default;
  const dup = reqQueue.find(q => q.key === key);
  if (dup) {
    return new Promise((resolve, reject) => {
      const pr = dup.resolve, pj = dup.reject;
      dup.resolve = d => { pr(d); resolve(d); };
      dup.reject  = e => { pj(e); reject(e); };
    });
  }
  return new Promise((resolve, reject) => {
    reqQueue.push({ url, key, ttl, endpoint, timeoutMs, resolve, reject });
    drainQueue();
  });
}

// ─── Helper partagé : dernières positions GPS par pilote ─────────────────────
// D4 : partagé entre /api/last-positions et /api/live-data → un seul fetch
//      upstream (clé 'position') et une seule déduplication (clé 'last_positions').
//      C4 : session_key encodé pour éviter l'injection de query.
async function fetchLastPositions(sessionKey, ttlSecs) {
  const dedupKey = cacheKey(OPENF1, 'last_positions', { session_key: sessionKey });
  const hit = readCache(dedupKey);
  if (hit?.fresh) return hit.data;

  const allPositions = await enqueue(
    `${OPENF1}/position?session_key=${encodeURIComponent(sessionKey)}`,
    cacheKey(OPENF1, 'position', { session_key: sessionKey }),
    ttlSecs, 'position'
  );

  const latest = {};
  for (const p of allPositions) {
    if (!p.driver_number || (p.x === 0 && p.y === 0)) continue;
    const dn = String(p.driver_number);
    if (!latest[dn] || new Date(p.date) > new Date(latest[dn].date)) latest[dn] = p;
  }
  const result = Object.values(latest);
  writeCache(dedupKey, result, ttlSecs);
  return result;
}

// ─── MOTEUR DE SESSIONS : Logique centralisée côté serveur ───────────────────
//
// RÈGLE ABSOLUE : une session est éligible comme "dernière session archivée" si :
//   1. date_start <= maintenant  (elle a déjà commencé)
//   2. is_cancelled !== true     (elle n'est pas annulée)
//   3. Elle est de type "Race"   (on veut la dernière course, pas une practice)
//
// En plus, pour éviter le bug "session fantôme", on vérifie qu'OpenF1 a bien
// des données pour cette session (au moins des pilotes). Si non, on remonte
// dans la liste jusqu'à trouver une session avec des données réelles.

let _sessionStateCache = null;
let _sessionStateFetchedAt = 0;
const SESSION_STATE_TTL = 60_000; // 1 minute

async function computeSessionState() {
  const now = Date.now();
  if (_sessionStateCache && (now - _sessionStateFetchedAt) < SESSION_STATE_TTL) {
    return _sessionStateCache;
  }

  const year = new Date().getFullYear();
  const key  = cacheKey(OPENF1, 'sessions', { year });
  let sessionsData;

  const cached = readCache(key);
  if (cached?.fresh) {
    sessionsData = cached.data;
  } else {
    try {
      const resp = await fetch(`${OPENF1}/sessions?year=${year}`, {
        headers: { 'User-Agent': 'F1Dashboard-Backend/4.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(60_000),
      });
      if (resp.status === 401 || resp.status === 403 || resp.status === 429 || !resp.ok) {
        // OpenF1 bloqué → fallback F1 Live Timing officielle
        console.warn(`[proxy] OpenF1 sessions bloqué (HTTP ${resp.status}) — fallback livetiming.formula1.com`);
        const f1State = await _fetchF1LiveTimingState();
        if (f1State) {
          _sessionStateCache    = f1State;
          _sessionStateFetchedAt = Date.now();
          return f1State;
        }
        // Utiliser le cache périmé si disponible
        const staleData = readExpiredCache(key);
        if (staleData) {
          console.warn('[proxy] Utilisation du cache périmé pour sessions (OpenF1 indisponible)');
          sessionsData = staleData;
        } else {
          return _sessionStateCache || { mode: 'archive', archiveSession: null, nextSession: null };
        }
      } else {
        sessionsData = await resp.json();
        writeCache(key, sessionsData, 3600);
      }
    } catch (e) {
      console.error('[proxy] Erreur récupération sessions:', e.message);
      // Fallback : cache périmé
      const staleData = readExpiredCache(key);
      if (staleData) {
        console.warn('[proxy] Utilisation du cache périmé pour sessions (erreur réseau)');
        sessionsData = staleData;
      } else {
        return _sessionStateCache || { mode: 'archive', archiveSession: null, nextSession: null };
      }
    }
  }

  const nowIso = new Date().toISOString();

  // ── 1. Déterminer si une session est EN COURS (mode LIVE) ────────────────
  // Une session est live si : started && !ended && !cancelled
  const liveSession = sessionsData.find(s => {
    if (s.is_cancelled) return false;
    const start = new Date(s.date_start).getTime();
    const end   = s.date_end
      ? new Date(s.date_end).getTime()
      : start + 3 * 3600 * 1000;
    const nowMs = Date.now();
    // Fenêtre live : 5 min avant le départ jusqu'à 30 min après la fin prévue
    return nowMs >= start - 5 * 60 * 1000 && nowMs <= end + 30 * 60 * 1000;
  });

  // ── 2. Trouver la dernière session ARCHIVÉE (passée, non annulée, avec données) ──
  // On cherche la dernière Race d'abord, puis n'importe quel type si nécessaire
  const pastNonCancelledRaces = sessionsData
    .filter(s => {
      if (s.is_cancelled) return false;
      if (s.session_type !== 'Race') return false;
      return s.date_start <= nowIso;
    })
    .sort((a, b) => new Date(b.date_start) - new Date(a.date_start));

  let archiveSession = null;
for (const candidate of pastNonCancelledRaces) {
  const driverKey = cacheKey(OPENF1, 'drivers', { session_key: candidate.session_key });
  const driverCached = readCache(driverKey);
  
  if (driverCached?.data?.length > 0) {
    // Cache confirmé : cette session a des données
    archiveSession = candidate;
    break;
  }
  
  // Pas en cache : on vérifie activement via le réseau (pour les 2 premiers candidats seulement)
  if (pastNonCancelledRaces.indexOf(candidate) < 3) {
    try {
      const drivers = await upstreamFetch(`${OPENF1}/drivers?session_key=${candidate.session_key}`, 15_000, 1);
      if (drivers?.length > 0) {
        writeCache(driverKey, drivers, 86400);
        archiveSession = candidate;
        break;
      }
      // Pas de données → cette session est fantôme, on continue
      console.warn(`[proxy] Session ${candidate.session_key} (${candidate.location}) sans données — ignorée`);
    } catch {
      console.warn(`[proxy] Impossible de vérifier session ${candidate.session_key} — ignorée`);
    }
  }
}


  // ── 3. Trouver la prochaine session à venir (non annulée) ────────────────
  const nextSession = sessionsData
    .filter(s => !s.is_cancelled && s.date_start > nowIso)
    .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))[0] || null;

  // ── 4. Calculer le basculement archive → pre-live ────────────────────────
  // On passe en mode "pre-live" 15 minutes avant la prochaine séance
  let mode = 'archive';
  let activeSession = archiveSession;

  if (liveSession) {
    mode          = 'live';
    activeSession = liveSession;
    console.log(`[proxy] Mode LIVE détecté : ${liveSession.session_name} @ ${liveSession.location} (#${liveSession.session_key})`);
  } else if (nextSession) {
    const nextStart = new Date(nextSession.date_start).getTime();
    const msToNext  = nextStart - Date.now();
    if (msToNext <= 60 * 60 * 1000 && msToNext > 0) {
      // Dans l'heure avant le début : mode PREPARING
      mode = 'preparing';
      console.log(`[proxy] Mode PREPARING : ${nextSession.session_name} @ ${nextSession.location} dans ${Math.round(msToNext / 60000)}min`);
    }
  }

  const state = { mode, activeSession, archiveSession, liveSession, nextSession };
  _sessionStateCache    = state;
  _sessionStateFetchedAt = Date.now();

  console.log(`[proxy] État session : mode=${mode}, archive=${archiveSession?.session_key} (${archiveSession?.location}), next=${nextSession?.session_key} (${nextSession?.location})`);
  return state;
}

// ─── Fallback : F1 Live Timing officielle ─────────────────────────────────────
// Consulte StreamingStatus.json et SessionInfo.json quand OpenF1 est bloqué.
// Retourne un objet { mode, activeSession, archiveSession, liveSession, nextSession }
// si une session live est détectée, sinon null.

async function _fetchF1LiveTimingState() {
  try {
    const [statusRes, infoRes] = await Promise.allSettled([
      fetch('https://livetiming.formula1.com/static/StreamingStatus.json', {
        headers: { 'User-Agent': 'F1Dashboard-Backend/4.0' },
        signal: AbortSignal.timeout(10_000),
      }),
      fetch('https://livetiming.formula1.com/static/SessionInfo.json', {
        headers: { 'User-Agent': 'F1Dashboard-Backend/4.0' },
        signal: AbortSignal.timeout(10_000),
      }),
    ]);

    if (statusRes.status !== 'fulfilled' || !statusRes.value.ok) return null;
    const streamStatus = await statusRes.value.json();
    if (streamStatus?.Status !== 'Available' && streamStatus?.Status !== 'Online') return null;

    if (infoRes.status !== 'fulfilled' || !infoRes.value.ok) return null;
    const sessionInfo = await infoRes.value.json();
    if (!sessionInfo?.Key) return null;

    let offset = '';
    if (sessionInfo.GmtOffset) {
      let off = sessionInfo.GmtOffset;
      if (!off.startsWith('-') && !off.startsWith('+')) {
        off = '+' + off;
      }
      const parts = off.split(':');
      if (parts.length >= 2) {
        offset = `${parts[0]}:${parts[1]}`;
      }
    }

    // Construire un objet session compatible avec notre format OpenF1
    const liveSession = {
      session_key:        sessionInfo.Key,
      session_name:       sessionInfo.Name || 'Session',
      session_type:       sessionInfo.Type || 'Race',
      location:           sessionInfo.Meeting?.Circuit?.ShortName || sessionInfo.Meeting?.Country?.Name || 'Unknown',
      circuit_short_name: sessionInfo.Meeting?.Circuit?.ShortName || 'Unknown',
      country_code:       sessionInfo.Meeting?.Country?.Code || '',
      meeting_key:        sessionInfo.Meeting?.Key || null,
      date_start:         sessionInfo.StartDate ? (sessionInfo.StartDate + offset) : new Date().toISOString(),
      date_end:           sessionInfo.EndDate ? (sessionInfo.EndDate + offset) : null,
      is_cancelled:       false,
    };

    const startMs = new Date(liveSession.date_start).getTime();
    const endMs = liveSession.date_end ? new Date(liveSession.date_end).getTime() : startMs + 3 * 3600 * 1000;
    const nowMs = Date.now();
    const isActuallyLive = nowMs >= startMs - 5 * 60 * 1000 && nowMs <= endMs + 30 * 60 * 1000;

    if (isActuallyLive) {
      console.log(`[proxy] F1 Live Timing : session LIVE confirmée (horodatage OK) → ${liveSession.session_name} @ ${liveSession.location} (#${liveSession.session_key})`);
      return {
        mode: 'live',
        activeSession:  liveSession,
        archiveSession: null,
        liveSession,
        nextSession:    null,
      };
    } else {
      console.log(`[proxy] F1 Live Timing : flux ouvert mais session non active (horodatage expiré) → fallback ARCHIVE (#${liveSession.session_key})`);
      return {
        mode: 'archive',
        activeSession:  null,
        archiveSession: liveSession,
        liveSession:    null,
        nextSession:    null,
      };
    }
  } catch (e) {
    console.warn('[proxy] _fetchF1LiveTimingState erreur:', e.message);
    return null;
  }
}


// ─── HTTP Server ──────────────────────────────────────────────────────────────

// Origines autorisées — configurable via ALLOWED_ORIGINS env (séparées par ',')
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGINS || 'http://localhost,http://localhost:3001,http://f1-hub.local';
const ALLOWED_ORIGINS = new Set(ALLOWED_ORIGINS_RAW.split(',').map(s => s.trim()));

function corsOrigin(req) {
  const origin = req.headers.origin || req.headers.referer || '';
  if (process.env.NODE_ENV === 'production') {
    try {
      const host = new URL(origin).origin;
      return ALLOWED_ORIGINS.has(host) ? host : null;
    } catch { return null; }
  }
  return origin || '*';
}

function sendJSON(res, data, status = 200, headers = {}, req = null) {
  const body = JSON.stringify(data);
  const isProd = process.env.NODE_ENV === 'production';
  // C1 : l'origine autorisée est fixée à l'entrée du handler (res._allowedOrigin).
  // On n'émet ACAO QUE pour une origine autorisée. En prod, si l'origine est absente
  // ou non autorisée, on n'émet PAS le header (le navigateur bloque) plutôt que de
  // tomber sur '*' — ce qui contournait complètement la whitelist ALLOWED_ORIGINS.
  const origin = req ? corsOrigin(req) : (res._allowedOrigin ?? null);
  const outHeaders = {
    'Content-Type':           'application/json',
    'Content-Length':         Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control':          'no-store',
    ...headers,
  };
  if (origin) {
    outHeaders['Access-Control-Allow-Origin'] = origin;
  } else if (!isProd) {
    outHeaders['Access-Control-Allow-Origin'] = '*';
  }
  res.writeHead(status, outHeaders);
  res.end(body);
}

async function handleProxy(req, res, upstreamBase, prefixParts) {
  const urlObj   = new URL(req.url, `http://localhost:${PORT}`);
  const parts    = urlObj.pathname.split('/').filter(Boolean);
  const endpoint = parts.slice(prefixParts).join('/');
  const params   = Object.fromEntries(urlObj.searchParams);

  // ── Interception critique : résolution dynamique de session_key=latest ───
  // TOUJOURS passer par computeSessionState() pour éviter les sessions annulées
  if (endpoint === 'sessions' && params.session_key === 'latest') {
    try {
      const state = await computeSessionState();
      const session = state.activeSession;
      if (!session) return sendJSON(res, [], 200, { 'X-Cache': 'BACKEND-OVERRIDE-EMPTY' });
      return sendJSON(res, [session], 200, {
        'X-Cache': 'BACKEND-OVERRIDE',
        'X-Session-Mode': state.mode,
      });
    } catch (e) {
      return sendJSON(res, { error: 'Impossible de déterminer la session' }, 500);
    }
  }

  const key      = cacheKey(upstreamBase, endpoint, params);
  const ttl      = TTL_MAP[endpoint] ?? DEFAULT_TTL;
  const qs       = urlObj.searchParams.toString();
  const upstream = `${upstreamBase}/${endpoint}${qs ? '?' + qs : ''}`;

  const cached = readCache(key);
  if (cached?.fresh)  return sendJSON(res, cached.data, 200, { 'X-Cache': 'HIT', 'Cache-Control': `max-age=${ttl}` });
  if (cached?.data) {
    enqueue(upstream, key, ttl, endpoint).catch(() => {});
    return sendJSON(res, cached.data, 200, { 'X-Cache': 'STALE' });
  }

  try {
    const data = await enqueue(upstream, key, ttl, endpoint);
    sendJSON(res, data, 200, { 'X-Cache': 'MISS' });
  } catch (e) {
    // Dernier recours : cache périmé même au-delà de staleUntil
    const expired = readExpiredCache(key);
    if (expired) {
      console.warn(`[proxy] Cache expiré servi pour ${endpoint} (erreur upstream: ${e.message})`);
      return sendJSON(res, expired, 200, { 'X-Cache': 'EXPIRED', 'X-Cache-Warning': 'stale-data' });
    }
    sendJSON(res, { error: e.message, endpoint }, 502);
  }
}


const server = http.createServer(async (req, res) => {
  // C1 : origine autorisée fixée une fois pour toutes les réponses de cette requête.
  res._allowedOrigin = corsOrigin(req);

  if (req.method === 'OPTIONS') {
    const isProd = process.env.NODE_ENV === 'production';
    const origin = res._allowedOrigin;
    const acHeaders = {
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age':       '86400',
    };
    if (origin) acHeaders['Access-Control-Allow-Origin'] = origin;
    else if (!isProd) acHeaders['Access-Control-Allow-Origin'] = '*';
    res.writeHead(204, acHeaders);
    return res.end();
  }

  // Bloquer les méthodes non-GET (sauf OPTIONS)
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain', 'Allow': 'GET, OPTIONS' });
    return res.end('Method Not Allowed');
  }

  const urlObj   = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  // Protection path traversal
  if (pathname.includes('..') || pathname.includes('%2e%2e') || pathname.includes('%252e')) {
    res.writeHead(400); return res.end('Bad Request');
  }

  // ── Endpoint dédié : état de session (live vs archive) ──────────────────
  // Le navigateur interroge cet endpoint toutes les 60s pour savoir quel mode activer.
  // C'est la VM qui décide, pas le navigateur.
  if (pathname === '/api/session-state') {
    try {
      const state = await computeSessionState();

      // Enrichissement : country_code depuis meeting si absent
      function enrichSession(sess) {
        if (!sess) return sess;
        if (!sess.country_code && sess.meeting_country_code) {
          return { ...sess, country_code: sess.meeting_country_code };
        }
        return sess;
      }

      return sendJSON(res, {
        mode:           state.mode,
        activeSession:  enrichSession(state.activeSession),
        archiveSession: enrichSession(state.archiveSession),
        liveSession:    enrichSession(state.liveSession),
        nextSession:    enrichSession(state.nextSession),
        serverTime:     new Date().toISOString(),
      }, 200, { 'Cache-Control': 'no-cache' });
    } catch (e) {
      return sendJSON(res, { error: e.message }, 500);
    }
  }

  // ── Endpoint flush cache (C2 : protégé par token + vide aussi le disque) ───
  if (pathname === '/flush') {
    const flushTok = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('token');
    const expectedTok = process.env.FLUSH_TOKEN;
    if (expectedTok && flushTok !== expectedTok) {
      return sendJSON(res, { error: 'non autorisé' }, 403);
    }
    memCache.clear();
    // Vider aussi les fichiers disque (pas seulement le memCache — sémantique honnête)
    try {
      for (const f of fs.readdirSync(CACHE_DIR)) {
        if (f.endsWith('.json')) fs.unlinkSync(path.join(CACHE_DIR, f));
      }
    } catch {}
    _sessionStateCache = null;
    _sessionStateFetchedAt = 0;
    return sendJSON(res, { ok: true, message: 'Cache mémoire + disque vidé' });
  }

  if (pathname === '/status') {
    // C5 : endpoint de healthcheck (Docker) — on ne fuite plus queueLength/cacheEntries.
    const state = _sessionStateCache;
    return sendJSON(res, {
      ok: true,
      mode: state?.mode || 'unknown',
    });
  }

  // ── Endpoint tracé circuit : points GPS ordonnés d'UN seul pilote ───────────
  // Récupère /location?session_key=X&driver_number=Y (pilote leader ou driver_number=1),
  // déduplique sur grille 15m, trie angulairement depuis le centroïde pour reconstituer
  // un tracé continu. Retourne { points:[{x,y}...], count } en coordonnées métriques OpenF1.
  if (pathname === '/api/track-layout') {
    const urlObj3    = new URL(req.url, `http://localhost:${PORT}`);
    const sessionKey = urlObj3.searchParams.get('session_key');
    const driverNum  = urlObj3.searchParams.get('driver_number') || '1';
    if (!sessionKey) return sendJSON(res, { error: 'session_key requis' }, 400);

    const cKey = cacheKey(OPENF1, 'track_layout', { session_key: sessionKey, driver_number: driverNum });
    const hit  = readCache(cKey);
    if (hit?.fresh) return sendJSON(res, hit.data, 200, { 'X-Cache': 'HIT' });

    try {
      // /location retourne toutes les positions d'un pilote sur la session (millions de points)
      const allLoc = await enqueue(
        `${OPENF1}/location?session_key=${encodeURIComponent(sessionKey)}&driver_number=${encodeURIComponent(driverNum)}`,
        cacheKey(OPENF1, 'location', { session_key: sessionKey, driver_number: driverNum }),
        86_400, // cache 24h — le tracé d'un circuit ne change pas
        'location'
      );

      if (!allLoc || allLoc.length < 10) {
        return sendJSON(res, { points: [], count: 0, error: 'données insuffisantes' }, 200);
      }

      // Dédupliquer sur une grille de 15 mètres
      const gridSet = new Set();
      const raw = [];
      for (const p of allLoc) {
        if (!p.x || !p.y || (p.x === 0 && p.y === 0)) continue;
        const gk = `${Math.round(p.x / 15)},${Math.round(p.y / 15)}`;
        if (!gridSet.has(gk)) { gridSet.add(gk); raw.push({ x: p.x, y: p.y }); }
      }

      if (raw.length < 10) {
        return sendJSON(res, { points: raw, count: raw.length }, 200);
      }

      // Trier angulairement depuis le centroïde → tracé continu
      const cx = raw.reduce((s, p) => s + p.x, 0) / raw.length;
      const cy = raw.reduce((s, p) => s + p.y, 0) / raw.length;
      raw.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

      const result = { points: raw, count: raw.length };
      writeCache(cKey, result, 86_400);
      return sendJSON(res, result, 200, { 'X-Cache': 'MISS' });
    } catch (e) {
      return sendJSON(res, { error: e.message }, 502);
    }
  }

  // ── Endpoint optimisé : DERNIÈRE position GPS par pilote ────────────────────
  // Évite de renvoyer des millions de points au navigateur.
  // Récupère /position?session_key=X, déduplique par pilote (dernière position valide),
  // et retourne uniquement les 20 (max) entrées finales.
  if (pathname === '/api/last-positions') {
    const sessionKey = urlObj.searchParams.get('session_key');
    if (!sessionKey) return sendJSON(res, { error: 'session_key requis' }, 400);

    const dedupKey = cacheKey(OPENF1, 'last_positions', { session_key: sessionKey });
    const hit = readCache(dedupKey);
    if (hit?.fresh) return sendJSON(res, hit.data, 200, { 'X-Cache': 'HIT' });
    try {
      const result = await fetchLastPositions(sessionKey, TTL_MAP.position);
      return sendJSON(res, result, 200, { 'X-Cache': 'MISS' });
    } catch (e) {
      return sendJSON(res, { error: e.message }, 502);
    }
  }

  // ── Endpoint agrégé : TOUTES les données live d'une session ─────────────────
  // Récupère positions, intervals, laps, stints, race_control, weather en une
  // seule requête serveur. Le frontend poll cet endpoint toutes les 5s en live.
  // Chaque sous-endpoint utilise son propre cache avec un TTL court (5-10s).
  if (pathname === '/api/live-data') {
    const urlObjLive = new URL(req.url, `http://localhost:${PORT}`);
    const sessionKey = urlObjLive.searchParams.get('session_key');
    if (!sessionKey) return sendJSON(res, { error: 'session_key requis' }, 400);

    const LIVE_TTL = 5; // 5 secondes pour les données live

    try {
      // Lancer toutes les requêtes en parallèle (via la queue rate-limitée).
      // C4 : session_key encodé dans toutes les URLs upstream.
      // D4 : positions facteur communes via fetchLastPositions (cache partagé avec
      //      /api/last-positions — un seul fetch upstream, une seule déduplication).
      const skEnc = encodeURIComponent(sessionKey);
      const [posResult, intResult, lapsResult, stintsResult, rcResult, wxResult] =
        await Promise.allSettled([
          // Positions : endpoint optimisé (dernière position par pilote)
          fetchLastPositions(sessionKey, LIVE_TTL),
          // Intervals
          enqueue(
            `${OPENF1}/intervals?session_key=${skEnc}`,
            cacheKey(OPENF1, 'intervals_live', { session_key: sessionKey }),
            LIVE_TTL, 'intervals'
          ),
          // Laps
          enqueue(
            `${OPENF1}/laps?session_key=${skEnc}`,
            cacheKey(OPENF1, 'laps_live', { session_key: sessionKey }),
            10, 'laps'
          ),
          // Stints
          enqueue(
            `${OPENF1}/stints?session_key=${skEnc}`,
            cacheKey(OPENF1, 'stints_live', { session_key: sessionKey }),
            30, 'stints'
          ),
          // Race Control
          enqueue(
            `${OPENF1}/race_control?session_key=${skEnc}`,
            cacheKey(OPENF1, 'rc_live', { session_key: sessionKey }),
            LIVE_TTL, 'race_control'
          ),
          // Weather
          enqueue(
            `${OPENF1}/weather?session_key=${skEnc}`,
            cacheKey(OPENF1, 'wx_live', { session_key: sessionKey }),
            30, 'weather'
          ),
        ]);

      const positions    = posResult.status    === 'fulfilled' ? posResult.value    : [];
      const intervals    = intResult.status    === 'fulfilled' ? intResult.value    : [];
      const laps         = lapsResult.status   === 'fulfilled' ? lapsResult.value   : [];
      const stints       = stintsResult.status === 'fulfilled' ? stintsResult.value : [];
      const race_control = rcResult.status     === 'fulfilled' ? rcResult.value     : [];
      const weatherArr   = wxResult.status     === 'fulfilled' ? wxResult.value     : [];
      const weather      = Array.isArray(weatherArr) ? weatherArr[weatherArr.length - 1] || {} : weatherArr || {};

      return sendJSON(res, {
        positions, intervals, laps, stints, race_control, weather,
        session_key: sessionKey,
        timestamp: new Date().toISOString(),
      }, 200, { 'Cache-Control': `max-age=${LIVE_TTL}` });
    } catch (e) {
      // Fallback : retourner ce qu'on a en cache
      return sendJSON(res, { error: e.message, session_key: sessionKey }, 502);
    }
  }

  if (pathname.startsWith('/openf1/'))  return handleProxy(req, res, OPENF1,  1);
  if (pathname.startsWith('/jolpica/')) return handleProxy(req, res, JOLPICA, 1);

  res.writeHead(404); res.end('Not found');
});

// ─── WebSocket Push Server ────────────────────────────────────────────────────

const wsClients = new Set();

server.on('upgrade', (req, socket) => {
  const urlPath = new URL(req.url, `http://localhost:${PORT}`).pathname;
  if (urlPath !== '/ws') { socket.destroy(); return; }

  // C3 : vérifier l'origine du handshake WebSocket en production (sinon /ws est
  // ouvert à n'importe quel client, recevant les broadcasts session_mode_changed…).
  if (process.env.NODE_ENV === 'production') {
    const origin = req.headers.origin || '';
    let host = '';
    try { host = new URL(origin).origin; } catch {}
    if (!origin || !ALLOWED_ORIGINS.has(host)) { socket.destroy(); return; }
  }

  const wsKey = req.headers['sec-websocket-key'];
  if (!wsKey) { socket.destroy(); return; }

  const accept = crypto
    .createHash('sha1')
    .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  wsClients.add(socket);
  socket.on('close', () => { wsClients.delete(socket); });
  socket.on('error', () => { wsClients.delete(socket); socket.destroy(); });

  // Ping toutes les 30s pour maintenir le tunnel à travers Nginx
  const pingInterval = setInterval(() => {
    if (socket.destroyed) { clearInterval(pingInterval); return; }
    const frame = Buffer.alloc(2);
    frame[0] = 0x89;
    frame[1] = 0x00;
    try { socket.write(frame); } catch { clearInterval(pingInterval); }
  }, 30_000);
  socket.on('close', () => clearInterval(pingInterval));
});

function wsBroadcast(payload) {
  if (wsClients.size === 0) return;
  const msgBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const len    = msgBuf.length;

  let frame;
  if (len < 126) {
    frame = Buffer.alloc(2 + len);
    frame[0] = 0x81;
    frame[1] = len;
    msgBuf.copy(frame, 2);
  } else if (len < 65536) {
    frame = Buffer.alloc(4 + len);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
    msgBuf.copy(frame, 4);
  } else {
    frame = Buffer.alloc(10 + len);
    frame[0] = 0x81;
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
    msgBuf.copy(frame, 10);
  }

  for (const s of wsClients) {
    try { s.write(frame); } catch { wsClients.delete(s); }
  }
}

// ─── WARMUP : Préchargement automatique de la session courante ────────────────

let _warmupRunning = false;

async function backgroundWarmup() {
  if (_warmupRunning) return;
  _warmupRunning = true;
  console.log('[proxy] Démarrage Warmup...');

  try {
    // Invalider le cache d'état pour forcer un recalcul propre
    _sessionStateCache = null;
    _sessionStateFetchedAt = 0;

    const state = await computeSessionState();
    const session = state.activeSession;

    if (!session) {
      console.warn('[proxy] Warmup : aucune session éligible trouvée.');
      _warmupRunning = false;
      return;
    }

    const sessionKey = session.session_key;
    console.log(`[proxy] Warmup session : ${sessionKey} (${session.session_name} — ${session.location}) [mode: ${state.mode}]`);

    // Préchargement des endpoints lourds
    const heavyEndpoints = ['drivers', 'stints', 'weather', 'race_control', 'laps', 'position'];
    for (const ep of heavyEndpoints) {
      const url = `${OPENF1}/${ep}?session_key=${sessionKey}`;
      const key = cacheKey(OPENF1, ep, { session_key: sessionKey });
      if (!readCache(key)?.fresh) {
        enqueue(url, key, TTL_MAP[ep] || 3600, ep).catch(e => {
          console.warn(`[proxy] Warmup ${ep} échec :`, e.message);
        });
      } else {
        console.log(`[proxy] Warmup ${ep} : déjà en cache (SKIP)`);
      }
    }

    // Classements Jolpica
    const year = new Date().getFullYear();
    const jolpicaEndpoints = [
      { path: `${year}/driverStandings/?format=json`,      ep: 'driverStandings'      },
      { path: `${year}/constructorStandings/?format=json`, ep: 'constructorStandings' },
    ];
    for (const { path: p, ep } of jolpicaEndpoints) {
      const url    = `${JOLPICA}/${p}`;
      const jolKey = cacheKey(JOLPICA, p, {});
      if (!readCache(jolKey)?.fresh) {
        enqueue(url, jolKey, 3600, ep).catch(e => {
          console.warn(`[proxy] Warmup jolpica/${ep} échec :`, e.message);
        });
      }
    }

    // Attendre la fin de la queue puis notifier les clients
    const checkDone = setInterval(() => {
      if (!qRunning && reqQueue.length === 0) {
        clearInterval(checkDone);
        _warmupRunning = false;
        console.log(`[proxy] Warmup terminé. Cache chaud pour session ${sessionKey}.`);
        wsBroadcast({
          event:      'preload_complete',
          sessionKey,
          mode:       state.mode,
          location:   session.location,
          sessionName: session.session_name,
        });
      }
    }, 2_000);

  } catch (e) {
    console.error('[proxy] Erreur Warmup:', e.message);
    _warmupRunning = false;
  }
}

// ─── Surveillance automatique : basculement live/archive ─────────────────────
// Toutes les 60s, on recalcule l'état. Si le mode change, on broadcast aux clients.

let _lastBroadcastMode = null;

setInterval(async () => {
  try {
    const state = await computeSessionState();
    if (state.mode !== _lastBroadcastMode) {
      _lastBroadcastMode = state.mode;
      wsBroadcast({
        event:      'session_mode_changed',
        mode:       state.mode,
        sessionKey: state.activeSession?.session_key,
        location:   state.activeSession?.location,
        sessionName: state.activeSession?.session_name,
      });
      console.log(`[proxy] Mode changé → ${state.mode} (session ${state.activeSession?.session_key})`);
      // Déclencher un warmup pour préchauffer la nouvelle session
      if (state.mode === 'live') backgroundWarmup();
    }
  } catch {}
}, 60_000);

// ─── D2 : Garbage collection du cache disque ─────────────────────────────────
// Rien ne supprimait jamais les .json → croissance non bornée. On balaye
// périodiquement CACHE_DIR et on unlink les fichiers dont staleUntil est dépassé
// de plus que MAX_EXPIRED_GRACE (cohérent avec readExpiredCache).
function cacheGC() {
  let removed = 0;
  try {
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(CACHE_DIR, f);
      try {
        const entry = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (entry && typeof entry.staleUntil === 'number' &&
            Date.now() - entry.staleUntil > MAX_EXPIRED_GRACE) {
          fs.unlinkSync(p);
          removed++;
          // Invalider aussi l'entrée mémoire correspondante (clé = nom sans .json)
          memCache.delete(f.replace(/\.json$/, ''));
        }
      } catch { /* fichier illisible / corrompu → on le supprime aussi */ try { fs.unlinkSync(p); removed++; } catch {} }
    }
  } catch {}
  if (removed > 0) console.log(`[proxy] Cache GC : ${removed} entrée(s) supprimée(s)`);
}

// ─── Démarrage ────────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] Proxy intelligent v4.0 démarré sur le port ${PORT}`);
  setTimeout(backgroundWarmup, 3_000);              // 3s après boot
  setInterval(backgroundWarmup, 15 * 60 * 1_000);  // toutes les 15 min
  setInterval(cacheGC, 60 * 60 * 1_000);           // GC disque toutes les heures
});