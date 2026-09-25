/**
 * store.js — État global mutable. Source de vérité unique.
 */

const _listeners = [];

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem("f1-prefs") || "{}"); }
  catch { return {}; }
}
const savedPrefs = loadPrefs();

export const store = {
  // Données statiques
  drivers:           {},
  teams:             {},
  calendar:          [],
  drivers_standings: [],
  teams_standings:   [],
  last_race:         null,
  _standings_updated_at: null,

  // Données live
  session:         {},
  standings:       [],
  weather:         {},
  raceControl:     [],
  ingestionStatus: { mode: "archive", status_label: "Mode Archive", has_token: false, latency_ms: 0 },
  team_radios:     [],
  news:            [],

  // Préférences utilisateur
  theme:           savedPrefs.theme           ?? "dark",
  oled:            savedPrefs.oled            ?? false,
  timingTowerMode: savedPrefs.timingTowerMode ?? "expanded", // "expanded" (Aéré) | "compact" (Compact)
  carMetrics:      savedPrefs.carMetrics      ?? true,
  cornerNumbers:   savedPrefs.cornerNumbers   ?? false,
  towerHeader:     savedPrefs.towerHeader     ?? true,
  bestSectors:     savedPrefs.bestSectors     ?? true,
  scColors:        savedPrefs.scColors        ?? true,
  rcSound:         savedPrefs.rcSound         ?? true,
  rcVolume:        savedPrefs.rcVolume        ?? 50,
  // Sons interface
  uiSound:         savedPrefs.uiSound         ?? true,   // sons UI (clics, nav, etc.)
  uiVolume:        savedPrefs.uiVolume        ?? 60,     // volume UI 0-100
  eventSound:      savedPrefs.eventSound      ?? true,   // sons événements course
  eventVolume:     savedPrefs.eventVolume     ?? 70,     // volume événements 0-100
  pinnedDrivers:        new Set(savedPrefs.pinnedDrivers ?? []),
  speedUnit:            savedPrefs.speedUnit      ?? "kmh",
  delay:                savedPrefs.delay          ?? 0,
  // Mode d'affichage du circuit : "api" | "imported" | "legacy"
  trackDisplayMode:     savedPrefs.trackDisplayMode ?? "api",
  // GeoJSON importé (non persisté, rechargement nécessaire)
  importedTrackGeoJSON: null,

  // Système d'overlays redimensionnables
  overlayLayouts: savedPrefs.overlayLayouts ?? null,  // null = prédisposition par défaut
  activePreset:   savedPrefs.activePreset   ?? "broadcast",
  editMode:       false, // non persisté, toujours false au démarrage

  // Système d'alertes & notifications en direct (Proposal 5)
  alertsConfig: {
    enabled:              savedPrefs.alertsEnabled              ?? true,
    soundAlerts:          savedPrefs.alertsSound                ?? true,
    desktopNotifications: savedPrefs.alertsDesktop              ?? false,
    onlyFavoriteDrivers:  savedPrefs.alertsOnlyFav              ?? false,
    triggers: {
      pitStops:          savedPrefs.alertTriggerPitStops        ?? true,
      safetyCar:         savedPrefs.alertTriggerSafetyCar       ?? true,
      fastestLap:        savedPrefs.alertTriggerFastestLap      ?? true,
      leadChange:        savedPrefs.alertTriggerLeadChange      ?? true,
      positionChanges:   savedPrefs.alertTriggerPositionChanges ?? true,
      stewardsDecisions: savedPrefs.alertTriggerStewards        ?? true,
      rainArrival:       savedPrefs.alertTriggerRain            ?? true,
    }
  },
};

export function updateStore(patch) {
  Object.assign(store, patch);
  _listeners.forEach(fn => fn(store));
}

export function savePrefs() {
  const prefs = {
    theme: store.theme, oled: store.oled,
    timingTowerMode: store.timingTowerMode,
    carMetrics: store.carMetrics, cornerNumbers: store.cornerNumbers,
    towerHeader: store.towerHeader, bestSectors: store.bestSectors,
    scColors: store.scColors, rcSound: store.rcSound,
    pinnedDrivers: [...store.pinnedDrivers],
    rcVolume: store.rcVolume,
    uiSound: store.uiSound, uiVolume: store.uiVolume,
    eventSound: store.eventSound, eventVolume: store.eventVolume,
    speedUnit: store.speedUnit, delay: store.delay,
    trackDisplayMode: store.trackDisplayMode,
    overlayLayouts: store.overlayLayouts,
    activePreset:   store.activePreset,
    // Alertes
    alertsEnabled:              store.alertsConfig?.enabled,
    alertsSound:                store.alertsConfig?.soundAlerts,
    alertsDesktop:              store.alertsConfig?.desktopNotifications,
    alertsOnlyFav:              store.alertsConfig?.onlyFavoriteDrivers,
    alertTriggerPitStops:        store.alertsConfig?.triggers?.pitStops,
    alertTriggerSafetyCar:       store.alertsConfig?.triggers?.safetyCar,
    alertTriggerFastestLap:      store.alertsConfig?.triggers?.fastestLap,
    alertTriggerLeadChange:      store.alertsConfig?.triggers?.leadChange,
    alertTriggerPositionChanges: store.alertsConfig?.triggers?.positionChanges,
    alertTriggerStewards:        store.alertsConfig?.triggers?.stewardsDecisions,
    alertTriggerRain:            store.alertsConfig?.triggers?.rainArrival,
  };
  localStorage.setItem("f1-prefs", JSON.stringify(prefs));
}


export function onUpdate(fn) {
  _listeners.push(fn);
}