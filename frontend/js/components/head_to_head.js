/**
 * head_to_head.js
 * Composant de télémétrie comparative Head-to-Head haute performance (60 FPS Canvas 2D).
 * Synchronise les données télémétriques de deux pilotes sur l'abscisse métrique du tour (distance en mètres).
 * Émet des événements 'telemetry-scrub' pour synchronisation avec la carte du circuit.
 */

import { store, onUpdate } from "../store.js";

// Couleurs par défaut si non spécifiées
const DEFAULT_COLOR_A = "#3671c6"; // Red Bull
const DEFAULT_COLOR_B = "#e8002d"; // Ferrari

// État local du composant
let _driverA = 1;
let _driverB = 16;
let _mode = "live";
let _telemetryData = null;
let _isLoading = false;
let _scrubState = { active: false, x: 0, index: -1, distance: 0 };
let _rafId = null;
let _resizeObserver = null;
let _lastFetchTime = 0;

function _getApiBase() {
  const h = window.location.hostname;
  const p = window.location.port;
  if (p === "8080" || p === "80" || p === "443" || p === "" || (h !== "localhost" && h !== "127.0.0.1")) {
    return window.location.origin;
  }
  return "http://localhost:8000";
}

/**
 * Récupère les données comparatives depuis l'API FastAPI
 */
async function fetchComparisonData(force = false) {
  const now = Date.now();
  if (!force && now - _lastFetchTime < 3500 && _telemetryData) {
    return;
  }
  _lastFetchTime = now;

  const sessionKey = store.session?.session_key || 11253;
  const circuitName = store.session?.circuit_name || "Albert Park Circuit";

  const apiBase = _getApiBase();
  const query = `session_key=${sessionKey}&driver_a=${_driverA}&driver_b=${_driverB}&circuit=${encodeURIComponent(circuitName)}`;

  const endpoints = [`${apiBase}/api/telemetry/compare?${query}`];
  if (apiBase.includes(":8000")) {
    endpoints.push(`${apiBase}/telemetry/compare?${query}`);
  }

  _isLoading = true;
  _updateSummaryHeader();

  let data = null;
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, { cache: "no-store", headers: { Accept: "application/json" } });
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("application/json")) {
        data = await res.json();
        if (data?.telemetry_points?.length) break;
      }
    } catch {}
  }

  if (data && data.telemetry_points && data.telemetry_points.length > 0) {
    _telemetryData = data;
    _isLoading = false;
    _updateSummaryHeader();
    _drawCanvas();
    return;
  }

  // Fallback client local synthétique haute fidélité
  _telemetryData = _generateClientFallback(sessionKey, circuitName, _driverA, _driverB);
  _isLoading = false;
  _updateSummaryHeader();
  _drawCanvas();
}

/**
 * Générateur synthétique client haute fidélité en cas de coupure réseau ou mode autonome
 */
function _generateClientFallback(sessionKey, circuitName, numA, numB) {
  const lengthM = 5278.0;
  const stepM = 8.0;
  const count = Math.floor(lengthM / stepM) + 1;
  const distances = [];
  const speedA = [];
  const speedB = [];
  const throttleA = [];
  const throttleB = [];
  const brakeA = [];
  const brakeB = [];
  const gearA = [];
  const gearB = [];
  const drsA = [];
  const drsB = [];
  const deltaT = [];

  let cumulDelta = 0.0;

  // Recherche des métadonnées pilotes dans le store
  const standingA = (store.standings || []).find(d => d.driver_number === numA);
  const standingB = (store.standings || []).find(d => d.driver_number === numB);

  for (let i = 0; i < count; i++) {
    const d = i * stepM;
    distances.push(d);
    const r = d / lengthM;

    // Profil de vitesse réaliste F1
    const baseWave = Math.sin(r * Math.PI * 9) * 0.5 + Math.sin(r * Math.PI * 4) * 0.3;
    const isStraight = baseWave > 0.15;
    const isHardBraking = baseWave < -0.45;

    let va, vb, ta, tb, ba, bb, ga, gb, drs;

    if (isStraight) {
      va = 285 + baseWave * 60 + Math.sin(d * 0.05) * 4;
      vb = 282 + baseWave * 63 + Math.cos(d * 0.05) * 3;
      ta = 100; tb = 100;
      ba = 0;   bb = 0;
      ga = 8;   gb = 8;
      drs = r > 0.4 && r < 0.65 ? 1 : 0;
    } else if (isHardBraking) {
      va = 95 + (baseWave + 0.6) * 70;
      vb = 102 + (baseWave + 0.6) * 65;
      ta = 0;   tb = 0;
      ba = 95;  bb = 88;
      ga = 3;   gb = 3;
      drs = 0;
    } else {
      va = 180 + baseWave * 70;
      vb = 176 + baseWave * 72;
      ta = 65;  tb = 70;
      ba = 0;   bb = 0;
      ga = 5;   gb = 5;
      drs = 0;
    }

    va = Math.max(70, Math.min(352, va));
    vb = Math.max(70, Math.min(352, vb));

    const dt = (stepM / (va / 3.6)) - (stepM / (vb / 3.6));
    cumulDelta += dt;

    speedA.push(Math.round(va * 10) / 10);
    speedB.push(Math.round(vb * 10) / 10);
    throttleA.push(ta);
    throttleB.push(tb);
    brakeA.push(ba);
    brakeB.push(bb);
    gearA.push(ga);
    gearB.push(gb);
    drsA.push(drs);
    drsB.push(drs);
    deltaT.push(Math.round(cumulDelta * 1000) / 1000);
  }

  return {
    session_key: sessionKey,
    circuit_name: circuitName,
    circuit_length_m: lengthM,
    sample_count: count,
    distance: distances,
    driver_a: {
      driver_number: numA,
      acronym: standingA?.acronym || `D${numA}`,
      team: standingA?.team_name || "Équipe A",
      team_color: standingA?.team_color || DEFAULT_COLOR_A,
      lap_number: 18,
      lap_time_str: "1:19.428",
      speed: speedA,
      throttle: throttleA,
      brake: brakeA,
      gear: gearA,
      drs: drsA,
      rpm: speedA.map(v => Math.round(10500 + (v / 350) * 2300)),
    },
    driver_b: {
      driver_number: numB,
      acronym: standingB?.acronym || `D${numB}`,
      team: standingB?.team_name || "Équipe B",
      team_color: standingB?.team_color || DEFAULT_COLOR_B,
      lap_number: 18,
      lap_time_str: "1:19.684",
      speed: speedB,
      throttle: throttleB,
      brake: brakeB,
      gear: gearB,
      drs: drsB,
      rpm: speedB.map(v => Math.round(10400 + (v / 350) * 2400)),
    },
    delta_time: deltaT,
    time_diff_total: Math.round(cumulDelta * 1000) / 1000,
  };
}

/**
 * Met à jour le bandeau supérieur de résumé et les sélecteurs
 */
function _updateSummaryHeader() {
  const deltaBadge = document.getElementById("compare-delta-display");
  const pointInfo = document.getElementById("compare-point-info");
  if (!deltaBadge || !pointInfo) return;

  if (_isLoading && !_telemetryData) {
    deltaBadge.textContent = "CHARGEMENT…";
    pointInfo.textContent = "Acquisition des flux télémétriques en cours…";
    return;
  }

  if (!_telemetryData) {
    deltaBadge.textContent = "Δ --:--";
    pointInfo.textContent = "Sélectionnez deux pilotes pour comparer leur tour";
    return;
  }

  const { driver_a, driver_b, time_diff_total } = _telemetryData;
  const leaderA = time_diff_total <= 0;
  const leadDiff = Math.abs(time_diff_total);
  const leaderAcro = leaderA ? driver_a.acronym : driver_b.acronym;
  const leaderColor = leaderA ? driver_a.team_color : driver_b.team_color;

  deltaBadge.textContent = `Δ ${time_diff_total >= 0 ? "+" : "-"}${leadDiff.toFixed(3)}s (${leaderAcro})`;
  deltaBadge.style.borderColor = leaderColor;
  deltaBadge.style.boxShadow = `0 0 10px ${leaderColor}40`;

  if (_scrubState.active && _scrubState.index >= 0) {
    const k = _scrubState.index;
    const d = Math.round(_telemetryData.distance[k] || 0);
    const va = Math.round(_telemetryData.driver_a.speed[k] || 0);
    const vb = Math.round(_telemetryData.driver_b.speed[k] || 0);
    const dt = (_telemetryData.delta_time[k] || 0).toFixed(3);
    const ga = _telemetryData.driver_a.gear[k] || 0;
    const gb = _telemetryData.driver_b.gear[k] || 0;
    const ta = Math.round(_telemetryData.driver_a.throttle[k] || 0);
    const tb = Math.round(_telemetryData.driver_b.throttle[k] || 0);
    const ba = Math.round(_telemetryData.driver_a.brake[k] || 0);
    const bb = Math.round(_telemetryData.driver_b.brake[k] || 0);

    pointInfo.innerHTML = `
      <span>📍 <strong>${d}m</strong></span> · 
      <span style="color:${driver_a.team_color}"><strong>${driver_a.acronym}</strong>: ${va} km/h (R${ga}${ba > 0 ? ` 🛑${ba}%` : ` 🟢${ta}%`})</span> vs 
      <span style="color:${driver_b.team_color}"><strong>${driver_b.acronym}</strong>: ${vb} km/h (R${gb}${bb > 0 ? ` 🛑${bb}%` : ` 🟢${tb}%`})</span> · 
      <span class="compare-dt-readout">Δ ${dt >= 0 ? "+" : ""}${dt}s</span>
    `;
  } else {
    pointInfo.innerHTML = `
      <span>${_telemetryData.circuit_name} (${Math.round(_telemetryData.circuit_length_m)} m)</span> · 
      <span style="color:${driver_a.team_color}"><strong>${driver_a.acronym}</strong> ${driver_a.lap_time_str || ""}</span> vs 
      <span style="color:${driver_b.team_color}"><strong>${driver_b.acronym}</strong> ${driver_b.lap_time_str || ""}</span>
    `;
  }
}

/**
 * Tracé direct haute fidélité via l'API Canvas 2D
 */
function _drawCanvas() {
  const canvas = document.getElementById("canvas-telemetry");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width < 50 || height < 50) return;

  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  if (!_telemetryData || !_telemetryData.distance || !_telemetryData.distance.length) {
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "13px 'Titillium Web', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("En attente de données télémétriques…", width / 2, height / 2);
    ctx.restore();
    return;
  }

  const { distance, driver_a, driver_b, delta_time, circuit_length_m } = _telemetryData;
  const sampleCount = distance.length;

  // Dimensions et marges des 3 pistes
  const padLeft = 46;
  const padRight = 16;
  const padTop = 14;
  const padBottom = 22;
  const plotWidth = width - padLeft - padRight;
  const totalPlotH = height - padTop - padBottom;

  // Hauteurs relatives : Vitesse 50%, Delta 24%, Pédales & Boîte 26%
  const hSpeed = Math.floor(totalPlotH * 0.50);
  const hDelta = Math.floor(totalPlotH * 0.24);
  const hPedals = totalPlotH - hSpeed - hDelta;

  const ySpeedTop = padTop;
  const yDeltaTop = ySpeedTop + hSpeed;
  const yPedalsTop = yDeltaTop + hDelta;

  const colorA = driver_a.team_color || DEFAULT_COLOR_A;
  const colorB = driver_b.team_color || DEFAULT_COLOR_B;

  // ─── 1. GRILLES ET ARRIÈRE-PLANS ──────────────────────────────────────────

  // Fond global
  ctx.fillStyle = "rgba(10, 12, 18, 0.7)";
  ctx.fillRect(padLeft, padTop, plotWidth, totalPlotH);

  // Lignes de séparation de zones
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padLeft, yDeltaTop);
  ctx.lineTo(padLeft + plotWidth, yDeltaTop);
  ctx.moveTo(padLeft, yPedalsTop);
  ctx.lineTo(padLeft + plotWidth, yPedalsTop);
  ctx.stroke();

  // Grille verticale : Repères kilométriques
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";

  const kmStep = circuit_length_m > 6000 ? 1000 : 500;
  for (let m = 0; m <= circuit_length_m; m += kmStep) {
    const x = padLeft + (m / circuit_length_m) * plotWidth;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, padTop + totalPlotH);
    ctx.stroke();

    // Label sur l'axe X inférieur
    ctx.fillText(`${m}m`, x, padTop + totalPlotH + 15);
  }

  // ─── 2. PISTE 1 : VITESSES (0 - 360 km/h) ─────────────────────────────────

  const maxSpeed = 360;
  const speedLabels = [100, 200, 300];
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "right";

  for (const sp of speedLabels) {
    const y = ySpeedTop + hSpeed - (sp / maxSpeed) * hSpeed;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.fillText(`${sp}`, padLeft - 6, y + 3);
  }

  // Label Piste Vitesse
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = "bold 9px 'Titillium Web', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("VITESSE (KM/H)", padLeft + 8, ySpeedTop + 14);

  // Tracé Courbe Pilote B (arrière-plan)
  ctx.strokeStyle = colorB;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < sampleCount; i++) {
    const x = padLeft + (distance[i] / circuit_length_m) * plotWidth;
    const y = ySpeedTop + hSpeed - (driver_b.speed[i] / maxSpeed) * hSpeed;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Tracé Courbe Pilote A (premier plan)
  ctx.strokeStyle = colorA;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let i = 0; i < sampleCount; i++) {
    const x = padLeft + (distance[i] / circuit_length_m) * plotWidth;
    const y = ySpeedTop + hSpeed - (driver_a.speed[i] / maxSpeed) * hSpeed;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // ─── 3. PISTE 2 : DELTA TEMPS CUMULÉ (Δt) ──────────────────────────────────

  const maxDeltaAbs = Math.max(0.6, Math.min(2.5, Math.max(...delta_time.map(Math.abs))));
  const yZero = yDeltaTop + hDelta / 2;

  // Ligne de référence zéro
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padLeft, yZero);
  ctx.lineTo(padLeft + plotWidth, yZero);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "right";
  ctx.fillText("0.0s", padLeft - 6, yZero + 3);
  ctx.fillText(`+${maxDeltaAbs.toFixed(1)}s`, padLeft - 6, yDeltaTop + 10);
  ctx.fillText(`-${maxDeltaAbs.toFixed(1)}s`, padLeft - 6, yDeltaTop + hDelta - 4);

  // Label Piste Delta
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = "bold 9px 'Titillium Web', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`DELTA TEMPS (vert = ${driver_a.acronym} plus rapide)`, padLeft + 8, yDeltaTop + 14);

  // Remplissage dégradé sous la courbe du delta
  for (let i = 0; i < sampleCount - 1; i++) {
    const x1 = padLeft + (distance[i] / circuit_length_m) * plotWidth;
    const x2 = padLeft + (distance[i + 1] / circuit_length_m) * plotWidth;
    const dt1 = delta_time[i];
    const dt2 = delta_time[i + 1];

    const y1 = yZero + (dt1 / maxDeltaAbs) * (hDelta / 2);
    const y2 = yZero + (dt2 / maxDeltaAbs) * (hDelta / 2);

    ctx.fillStyle = dt1 <= 0 ? "rgba(0, 210, 190, 0.18)" : "rgba(232, 0, 45, 0.18)";
    ctx.beginPath();
    ctx.moveTo(x1, yZero);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2, yZero);
    ctx.closePath();
    ctx.fill();
  }

  // Tracé de la ligne Delta
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let i = 0; i < sampleCount; i++) {
    const x = padLeft + (distance[i] / circuit_length_m) * plotWidth;
    const y = yZero + (delta_time[i] / maxDeltaAbs) * (hDelta / 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // ─── 4. PISTE 3 : PÉDALES & BOÎTE DE VITESSES ─────────────────────────────

  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = "bold 9px 'Titillium Web', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("ACCÉLÉRATEUR (%) / FREIN (zones rouges) / RAPPORTS", padLeft + 8, yPedalsTop + 13);

  // Zones de freinage Pilote A & B
  for (let i = 0; i < sampleCount; i++) {
    const x = padLeft + (distance[i] / circuit_length_m) * plotWidth;
    const wStep = Math.max(1.5, plotWidth / sampleCount);

    // Frein B
    if (driver_b.brake[i] > 10) {
      ctx.fillStyle = "rgba(232, 0, 45, 0.35)";
      ctx.fillRect(x, yPedalsTop + 18, wStep, hPedals - 20);
    }
    // Frein A
    if (driver_a.brake[i] > 10) {
      ctx.fillStyle = "rgba(255, 75, 75, 0.6)";
      ctx.fillRect(x, yPedalsTop + 18, wStep, (hPedals - 20) * (driver_a.brake[i] / 100));
    }
  }

  // Courbes accélérateur
  ctx.strokeStyle = colorB + "bb";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < sampleCount; i++) {
    const x = padLeft + (distance[i] / circuit_length_m) * plotWidth;
    const y = yPedalsTop + hPedals - 2 - (driver_b.throttle[i] / 100) * (hPedals - 22);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.strokeStyle = colorA;
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  for (let i = 0; i < sampleCount; i++) {
    const x = padLeft + (distance[i] / circuit_length_m) * plotWidth;
    const y = yPedalsTop + hPedals - 2 - (driver_a.throttle[i] / 100) * (hPedals - 22);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Indicateurs de rapport engagé (Rapports 1 à 8)
  ctx.font = "8px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  let lastGear = -1;
  for (let i = 0; i < sampleCount; i += 4) {
    const g = driver_a.gear[i];
    if (g !== lastGear && g > 0) {
      const x = padLeft + (distance[i] / circuit_length_m) * plotWidth;
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      ctx.fillText(`${g}`, x, yPedalsTop + hPedals - 3);
      lastGear = g;
    }
  }

  // ─── 5. CURSEUR SCRUBBER INTERACTIF ───────────────────────────────────────

  if (_scrubState.active && _scrubState.index >= 0) {
    const k = _scrubState.index;
    const scrubX = padLeft + (distance[k] / circuit_length_m) * plotWidth;

    // Ligne verticale lumineuse
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(scrubX, padTop);
    ctx.lineTo(scrubX, padTop + totalPlotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Points de contact sur les courbes
    const ya = ySpeedTop + hSpeed - (driver_a.speed[k] / maxSpeed) * hSpeed;
    const yb = ySpeedTop + hSpeed - (driver_b.speed[k] / maxSpeed) * hSpeed;

    ctx.fillStyle = colorA;
    ctx.beginPath();
    ctx.arc(scrubX, ya, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = colorB;
    ctx.beginPath();
    ctx.arc(scrubX, yb, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Gestion des événements de curseur (souris & tactile)
 */
function _setupInteractions() {
  const canvas = document.getElementById("canvas-telemetry");
  if (!canvas) return;

  const handleMove = (clientX) => {
    if (!_telemetryData || !_telemetryData.distance || !_telemetryData.distance.length) return;

    const rect = canvas.getBoundingClientRect();
    const padLeft = 46;
    const padRight = 16;
    const plotWidth = rect.width - padLeft - padRight;
    const mouseX = clientX - rect.left - padLeft;

    const clampedX = Math.max(0, Math.min(plotWidth, mouseX));
    const ratio = clampedX / plotWidth;
    const totalDist = _telemetryData.circuit_length_m || 5000;
    const targetDist = ratio * totalDist;

    // Trouver l'indice le plus proche
    let bestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < _telemetryData.distance.length; i++) {
      const diff = Math.abs(_telemetryData.distance[i] - targetDist);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }

    _scrubState = {
      active: true,
      x: clampedX,
      index: bestIdx,
      distance: _telemetryData.distance[bestIdx],
    };

    _updateSummaryHeader();
    _drawCanvas();

    // Émission de l'événement global pour la carte circuit
    window.dispatchEvent(
      new CustomEvent("telemetry-scrub", {
        detail: {
          ratio: ratio,
          distance: _telemetryData.distance[bestIdx],
          speedA: _telemetryData.driver_a.speed[bestIdx],
          speedB: _telemetryData.driver_b.speed[bestIdx],
          delta: _telemetryData.delta_time[bestIdx],
          driverA: _telemetryData.driver_a,
          driverB: _telemetryData.driver_b,
        },
      })
    );
  };

  const handleEnd = () => {
    _scrubState.active = false;
    _updateSummaryHeader();
    _drawCanvas();
    // Notification de fin de scrub
    setTimeout(() => {
      if (!_scrubState.active) {
        window.dispatchEvent(new CustomEvent("telemetry-scrub", { detail: null }));
      }
    }, 1200);
  };

  canvas.addEventListener("mousemove", (e) => handleMove(e.clientX));
  canvas.addEventListener("mouseleave", handleEnd);

  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length > 0) handleMove(e.touches[0].clientX);
  }, { passive: true });

  canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length > 0) handleMove(e.touches[0].clientX);
  }, { passive: true });

  canvas.addEventListener("touchend", handleEnd);
}

/**
 * Remplit dynamiquement les listes déroulantes des pilotes
 */
function _populateDriverSelects() {
  const selA = document.getElementById("compare-drv-a");
  const selB = document.getElementById("compare-drv-b");
  if (!selA || !selB) return;

  const currentValA = parseInt(selA.value, 10) || _driverA;
  const currentValB = parseInt(selB.value, 10) || _driverB;

  // Liste des pilotes depuis le store
  const standings = store.standings || [];
  const driversList = standings.length > 0
    ? standings.map(s => ({
        number: s.driver_number,
        acronym: s.acronym,
        name: s.driver_name || s.acronym,
        team: s.team_name || "",
        pos: s.position,
      }))
    : [
        { number: 1, acronym: "VER", name: "Max Verstappen", team: "Red Bull Racing", pos: 1 },
        { number: 16, acronym: "LEC", name: "Charles Leclerc", team: "Scuderia Ferrari", pos: 2 },
        { number: 4, acronym: "NOR", name: "Lando Norris", team: "McLaren", pos: 3 },
        { number: 44, acronym: "HAM", name: "Lewis Hamilton", team: "Scuderia Ferrari", pos: 4 },
        { number: 81, acronym: "PIA", name: "Oscar Piastri", team: "McLaren", pos: 5 },
        { number: 63, acronym: "RUS", name: "George Russell", team: "Mercedes", pos: 6 },
        { number: 14, acronym: "ALO", name: "Fernando Alonso", team: "Aston Martin", pos: 7 },
        { number: 55, acronym: "SAI", name: "Carlos Sainz", team: "Williams", pos: 8 },
        { number: 10, acronym: "GAS", name: "Pierre Gasly", team: "Alpine", pos: 9 },
        { number: 31, acronym: "OCO", name: "Esteban Ocon", team: "Haas", pos: 10 },
      ];

  const buildOptions = (selectedNum) => {
    return driversList
      .map(
        d =>
          `<option value="${d.number}" ${d.number === selectedNum ? "selected" : ""}>
            ${d.acronym} #${d.number} (${d.team})
          </option>`
      )
      .join("");
  };

  selA.innerHTML = buildOptions(currentValA);
  selB.innerHTML = buildOptions(currentValB);

  _driverA = currentValA;
  _driverB = currentValB;
}

/**
 * Initialise le composant Head-to-Head
 */
export function initHeadToHead() {
  const overlay = document.getElementById("ov-compare");
  const canvas = document.getElementById("canvas-telemetry");
  if (!overlay || !canvas) {
    console.warn("[head_to_head] #ov-compare ou #canvas-telemetry introuvable.");
    return;
  }

  _populateDriverSelects();
  _setupInteractions();

  // Écoute des changements de sélection
  const selA = document.getElementById("compare-drv-a");
  const selB = document.getElementById("compare-drv-b");
  const modeSel = document.getElementById("compare-lap-mode");

  selA?.addEventListener("change", () => {
    _driverA = parseInt(selA.value, 10);
    fetchComparisonData(true);
  });

  selB?.addEventListener("change", () => {
    _driverB = parseInt(selB.value, 10);
    fetchComparisonData(true);
  });

  modeSel?.addEventListener("change", () => {
    _mode = modeSel.value;
    fetchComparisonData(true);
  });

  // Redimensionnement automatique réactif
  _resizeObserver = new ResizeObserver(() => {
    _drawCanvas();
  });
  _resizeObserver.observe(canvas.parentElement || canvas);

  // Abonnement aux mises à jour du store
  onUpdate((state) => {
    // Si la liste des pilotes s'enrichit, rafraîchir les sélecteurs
    if (state.standings && state.standings.length > 0) {
      const curA = parseInt(selA?.value, 10);
      const curB = parseInt(selB?.value, 10);
      if (!curA || !curB) {
        _populateDriverSelects();
      }
    }
  });

  // Chargement initial
  fetchComparisonData(true);

  // Rafraîchissement périodique léger en direct (toutes les 4 secondes)
  setInterval(() => {
    if (document.getElementById("ov-compare")?.style.display !== "none") {
      fetchComparisonData(false);
    }
  }, 4000);

  console.info("[head_to_head] Initialisé avec succès (Canvas 2D 60 FPS)");
}
