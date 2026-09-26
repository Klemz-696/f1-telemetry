/**
 * tracker_map.js  v6
 *
 * CORRECTIONS v6 :
 *  - GeoJSON : centroïde fallback quand aucune position pilote disponible
 *    → on utilise le centre géographique du GeoJSON directement en coordonnées métriques
 *  - Modes : la carte fonctionne en simulation, archive ET live
 *    → chaque mode a un code path clair et indépendant
 *  - Mode "imported" : force le recalcul des bounds depuis le GeoJSON importé
 *    même si le store est restauré depuis localStorage (importedTrackGeoJSON)
 *  - Suppression du weather-strip (déjà retiré de l'HTML)
 */

import { onUpdate, store, updateStore } from "../store.js";
import { computePitExitPosition } from "./pit_strategy.js";

const canvas = document.getElementById("track-canvas");
const ctx    = canvas ? canvas.getContext("2d") : null;

function detectProxy() {
  const h = window.location.hostname;
  const p = window.location.port;
  if (p === "8080" || p === "80" || p === "443" || p === "" || (h !== "localhost" && h !== "127.0.0.1")) {
    return `${window.location.origin}/proxy`;
  }
  return "http://localhost:3001";
}
const PROXY = detectProxy();

// ─── État interne ─────────────────────────────────────────────────────────────

let mapBounds    = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
let boundsReady  = false;
let trackPath    = null;
let currentStandings = [];
let isArchiveMode    = false;
let isSimMode        = false;
let hasGpsData       = false;

let _activeTrackPoints   = [];
let _apiTrackPoints      = [];
let _importedTrackPoints = [];

const _trackPoints = [];
const _trackSet    = new Set();

let _loadingTrack      = false;
let _lastLoadedSession = null;

const _prevPositions = new Map();
const _animBounce    = new Map();
const _ghostTrails   = new Map();
const _particles     = [];
let   _flashAnim     = null;
let   _currentSessionKey = null;
let   _scrubPoint    = null;

export function resetTrackData() {
  _apiTrackPoints      = [];
  _importedTrackPoints = [];
  _trackPoints.length  = 0;
  _trackSet.clear();
  _activeTrackPoints   = [];
  trackPath            = null;
  boundsReady          = false;
  hasGpsData           = false;
  _loadingTrack        = false;
  _lastLoadedSession   = null;
  mapBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
}

// ─── Normalisation ────────────────────────────────────────────────────────────

function normalise(x, y, cw, ch, padding) {
  padding = padding === undefined ? 36 : padding;
  const { minX, maxX, minY, maxY } = mapBounds;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale  = Math.min((cw - padding * 2) / rangeX, (ch - padding * 2) / rangeY);
  const offX   = padding + (cw - padding * 2 - rangeX * scale) / 2;
  const offY   = padding + (ch - padding * 2 - rangeY * scale) / 2;
  return [offX + (x - minX) * scale, offY + (y - minY) * scale];
}

function computeBoundsFromPoints(pts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  mapBounds   = { minX, maxX, minY, maxY };
  boundsReady = minX < maxX && minY < maxY;
}

function updateBoundsFromStandings(standings) {
  let changed = false;
  for (const d of standings) {
    if (!d.x || !d.y || (d.x === 0 && d.y === 0)) continue;
    if (d.x < mapBounds.minX) { mapBounds.minX = d.x; changed = true; }
    if (d.x > mapBounds.maxX) { mapBounds.maxX = d.x; changed = true; }
    if (d.y < mapBounds.minY) { mapBounds.minY = d.y; changed = true; }
    if (d.y > mapBounds.maxY) { mapBounds.maxY = d.y; changed = true; }
  }
  if (changed) boundsReady = mapBounds.minX < mapBounds.maxX;
}

function accumulatePoints(standings) {
  for (const d of standings) {
    if (!d.x || !d.y || (d.x === 0 && d.y === 0)) continue;
    const key = Math.round(d.x / 10) + "," + Math.round(d.y / 10);
    if (!_trackSet.has(key)) {
      _trackSet.add(key);
      _trackPoints.push({ x: d.x, y: d.y });
    }
  }
}

// ─── Chargement tracé API ─────────────────────────────────────────────────────

async function loadApiTrack(sessionKey) {
  if (_loadingTrack || _lastLoadedSession === sessionKey) return;
  _loadingTrack = true;
  _lastLoadedSession = sessionKey;

  const leaderNum = (currentStandings.find(d => d.position === 1) || {}).driver_number || 1;

  try {
    const url  = `${PROXY}/api/track-layout?session_key=${sessionKey}&driver_number=${leaderNum}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    if (data.points && data.points.length >= 10) {
      _apiTrackPoints = data.points;
      computeBoundsFromPoints(_apiTrackPoints);
      updateBoundsFromStandings(currentStandings);
      rebuildTrackPath();
      console.info(`[tracker_map] Tracé API chargé : ${data.count} points (session ${sessionKey})`);
    } else {
      console.warn(`[tracker_map] Tracé API insuffisant (${data.count || 0} pts) — fallback legacy`);
      updateStore({ trackDisplayMode: "legacy" });
    }
  } catch (e) {
    console.warn("[tracker_map] Erreur tracé API :", e.message, "— fallback legacy");
    updateStore({ trackDisplayMode: "legacy" });
  }
  _loadingTrack = false;
}

// ─── Conversion GeoJSON → coordonnées métriques ───────────────────────────────
// FIX v6 : si aucun pilote n'a de positions, on centre sur le GeoJSON lui-même
// en traitant les degrés directement comme des unités métriques relatives.
// L'échelle correcte est rétablie par computeBoundsFromPoints.

const DEG_TO_M = Math.PI / 180 * 6371000;

function extractCoordsFromGeojson(geojson) {
  if (!geojson) return [];
  if (geojson.type === "LineString") return geojson.coordinates || [];
  if (geojson.type === "MultiLineString") {
    return (geojson.coordinates || []).flat();
  }
  if (geojson.type === "Feature") return extractCoordsFromGeojson(geojson.geometry);
  if (geojson.type === "FeatureCollection") {
    for (const f of (geojson.features || [])) {
      const r = extractCoordsFromGeojson(f);
      if (r.length > 0) return r;
    }
  }
  return [];
}

export function loadImportedTrack(geojson) {
  const coords = extractCoordsFromGeojson(geojson);
  if (coords.length < 10) {
    console.warn(`[tracker_map] GeoJSON importé : format non reconnu (${coords.length} pts)`);
    return false;
  }

  // Centroïde GeoJSON
  let latSum = 0, lonSum = 0;
  for (const c of coords) { lonSum += c[0]; latSum += c[1]; }
  const latMean = latSum / coords.length;
  const lonMean = lonSum / coords.length;
  const cosLat  = Math.cos(latMean * Math.PI / 180);

  // Centroïde OpenF1 depuis les positions pilotes (si disponibles)
  const valid = currentStandings.filter(d => d.x && d.y && (d.x !== 0 || d.y !== 0));
  let xMean = 0, yMean = 0;

  if (valid.length > 0) {
    // Cas normal : on a des positions pilotes → alignement
    for (const d of valid) { xMean += d.x; yMean += d.y; }
    xMean /= valid.length;
    yMean /= valid.length;

    _importedTrackPoints = coords.map(c => ({
      x: (c[0] - lonMean) * cosLat * DEG_TO_M + xMean,
      y: (c[1] - latMean) * DEG_TO_M + yMean,
    }));
  } else {
    // FIX v6 : pas de positions pilotes → projection pure WGS-84 → mètres relatifs
    // Le circuit est centré sur (0,0) en coordonnées métriques relatives
    _importedTrackPoints = coords.map(c => ({
      x: (c[0] - lonMean) * cosLat * DEG_TO_M,
      y: (c[1] - latMean) * DEG_TO_M,
    }));
  }

  computeBoundsFromPoints(_importedTrackPoints);
  if (valid.length > 0) updateBoundsFromStandings(currentStandings);
  rebuildTrackPath();
  console.info(`[tracker_map] GeoJSON importé : ${_importedTrackPoints.length} points`);
  return true;
}

// ─── Construction Path2D ──────────────────────────────────────────────────────

function buildPathFromPoints(pts) {
  if (!pts || pts.length < 5) return null;
  const path = new Path2D();
  let first = true;
  for (const pt of pts) {
    const coord = normalise(pt.x, pt.y, canvas.width, canvas.height);
    if (first) { path.moveTo(coord[0], coord[1]); first = false; }
    else        { path.lineTo(coord[0], coord[1]); }
  }
  if (pts.length > 10) path.closePath();
  return path;
}

function rebuildTrackPath() {
  if (!canvas) return;
  const mode = store.trackDisplayMode || "api";
  if (isSimMode) {
    trackPath = buildPathFromPoints(_activeTrackPoints);
  } else if (mode === "imported" && _importedTrackPoints.length >= 10) {
    trackPath = buildPathFromPoints(_importedTrackPoints);
  } else if (mode === "api" && _apiTrackPoints.length >= 10) {
    trackPath = buildPathFromPoints(_apiTrackPoints);
  } else {
    trackPath = buildPathFromPoints(_trackPoints);
  }
}

// ─── Animations ───────────────────────────────────────────────────────────────

function _detectPositionChanges(standings) {
  for (const d of standings) {
    const prev = _prevPositions.get(d.driver_number);
    if (prev !== undefined && prev !== d.position) {
      _animBounce.set(d.driver_number, { tick: 0, gained: d.position < prev });
    }
    _prevPositions.set(d.driver_number, d.position);
  }
}

function _updateGhostTrail(driver, px, py) {
  let trail = _ghostTrails.get(driver.driver_number);
  if (!trail) { trail = []; _ghostTrails.set(driver.driver_number, trail); }
  trail.push({ x: px, y: py, alpha: 0.5 });
  if (trail.length > 8) trail.shift();
  trail.forEach((pt, i) => { pt.alpha = (i + 1) / trail.length * 0.4; });
}

function _spawnParticles(px, py, color, count = 12) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3;
    _particles.push({
      x: px, y: py,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color, life: 1.0, maxLife: 1.0,
      size: 2 + Math.random() * 3,
    });
  }
}

function _triggerFlash(color) {
  _flashAnim = { color, alpha: 0.35, decay: 0.015 };
}

canvas?.addEventListener("sim-purple-lap", e => {
  const driver = currentStandings.find(d => d.driver_number === e.detail.driver?.driver_number);
  if (driver && driver.x && driver.y) {
    const coord = normalise(driver.x, driver.y, canvas.width, canvas.height);
    _spawnParticles(coord[0], coord[1], e.detail.color || "#9b59ff", 20);
    _triggerFlash("#9b59ff");
  }
});

// ─── Render Loop ──────────────────────────────────────────────────────────────

function render() {
  if (!canvas || !ctx) { requestAnimationFrame(render); return; }
  const cw = canvas.width  || 400;
  const ch = canvas.height || 400;
  const isLight = document.documentElement.dataset.theme === "light";

  ctx.clearRect(0, 0, cw, ch);

  if (_flashAnim) {
    ctx.fillStyle   = _flashAnim.color;
    ctx.globalAlpha = _flashAnim.alpha;
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;
    _flashAnim.alpha -= _flashAnim.decay;
    if (_flashAnim.alpha <= 0) _flashAnim = null;
  }

  if (isArchiveMode && !isSimMode) {
    ctx.fillStyle = isLight ? "rgba(255,248,220,0.12)" : "rgba(0,0,30,0.20)";
    ctx.fillRect(0, 0, cw, ch);
  }
  if (isSimMode) {
    ctx.fillStyle = isLight ? "rgba(245,240,255,0.08)" : "rgba(0,0,20,0.15)";
    ctx.fillRect(0, 0, cw, ch);
  }

  // Message si pas de données
  if (!boundsReady || !hasGpsData) {
    ctx.fillStyle    = isLight ? "#aaa" : "#555";
    ctx.font         = "bold 13px 'Titillium Web', sans-serif";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";

    const mode = store.trackDisplayMode || "api";

    if (isSimMode) {
      ctx.fillText("Démarrez la simulation pour voir la carte ▶", cw / 2, ch / 2);
    } else if (mode === "imported" && _importedTrackPoints.length >= 10) {
      // GeoJSON chargé mais pas de données GPS pilotes → afficher le tracé quand même
      // (boundsReady sera true dans ce cas via computeBoundsFromPoints)
    } else if (store.sessionMode === "preparing") {
      ctx.fillText("Session à venir — préparation en cours…", cw / 2, ch / 2);
    } else if (isArchiveMode) {
      ctx.fillText("Positions GPS non disponibles pour cette session", cw / 2, ch / 2 - 12);
      ctx.font      = "11px 'Titillium Web', sans-serif";
      ctx.fillStyle = isLight ? "#888" : "#444";
      ctx.fillText("Le classement officiel reste disponible dans la Timing Tower", cw / 2, ch / 2 + 12);
    } else if (_loadingTrack) {
      ctx.fillText("Chargement du tracé circuit…", cw / 2, ch / 2);
    } else {
      ctx.fillText("Données GPS en chargement…", cw / 2, ch / 2);
    }

    // Tenter quand même d'afficher le tracé GeoJSON importé (même sans GPS pilotes)
    if (mode === "imported" && _importedTrackPoints.length >= 10 && boundsReady && trackPath) {
      _drawTrack(cw, ch, isLight);
    }

    requestAnimationFrame(render);
    return;
  }

  _drawTrack(cw, ch, isLight);

  // Ghost trails (simulation)
  if (isSimMode) {
    for (const gd of currentStandings) {
      if (!gd.x || !gd.y) continue;
      const trail = _ghostTrails.get(gd.driver_number);
      if (!trail || trail.length < 2) continue;
      for (let ti = 1; ti < trail.length; ti++) {
        const ta = trail[ti - 1], tb = trail[ti];
        ctx.beginPath();
        ctx.moveTo(ta.x, ta.y);
        ctx.lineTo(tb.x, tb.y);
        ctx.strokeStyle = gd.team_color || "#fff";
        ctx.globalAlpha = tb.alpha;
        ctx.lineWidth   = 2;
        ctx.lineCap     = "round";
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  // Particules
  for (let pi = _particles.length - 1; pi >= 0; pi--) {
    const p = _particles[pi];
    p.x  += p.vx;
    p.y  += p.vy;
    p.vy += 0.08;
    p.life -= 0.025;
    if (p.life <= 0) { _particles.splice(pi, 1); continue; }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fillStyle   = p.color;
    ctx.globalAlpha = p.life;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Monoplaces
  for (const driver of currentStandings) {
    if (!driver.x || !driver.y || (driver.x === 0 && driver.y === 0)) continue;

    const coord    = normalise(driver.x, driver.y, cw, ch);
    const px = coord[0], py = coord[1];
    const isPinned = store.pinnedDrivers && store.pinnedDrivers.has(driver.driver_number);
    const color    = driver.team_color || "#ffffff";
    const isPale   = ["#DEE1E2","#dee1e2","#AAAAAD","#aaaaad"].includes(color);

    let scale = 1.0;
    const bounce = _animBounce.get(driver.driver_number);
    if (bounce) {
      bounce.tick++;
      const t = bounce.tick / 12;
      scale = 1 + Math.sin(t * Math.PI) * (bounce.gained ? 0.6 : 0.3);
      if (bounce.tick >= 12) _animBounce.delete(driver.driver_number);
    }

    const baseRadius = isPinned ? 10 : (isArchiveMode ? 7 : isSimMode ? 6 : 5);
    const radius     = baseRadius * scale;

    if (isSimMode) _updateGhostTrail(driver, px, py);

    if (isPinned || driver.position === 1) {
      ctx.beginPath();
      ctx.arc(px, py, radius + 5, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(px, py, radius, px, py, radius + 5);
      grad.addColorStop(0, color + "80");
      grad.addColorStop(1, color + "00");
      ctx.fillStyle = grad;
      ctx.fill();
    }

    if (driver.best_lap && isSimMode) {
      ctx.beginPath();
      ctx.arc(px, py, radius + 7 + Math.sin(Date.now() / 200) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = "#9b59ff";
      ctx.lineWidth   = 2;
      ctx.globalAlpha = 0.6 + Math.sin(Date.now() / 200) * 0.3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (driver.drs_open) {
      ctx.fillStyle = "#00d2be";
      ctx.fillRect(px - radius, py - radius - 4, radius * 2, 2);
    }

    if (isArchiveMode || isSimMode) {
      ctx.beginPath();
      ctx.arc(px, py, radius + 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    if (isLight && isPale) {
      ctx.strokeStyle = "#333";
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    if (driver.retired) {
      ctx.beginPath();
      ctx.moveTo(px - radius * 0.6, py - radius * 0.6);
      ctx.lineTo(px + radius * 0.6, py + radius * 0.6);
      ctx.moveTo(px + radius * 0.6, py - radius * 0.6);
      ctx.lineTo(px - radius * 0.6, py + radius * 0.6);
      ctx.strokeStyle = "#e10600";
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    if (isArchiveMode && !isSimMode && driver.position) {
      ctx.fillStyle    = isPale ? "#111" : "#fff";
      ctx.font         = `bold ${radius >= 9 ? 8 : 6}px 'JetBrains Mono', monospace`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(driver.position), px, py);
    }

    const labelY = py + radius + 10;
    if (isArchiveMode || isSimMode) {
      const label = driver.acronym || "";
      ctx.font  = "bold 8px 'Titillium Web', sans-serif";
      const tw  = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(px - tw / 2 - 2, labelY - 5, tw + 4, 10);
    }
    ctx.fillStyle    = isLight ? "#111" : "#fff";
    ctx.font         = `bold ${isPinned ? 10 : 8}px 'Titillium Web', sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(driver.acronym || "", px, labelY);
  }

  _renderPitGhostCar(cw, ch, isLight);
  _renderTelemetryScrub(cw, ch, isLight);
  _renderBadge(cw, ch, isSimMode, isArchiveMode);
  requestAnimationFrame(render);
}

function _renderPitGhostCar(cw, ch, isLight) {
  const standings = currentStandings || [];
  if (!standings.length) return;

  const targetNum = store.pitGhostDriver || (store.pitStrategyMode ? standings[0]?.driver_number : null);
  if (!targetNum) return;

  const driver = standings.find(d => d.driver_number === targetNum);
  if (!driver || driver.retired || !driver.x || !driver.y) return;

  const circuitName = store.session?.circuit_name || "Albert Park";
  const trackStatus = store.session?.track_status || "1";
  const pred = computePitExitPosition(driver, standings, circuitName, trackStatus);
  if (!pred) return;

  const pts = _activeTrackPoints.length >= 5
    ? _activeTrackPoints
    : (_apiTrackPoints.length >= 5 ? _apiTrackPoints : _importedTrackPoints);

  if (pts.length < 10) return;

  let curIdx = 0, minDistSq = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - driver.x;
    const dy = pts[i].y - driver.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      curIdx = i;
    }
  }

  const curRatio = curIdx / pts.length;
  const lapTimeSec = 88.0;
  const fractionLost = pred.lossApplied / lapTimeSec;
  const ghostRatio = (curRatio - fractionLost + 10.0) % 1.0;

  const ghostIdx = Math.max(0, Math.min(pts.length - 1, Math.floor(ghostRatio * (pts.length - 1))));
  const ghostPt = pts[ghostIdx];
  if (!ghostPt || ghostPt.x === undefined || ghostPt.y === undefined) return;

  const [gx, gy] = normalise(ghostPt.x, ghostPt.y, cw, ch);
  const [dx, dy] = normalise(driver.x, driver.y, cw, ch);

  const teamColor = driver.team_color || "#3671c6";
  const pulse = Math.sin(Date.now() / 180);

  ctx.save();

  // 1. Ligne en pointillés reliant la monoplace réelle à sa voiture fantôme
  ctx.beginPath();
  ctx.moveTo(dx, dy);
  ctx.lineTo(gx, gy);
  ctx.strokeStyle = `${teamColor}66`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 5]);
  ctx.stroke();
  ctx.setLineDash([]);

  // 2. Halo extérieur pulsant
  const ghostR = 8 + pulse * 2;
  ctx.beginPath();
  ctx.arc(gx, gy, ghostR + 4, 0, Math.PI * 2);
  ctx.fillStyle = `${teamColor}22`;
  ctx.fill();

  // 3. Disque fantôme avec contour pointillé
  ctx.beginPath();
  ctx.arc(gx, gy, ghostR, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(10, 15, 25, 0.75)";
  ctx.fill();

  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  // 4. Point focal intérieur
  ctx.beginPath();
  ctx.arc(gx, gy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  // 5. Étiquette fantôme
  const label = `👻 ${driver.acronym} SORTIE STAND (P${pred.projectedPosition})`;
  ctx.font = "bold 9px 'JetBrains Mono', monospace";
  const tw = ctx.measureText(label).width;
  const chipW = tw + 14;
  const chipH = 18;
  const chipX = Math.max(8, Math.min(cw - chipW - 8, gx - chipW / 2));
  const chipY = gy - ghostR - 16;

  ctx.fillStyle = "rgba(14, 18, 28, 0.92)";
  ctx.strokeStyle = pred.trafficRiskColor || teamColor;
  ctx.lineWidth = 1.2;
  ctx.shadowColor = pred.trafficRiskColor || teamColor;
  ctx.shadowBlur = 8;

  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(chipX, chipY, chipW, chipH, 4);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(chipX, chipY, chipW, chipH);
    ctx.strokeRect(chipX, chipY, chipW, chipH);
  }

  ctx.shadowBlur = 0;
  ctx.fillStyle = pred.trafficRiskColor || "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, chipX + chipW / 2, chipY + chipH / 2);

  ctx.restore();
}

function _renderTelemetryScrub(cw, ch, isLight) {
  if (!_scrubPoint || Date.now() - _scrubPoint.receivedAt > 3500) return;

  const pts = _activeTrackPoints.length >= 5
    ? _activeTrackPoints
    : (_apiTrackPoints.length >= 5 ? _apiTrackPoints : _importedTrackPoints);

  if (pts.length < 2) return;

  const idx = Math.max(0, Math.min(pts.length - 1, Math.floor(_scrubPoint.ratio * (pts.length - 1))));
  const pt = pts[idx];
  if (!pt || pt.x === undefined || pt.y === undefined) return;

  const [sx, sy] = normalise(pt.x, pt.y, cw, ch);

  const pulse = Math.sin(Date.now() / 140);
  const ringRadius = 14 + pulse * 4;

  ctx.save();

  // Halo extérieur pulsant
  ctx.beginPath();
  ctx.arc(sx, sy, ringRadius + 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 210, 190, 0.15)";
  ctx.fill();

  // Anneau lumineux
  ctx.beginPath();
  ctx.arc(sx, sy, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = "#00d2be";
  ctx.lineWidth = 2;
  ctx.shadowColor = "#00d2be";
  ctx.shadowBlur = 10;
  ctx.stroke();

  // Point focal central
  ctx.beginPath();
  ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.shadowBlur = 6;
  ctx.fill();

  // Bulle d'information flottante au-dessus du repère
  const label = `📍 ${Math.round(_scrubPoint.distance)}m · Δ ${_scrubPoint.delta >= 0 ? "+" : ""}${_scrubPoint.delta?.toFixed(3)}s`;
  ctx.font = "bold 9px 'JetBrains Mono', monospace";
  const tw = ctx.measureText(label).width;
  const chipW = tw + 14;
  const chipH = 18;
  const chipX = Math.max(8, Math.min(cw - chipW - 8, sx - chipW / 2));
  const chipY = sy - ringRadius - 16;

  ctx.fillStyle = "rgba(10, 15, 25, 0.9)";
  ctx.strokeStyle = "#00d2be";
  ctx.lineWidth = 1;
  ctx.shadowBlur = 8;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(chipX, chipY, chipW, chipH, 4);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(chipX, chipY, chipW, chipH);
    ctx.strokeRect(chipX, chipY, chipW, chipH);
  }

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#00d2be";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, chipX + chipW / 2, chipY + chipH / 2);

  ctx.restore();
}

function _drawTrack(cw, ch, isLight) {
  if (!trackPath) return;
  ctx.shadowBlur  = isSimMode ? 18 : 8;
  ctx.shadowColor = isSimMode ? "rgba(100,50,255,0.3)" : "rgba(0,0,0,0.4)";

  ctx.strokeStyle = isLight ? "#cccccc" : (isSimMode ? "#1a1535" : "#252535");
  ctx.lineWidth   = 16;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";
  ctx.stroke(trackPath);

  ctx.strokeStyle = isLight ? "#bbbbbb" : (isSimMode ? "#2a2050" : "#1a1a2a");
  ctx.lineWidth   = 11;
  ctx.stroke(trackPath);

  ctx.strokeStyle = isLight ? "rgba(180,180,180,0.4)" : "rgba(255,255,255,0.06)";
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([8, 12]);
  ctx.stroke(trackPath);
  ctx.setLineDash([]);

  ctx.shadowBlur  = 0;
  ctx.shadowColor = "transparent";
}

function _renderBadge(cw, ch, isSim, isArchive) {
  const mode = store.trackDisplayMode || "api";
  let label = null;
  let bgColor   = "rgba(0,0,0,0.65)";
  let textColor = "#ffd700";

  if (isSim) {
    const status = store.session && store.session.track_status;
    if      (status === "4") { label = "🟡 SAFETY CAR";    textColor = "#ffd700"; }
    else if (status === "6") { label = "🟡 VSC";            textColor = "#ff8800"; }
    else if (status === "5") { label = "🚩 DRAPEAU ROUGE"; textColor = "#e10600"; bgColor = "rgba(80,0,0,0.75)"; }
    else                     { label = "🎮 SIMULATION";    textColor = "#9b59ff"; }
  } else if (isArchive) {
    label = "📼 MODE ARCHIVE"; textColor = "#ffd700";
  } else if (mode === "imported" && _importedTrackPoints.length > 0) {
    label = "📂 TRACÉ IMPORTÉ"; textColor = "#00d2be";
  }

  if (!label) return;

  ctx.font      = "bold 9px 'Titillium Web', sans-serif";
  ctx.textAlign = "left";
  const tw = ctx.measureText(label).width;

  ctx.fillStyle = bgColor;
  if (ctx.roundRect) {
    ctx.beginPath(); ctx.roundRect(8, ch - 30, tw + 22, 22, 4); ctx.fill();
  } else {
    ctx.fillRect(8, ch - 30, tw + 22, 22);
  }

  const ts = store.session && store.session.track_status;
  if (ts === "5" || ts === "4") ctx.globalAlpha = 0.7 + Math.sin(Date.now() / 300) * 0.3;
  ctx.fillStyle    = textColor;
  ctx.textBaseline = "middle";
  ctx.fillText(label, 19, ch - 19);
  ctx.globalAlpha  = 1;
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────

let _zoom     = 1.0;
let _panX     = 0;
let _panY     = 0;
let _isPanning = false;
let _panStart  = { x: 0, y: 0, px: 0, py: 0 };

export function resetMapZoom() {
  _zoom = 1.0; _panX = 0; _panY = 0;
}

function _applyZoomTransform() {
  if (!canvas) return;
  canvas.style.transform       = `scale(${_zoom}) translate(${_panX}px, ${_panY}px)`;
  canvas.style.transformOrigin = "center center";
}

function _initZoom() {
  if (!canvas) return;
  const cont = canvas.parentElement;

  // Molette souris → zoom
  cont.addEventListener("wheel", e => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    _zoom = Math.max(0.5, Math.min(5, _zoom + delta));
    _applyZoomTransform();
  }, { passive: false });

  // Pince tactile → zoom
  let _lastDist = 0;
  cont.addEventListener("touchstart", e => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      _lastDist = Math.hypot(dx, dy);
    }
  }, { passive: true });
  cont.addEventListener("touchmove", e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (_lastDist > 0) {
        const delta = (dist - _lastDist) * 0.005;
        _zoom = Math.max(0.5, Math.min(5, _zoom + delta));
        _applyZoomTransform();
      }
      _lastDist = dist;
    }
  }, { passive: false });

  // Drag souris pour pan (quand zoomé)
  cont.addEventListener("mousedown", e => {
    if (_zoom <= 1) return;
    _isPanning = true;
    _panStart  = { x: e.clientX, y: e.clientY, px: _panX, py: _panY };
    cont.style.cursor = "grabbing";
  });
  document.addEventListener("mousemove", e => {
    if (!_isPanning) return;
    _panX = _panStart.px + (e.clientX - _panStart.x) / _zoom;
    _panY = _panStart.py + (e.clientY - _panStart.y) / _zoom;
    _applyZoomTransform();
  });
  document.addEventListener("mouseup", () => {
    _isPanning = false;
    if (cont) cont.style.cursor = "";
  });

  // Double-clic → reset
  cont.addEventListener("dblclick", () => { resetMapZoom(); _applyZoomTransform(); });
}

// ─── Resize ───────────────────────────────────────────────────────────────────

function resizeCanvas() {
  if (!canvas) return;
  const cont = canvas.parentElement;
  canvas.width  = cont.clientWidth  || 400;
  canvas.height = cont.clientHeight || 400;
  rebuildTrackPath();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initTrackerMap() {
  if (!canvas || !ctx) return;

  _initZoom();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  // Resize canvas quand la vue télémétrie devient visible (taille 0 sinon)
  window.addEventListener("popstate", () => {
    if (location.hash === "#telemetry") {
      requestAnimationFrame(resizeCanvas);
    }
  });
  // Au chargement si déjà sur telemetry
  if (location.hash === "#telemetry") {
    requestAnimationFrame(resizeCanvas);
  }

  // Écoute de l'événement de scrub télémétrique
  window.addEventListener("telemetry-scrub", (e) => {
    if (!e.detail) {
      _scrubPoint = null;
    } else {
      _scrubPoint = {
        ratio: e.detail.ratio,
        distance: e.detail.distance,
        speedA: e.detail.speedA,
        speedB: e.detail.speedB,
        delta: e.detail.delta,
        driverA: e.detail.driverA,
        driverB: e.detail.driverB,
        receivedAt: Date.now(),
      };
    }
  });

  // Restaurer GeoJSON importé depuis le store (persisté en session)
  if (store.importedTrackGeoJSON && store.trackDisplayMode === "imported") {
    loadImportedTrack(store.importedTrackGeoJSON);
  }

  onUpdate(state => {
    if (!state.standings || !state.standings.length) {
      if (state.sessionMode === "preparing") {
        hasGpsData = false;
        boundsReady = false;
      }
      // Mode imported : on peut afficher même sans standings
      if (state.trackDisplayMode === "imported" && _importedTrackPoints.length >= 10) {
        isSimMode     = false;
        isArchiveMode = false;
        return;
      }
      return;
    }

    const newSessionKey = state.session && state.session.session_key;
    if (newSessionKey && newSessionKey !== _currentSessionKey) {
      console.info(`[tracker_map] Changement session (${_currentSessionKey} → ${newSessionKey}) — reset`);
      _currentSessionKey = newSessionKey;
      resetTrackData();
      // Restaurer GeoJSON si toujours en mode imported
      if (state.trackDisplayMode === "imported" && state.importedTrackGeoJSON) {
        loadImportedTrack(state.importedTrackGeoJSON);
      }
    }

    isSimMode        = state._simulation === true || state.sessionMode === "simulation";
    isArchiveMode    = !isSimMode && (state.sessionMode === "archive" || state._archive === true);
    currentStandings = state.standings;

    _detectPositionChanges(state.standings);

    const prevStatus = render._lastTrackStatus;
    const newStatus  = state.session && state.session.track_status;
    if (newStatus !== prevStatus) {
      if      (newStatus === "4") _triggerFlash("#ffd700");
      else if (newStatus === "6") _triggerFlash("#ff8800");
      else if (newStatus === "5") _triggerFlash("#e10600");
      else if (prevStatus === "5" || prevStatus === "4") _triggerFlash("#00d2be");
      render._lastTrackStatus = newStatus;
    }

    // Mode simulation
    if (isSimMode && state._simTrackPoints && state._simTrackPoints.length) {
      if (_activeTrackPoints !== state._simTrackPoints) {
        _activeTrackPoints = state._simTrackPoints;
        computeBoundsFromPoints(_activeTrackPoints);
        rebuildTrackPath();
      }
      hasGpsData = state.standings.some(d => d.x && d.y && (d.x !== 0 || d.y !== 0));
      return;
    }

    hasGpsData = state.standings.some(d => d.x && d.y && (d.x !== 0 || d.y !== 0));
    const mode       = state.trackDisplayMode || "api";
    const sessionKey = state.session && state.session.session_key;

    if (mode === "imported") {
      if (_importedTrackPoints.length >= 10) {
        // Toujours recalculer les bounds pour inclure les pilotes
        computeBoundsFromPoints(_importedTrackPoints);
        updateBoundsFromStandings(state.standings);
        rebuildTrackPath();
      } else if (state.importedTrackGeoJSON) {
        // GeoJSON dans le store mais pas encore chargé (ex: refresh page)
        loadImportedTrack(state.importedTrackGeoJSON);
      } else {
        // Fallback accumulation pendant qu'on attend
        updateBoundsFromStandings(state.standings);
        accumulatePoints(state.standings);
        rebuildTrackPath();
      }
    } else if (mode === "api") {
      if (sessionKey && _apiTrackPoints.length === 0 && !_loadingTrack) {
        loadApiTrack(sessionKey);
      }
      if (_apiTrackPoints.length >= 10) {
        updateBoundsFromStandings(state.standings);
        rebuildTrackPath();
      } else {
        updateBoundsFromStandings(state.standings);
        accumulatePoints(state.standings);
        rebuildTrackPath();
      }
    } else {
      // Legacy
      updateBoundsFromStandings(state.standings);
      accumulatePoints(state.standings);
      rebuildTrackPath();
    }
  });

  render._lastTrackStatus = null;
  requestAnimationFrame(render);
}