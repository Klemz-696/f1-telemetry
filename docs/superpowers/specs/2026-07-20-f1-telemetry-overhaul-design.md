# Refonte complète F1 Telemetry — Spec de conception

**Date :** 2026-07-20
**Auteur :** session brainstorming (superpowers)
**Statut :** approuvé par l'utilisateur le 2026-07-20

---

## 1. Contexte & objectifs

Le projet F1 Telemetry est un dashboard F1 2026 (backend Python FastAPI + InfluxDB +
consumer SignalR live + syncs OpenF1/standings/results, frontend JS vanilla, proxy
Node, déploiement Docker sur VM Linux / serveur local).

L'utilisateur souhaite une **phase d'amélioration complète** :

- **Plus de données** (tour par tour, stratégie/pneus, historique, météo, radio écurie).
- **Plus d'interfaces** (nouvelles vues/pages, overlays live, fiches détaillées).
- **Plus d'options** (réglages, comparaisons, replay, alertes, personnalisation).
- **Plus de profondeur** (stats saison, tendances, prédictions stratégie, head-to-head, dégradation).
- **Correction globale de l'interface** (polish, bugs, responsive/mobile).

Objectif global : transformer le dashboard en hub F1 riche, profond, fiable — utilisable
en mode live **et** hors-live (sources ouvertes + simulation + archive), sans dépendre
exclusivement du jeton F1 (~5 jours, anti-bot).

## 2. Cadrage (décisions utilisateur)

| Axe | Décision |
|-----|----------|
| Priorités d'enrichissement | **Tout** (données + interfaces + options + profondeur) |
| Stratégie données | **Hybride complète** : sources ouvertes + déblocage live + simulation |
| Nouveautés phares | **Comparaisons, analyse stratégique, fiches détaillées** (pilotes/écuries/sessions/circuits) |
| Correction UI | **Polish + bugs + responsive/mobile** |
| Déblocage live | **Tout** : détection expiry + retry/backoff, proxy egress, tentative auto-refresh headless, fallback UI |
| Cadence loop | **Avec jalons validés** (l'utilisateur valide avant de poursuivre chaque jalon) |
| Prudence déploiement | **Rebuild Docker à chaque fonctionnalité complète** |
| Ingests backend | **Tout** : Jolpica/Ergast, metadata circuits, radio écurie, snapshots/replay |
| Fiches | **Toutes** : pilote, écurie, circuit, session/GP |
| Comparaison | Pilote vs pilote + écurie vs écurie (+ ghost cars + delta secteur) |
| Stratégie | **Tout** : fenêtre d'arrêts, undercut/overcut, dégradation, sim stratégique |
| Options | **Tout** : pilotes épinglés+, alertes configurables, thèmes & densité, replay timeline |

## 3. Architecture & flux

```
Sources ──────────── backend (Python) ─────────── API (FastAPI) ────────── frontend (vanilla)

SignalR F1 live ─► consumer.py ────────────────┐
OpenF1         ─► openf1_sync.py ──────────────┤──► InfluxDB v2 (telemetry, lap charts, pits)
Jolpica/Ergast ─► history_sync.py   (NOUVEAU) ─┤──► état JSON (F1_STATE_DIR) ──► /static, /ws, /api/*
Circuits meta  ─► circuits_sync.py  (NOUVEAU) ─┤
Standings      ─► standings_sync.py ───────────┤
Snapshots      ─► results_sync.py + snapshots  ─┘   (extension)
                 egress proxy (.env) ─► live-unlock module (token health + retry/backoff + auto-refresh)

  BroadcastPayload (WS 2Hz, rétro-compatible)          Endpoints REST (NOUVEAU)
  + champs optionnels étendus (pits, stints,           /driver/{n}, /team/{x}, /circuit/{x},
    mini-secteurs, projections stratégie)               /session/{key}, /compare/*, /strategy/*, /replay/*
```

### Principes
- **Nouveaux services = nouveaux containers** dans `docker-compose.yml`, `restart: unless-stopped`,
  mêmes patterns que les syncs existants (`asyncio`, `INFLUX_*` via env, état JSON dans `F1_STATE_DIR`).
- **Rétro-compatibilité** : tous les champs ajoutés à `BroadcastPayload` sont **optionnels** avec valeurs
  par défaut ; le frontend existant continue de fonctionner inchangé tant qu'il ignore les nouveaux champs.
- **Pas de régression** : les services existants ne sont **pas** refactorisés pour le plaisir — seules
  des extensions ciblées (ajout de champs, nouveau route, garde anti-régression) sont apportées.

## 4. Domaines & jalons

Huit domaines, chacun décomposé en jalons (features) **isolés, démoables, testés, rebuild Docker**.
Chaque jalon = une feature complète bout-en-bout (ingest → API → vue frontend). C'est la colonne
vertébrale du plan et de la boucle loop.

### D1 — Fondations données & déblocage live
- **D1.1** `history_sync.py` (Jolpica/Ergast) : calendrier historique, classements chronologiques,
  lap charts, pit stops, résultats par course, derniers temps par tour. Persistance Influx + état JSON.
- **D1.2** `circuits_sync.py` : metadata circuits enrichis (virages, secteurs, zones DRS, altitudes,
  records du tour, longueur, type). Source OpenF1 + fallback fichier GeoJSON (déjà supporté côté UI).
- **D1.3** Snapshots & replay : `results_sync.py` étendu persiste un snapshot JSON complet par session
  finie (standings tour-par-tour, pits, météo, RC), hors retention Influx (168h). Alimente `/replay/*`.
- **D1.4** Déblocage live : module `live_unlock` (health token + détection expiration + retry/backoff
  exponentiel), proxy egress configurable dans `.env`, **tentative** auto-refresh headless (best-effort,
  documentée comme risquée), alerte UI quand token expire.
- **D1.5** Fallback UI transparent : quand live KO, transition sans heurt vers simulation/archive avec
  bandeau d'info clair (amélioration du `live-pause-notice` existant).

### D2 — API enrichie + projections
- **D2.1** Modèles Pydantic : `PitStop`, `TyreStint`, `MiniSector`, `LapRow`, `DriverSeasonStats`,
  `TeamSeasonStats`, `CircuitCorner`, `StrategyProjection`, `TelemetrySample`, `HeadToHead`.
- **D2.2** Endpoints fiches : `GET /driver/{number}`, `GET /team/{name}`, `GET /circuit/{key}`,
  `GET /session/{key}` (détails carrière, stats saison, historique tours, déroulé).
- **D2.3** Endpoints comparaison : `GET /compare/drivers?a=&b=&session=`, `/compare/teams?a=&b=`.
- **D2.4** Endpoints stratégie : `GET /strategy/pit-window/{session}`, `/strategy/undercut/{session}`,
  `/strategy/degradation/{session}`, `/strategy/simulate` (POST, scénarios).
- **D2.5** Endpoints replay : `GET /replay/sessions`, `/replay/{key}/timeline`, `/replay/{key}/at?lap=`.
- **D2.6** Extension `assemble_payload()` : ajoute pits récents, stints actuels, mini-secteurs et
  projections stratégie dans `BroadcastPayload` (champs optionnels, rétro-compatibles).

### D3 — Fiches détaillées (pages)
- **D3.1** Fiche pilote (`#driver/{n}`) : identité, carrière, stats saison, graphes de performance,
  historique tours, duels gagnés, historique pneus, derniers résultats.
- **D3.2** Fiche écurie (`#team/{x}`) : pilotes courants, stats constructeurs, fiabilité (abandons),
  comparaison coéquipiers, courbes de performance sur la saison.
- **D3.3** Fiche circuit (`#circuit/{x}`) : tracé détaillé (virages, secteurs, DRS), records du tour,
  historique du GP, caractéristiques (vitesse/mixte/lent), altitude/topographie.
- **D3.4** Fiche session/GP (`#session/{key}`) : déroulé tour par tour, stratégies pneus, chronologie
  des événements RC, résumé, classements final & intermédiaires.

### D4 — Outils de comparaison
- **D4.1** Pilote vs pilote : stats head-to-head + superposition télémétrie (vitesse/throttle/brake/rapport)
  sur un tour ou une session. Vue dédiée `#compare/drivers`.
- **D4.2** Écurie vs écurie : points, fiabilité, courbes de performance saison. Vue `#compare/teams`.
- **D4.3** Ghost cars carte : superposition des trajectoires de plusieurs pilotes sur le tracé
  (extension de `tracker_map.js`) avec sélecteur multi-pilotes.
- **D4.4** Delta secteur-par-secteur : écart cumulé, mini-secteurs, chevrons de performance entre deux
  pilotes (composant réutilisable dans fiches et compare).

### D5 — Analyse stratégie
- **D5.1** Fenêtre d'arrêts : position actuelle, points probables d'arrêt, projections de fin de course
  (basées stints en cours + dégradation estimée).
- **D5.2** Undercut/overcut : delta pit in/out, gain/perte réel observé, scénarios sous SC/VSC.
- **D5.3** Dégradation pneus : courbes par composé, delta d'usure (s/ tour), delta de performance.
- **D5.4** Sim stratégique : scénarios d'arrêts configurables (POST), projections points / classement final.
  Vue `#strategy`.

### D6 — Enrichissements dashboard Live
- **D6.1** Panneau stratégie (overlay `ov-strategy`) : fenêtre d'arrêts + projections live, drag/resize.
- **D6.2** Panneau stints/pneus (overlay `ov-tyres`) : composés en cours, âge, stint planifié/exécuté.
- **D6.3** Lap chart (overlay `ov-lapchart`) : positions par tour, escargot/bristle chart interactif.
- **D6.4** Mini-secteurs : découpe fine du tour dans le timing tower / carte.
- **D6.5** Head-to-head mini : comparateur compact de deux pilotes en overlay live.
- **D6.6** Hero/band enrichi : données rich-media dans le bandeau session (vents direction, pression,
  humidité détaillée, pointeur d'écart dynamique).

### D7 — Options & personnalisation
- **D7.1** Pilotes épinglés+ : multi-sélection (déjà existant), **groupes** d'épinglés, **alertes dédiées**
  par pilote (overtake, pit, retire, best lap).
- **D7.2** Alertes configurables : DRS, Safety Car, dépassements, meilleur tour, entrée stand — au choix
  par type, avec seuils et canaux (son visuel/sonore/notification).
- **D7.3** Thèmes & densité : jeux de couleurs (au-delà sombre/clair), mode compact/espacé, taille de
  texte globale (au-delà du A± par panneau).
- **D7.4** Replay timeline : scrubbing d'une session archive, vitesses de rejeu, points de repère
  (tours, événements RC, pit stops).

### D8 — Correction globale UI
- **D8.1** Polish & cohérence : typo, couleurs, espacements, état vide/chargement, identité visuelle.
- **D8.2** Bugs & glitches : défauts existants repérés et listés au fil du loop (tracker-map, overlay
  drag sur petits écrans, condition de course mobile, etc.).
- **D8.3** Responsive/mobile : mise en page petits écrans, tactile, orientation, densité d'info,
  tabs mobile cohérents avec les nouveaux overlays.
- **D8.4** A11y & perf : contraste, navigation clavier, lissage animations, mode éco-batterie
  (réduction de cadence WS quand onglet inactif).

## 5. Modèles de données (extensions Pydantic)

Tous **optionnels** (default_factory ou valeur par défaut) pour préserver la rétro-compatibilité.

```python
class PitStop(BaseModel):
    lap: int = 0
    driver_number: int = 0
    compound_in: str = "UNKNOWN"
    compound_out: str = "UNKNOWN"
    pit_duration: float = 0.0
    lap_time_before: str = ""
    lap_time_after: str = ""

class TyreStint(BaseModel):
    driver_number: int = 0
    stint: int = 0
    compound: str = "UNKNOWN"
    laps: int = 0
    tyre_age_at_start: int = 0
    avg_lap_time: str = ""

class MiniSector(BaseModel):
    driver_number: int = 0
    index: int = 0
    duration_ms: int = 0

class LapRow(BaseModel):
    lap: int = 0
    position: int = 0
    driver_number: int = 0
    lap_time: str = ""
    pit: bool = False

class DriverSeasonStats(BaseModel):
    driver_number: int = 0
    points: float = 0
    wins: int = 0
    podiums: int = 0
    poles: int = 0
    fastest_laps: int = 0
    dnf: int = 0
    avg_finish: float = 0.0
    h2h_teammate: float = 0.0  # % gagné vs coéquipier

class TeamSeasonStats(BaseModel):
    name: str = ""
    points: float = 0
    dnf: int = 0
    avg_finish: float = 0.0
    reliability: float = 0.0  # % arrivés

class CircuitCorner(BaseModel):
    number: int = 0
    name: str = ""
    angle: float = 0.0
    length: float = 0.0
    drs_zone: bool = False

class StrategyProjection(BaseModel):
    driver_number: int = 0
    recommended_pit_lap: int = 0
    projected_finish: str = ""
    undercut_window: str = ""
    current_compound: str = "UNKNOWN"
    current_age: int = 0

class TelemetrySample(BaseModel):
    lap: int = 0
    t: float = 0.0
    speed: int = 0
    rpm: int = 0
    throttle: int = 0
    brake: int = 0
    gear: int = 0
    drs: bool = False

class HeadToHead(BaseModel):
    driver_a: int = 0
    driver_b: int = 0
    laps_ahead_a: int = 0
    laps_ahead_b: int = 0
    avg_delta: str = ""
    qualifying_ahead: str = ""
```

`BroadcastPayload` étendu (champs optionnels ajoutés à la fin) :
```python
class BroadcastPayload(BaseModel):
    server_ts: float
    session: SessionState = Field(default_factory=SessionState)
    standings: list[DriverTelemetry] = Field(default_factory=list)
    weather: WeatherState = Field(default_factory=WeatherState)
    race_control: list[RaceControlMessage] = Field(default_factory=list)
    # NOUVEAU (D2.6) — tous optionnels :
    pit_stops: list[PitStop] = Field(default_factory=list)
    stints: list[TyreStint] = Field(default_factory=list)
    strategy: list[StrategyProjection] = Field(default_factory=list)
```

## 6. Endpoints API (nouveaux)

| Méthode | Route | Jalon | Rôle |
|---------|-------|------|------|
| GET | `/driver/{number}` | D2.2/D3.1 | Fiche pilote (carrière, stats, graphes) |
| GET | `/team/{name}` | D2.2/D3.2 | Fiche écurie |
| GET | `/circuit/{key}` | D2.2/D3.3 | Fiche circuit (corners, records) |
| GET | `/session/{key}` | D2.2/D3.4 | Fiche session/GP (déroulé) |
| GET | `/compare/drivers` | D2.3/D4.1 | Comparaison deux pilotes (query `a`,`b`,`session`) |
| GET | `/compare/teams` | D2.3/D4.2 | Comparaison deux équipes |
| GET | `/strategy/pit-window/{session}` | D2.4/D5.1 | Fenêtre d'arrêts |
| GET | `/strategy/undercut/{session}` | D2.4/D5.2 | Undercut/overcut |
| GET | `/strategy/degradation/{session}` | D2.4/D5.3 | Dégradation pneus |
| POST | `/strategy/simulate` | D2.4/D5.4 | Simulation stratégique |
| GET | `/replay/sessions` | D2.5/D7.4 | Sessions archivées disponibles |
| GET | `/replay/{key}/timeline` | D2.5/D7.4 | Timeline tour-par-tour |
| GET | `/replay/{key}/at?lap=` | D2.5/D7.4 | État à un tour donné |
| GET | `/health` | existant | Étendu : ajoute `token_status`, `last_ingest_ts` |

CORS : `allow_methods` étendu à `["GET", "POST"]` (uniquement pour `/strategy/simulate`).
`POST` requête validation Pydantic d'un corps `SimulationScenario`.

## 7. Frontend (vues & composants)

### Hash routing étendu (nav.js + app.js)
- Existants : `#home`, `#results`, `#calendar`, `#standings`, `#telemetry`.
- Nouveaux : `#driver/{n}`, `#team/{x}`, `#circuit/{x}`, `#session/{key}`,
  `#compare/drivers`, `#compare/teams`, `#strategy`, `#replay`.
- La nav conserve 5 entrées principales ; les fiches/comparaison/stratégie/replay sont des
  **routes secondaires** accessibles par clics depuis les vues existantes (ex. cliquer un pilote
  dans le classement → `#driver/{n}`). Un moteur de routing léger gère les routes paramétrées
  sans ajouter de dépendance (vanilla).

### Nouveaux composants (modules dans `frontend/js/components/`)
- `driver_detail.js`, `team_detail.js`, `circuit_detail.js`, `session_detail.js` (fiches D3).
- `compare_drivers.js`, `compare_teams.js` (D4.1/D4.2).
- `ghost_cars.js` (extension de `tracker_map.js`, D4.3).
- `delta_sector.js` (D4.4, réutilisable).
- `strategy_panel.js`, `tyres_panel.js`, `lap_chart.js`, `mini_sectors.js`,
  `head_to_head_mini.js` (overlays D6).
- `replay_player.js`, `replay_timeline.js` (D7.4).
- `alerts_config.js`, `pinned_groups.js`, `theme_density.js` (D7).

### Conventions reprises
- Modules ES6, store `localStorage` via `store.js`, `updateStore`/`onUpdate`.
- Overlays via `overlay_manager.js` (drag/resize/font-zorder déjà en place) ; les nouveaux
  overlays (D6.1-D6.5) s'enregistrent comme `ov-timing`, `ov-map`, etc.
- Sons via `sound_engine.js` pour les nouvelles alertes.
- Pas de framework, pas de build step — fichiers statiques servis par nginx.

## 8. Options & personnalisation (détails D7)

- **D7.1 Pilotes épinglés+** : `pref-favorite-driver` (existant) étendu en **groupes nommés**
  (`pinned_groups` dans le store) + alertes par pilote (overtake/pit/retire/best-lap) avec
  type de notification (bannière, toast, son).
- **D7.2 Alertes configurables** : table dans les réglages — par type d'événement (DRS, SC,
  dépassement, meilleur tour, stand), activer/désactiver + seuil + canal. Persisté dans le store.
- **D7.3 Thèmes & densité** : au-delà de `data-theme=dark|light`, ajouter `data-density=compact|normal|spaced`
  et `--global-font-scale` (racine CSS), plus 2-3 palettes alternatives (F1 broadcasting, neon, muted).
- **D7.4 Replay timeline** : lecteur de session archive avec play/pause, scrub, régulateur de vitesse
  (0.5×, 1×, 2×, 4×), marqueurs posés sur les tours / événements RC / pit stops.

## 9. Déblocage live (D1.4 détail)

Module `live_unlock.py` (utilisé par `consumer.py`) :
- **Health token** : décodage du JWT `F1_AUTH_TOKEN` → date `exp` ; alerte (log + endpoint
  `/health` + bannière UI) quand `exp - now < 24h`.
- **Retry/backoff** : sur HTTP 401/429 du flux SignalR, backoff exponentiel (1s→2s→…→60s plafond),
  re-négociation automatique, et log clair "*token expiré, renouvellement manuel requis*".
- **Proxy egress** : variables `F1_EGRESS_PROXY` (HTTP(S) proxy) dans `.env.example` ;
  `consumer.py` route la négociation via ce proxy si défini (varier l'IP de sortie).
- **Auto-refresh headless** (best-effort, marqué *risqué*) : fonction tentant une régénération
  sans navigateur ; documentée comme pouvant échouer à cause des protections anti-bot ; désactivée
  par défaut (`F1_AUTO_REFRESH_TOKEN=false`).
- **Fallback UI** : quand le live tombe, `watchSessionState()` bascule automatiquement vers
  archive (dernière session connue) ou simulation, avec bandeau explicatif.

## 10. Contraintes déploiement

- Nouveaux services dans `docker-compose.yml` : `history_sync`, `circuits_sync` (+ extensions
  `results_sync`). `restart: unless-stopped`, mêmes réseaux (`net_egress` + `net_internal` selon),
  même politique de logs.
- Variables `.env.example` : `F1_EGRESS_PROXY`, `F1_AUTO_REFRESH_TOKEN`, préfixe cache circuits.
  Jolpica/Ergast est une API publique sans clé — aucune variable de clé API requise.
- Test à chaque fonctionnalité complète : validation `docker compose config`, rebuild du service
  concerné, `docker compose up -d <service>`, vérification des logs.
- Renversement prod : snapshot Proxmox recommandé avant le premier déploiement D1 (cf. README).

## 11. Mécanique du loop

1. Le skill `writing-plans` produit un **plan d'implémentation détaillé** (fichier plans) : un
   **jalon par feature** (D1.1 … D8.4), chacun avec tâches/checks/tests/rebuild.
2. Passage en **mode loop** (`/loop`) avec **intervalle dynamique** piloté par `ScheduleWakeup` :
   à chaque activation, le loop lit l'état du plan, exécute **un seul jalon** (feature complète),
   teste les vues/endpoints, **rebuild Docker du service concerné**, et **rapporie** résultats
   + preuves (sortie de tests, logs extraits).
3. **Arrêt à chaque jalon** : la boucle s'interrompt après le rapport et **attend la validation**
   utilisateur (cadrage «Avec jalons validés»). L'utilisateur valide → l'activation suivante
   avance au jalon suivant.
4. Arrêt automatique à la fin du plan (plus de jalons en attente).
5. En cas d'échec (test KO, build KO), le jalon reste *in_progress*, le rapport affiche l'erreur
   avec sortie, et le loop attend une décision (corriger / ajuster / passer).

## 12. Risques & mitigations

| Risque | Mitigation |
|--------|------------|
| Jeton F1 ~5j / anti-bot | Détection + retry/backoff (fiable) ; proxy egress optionnel ; auto-refresh marqué best-effort |
| InfluxDB retention 168h | Snapshots JSON persistants pour replay/historique long (hors retention) |
| Régression vue existante | Champs BroadcastPayload optionnels (rétro-compat), nouveaux services isolés |
| Périmètre immense | Jalons isolés et indépendants → arrêt/reprise à tout jalon sans casser le reste |
| Sources ouvertes indispo | Fallback en cascade (Jolpica → OpenF1 → données statiques `f1_2026.py`) + cache local |
| Performance frontend | Cadence WS réduite quand onglet inactif (D8.4), graphes/lazy-load par fiche |
| POST CORS/CSRF | `allow_methods` étendu prudemment ; corps validé par Pydantic |

## 13. Non-objectifs (YAGNI)

- Pas de framework frontend (React/Vue) — reste vanilla.
- Pas de base de données relationnelle — InfluxDB + état JSON suffisent.
- Pas de compte utilisateur / authentification — dashboard local privé.
- Pas de refactor des services existants hors extension ciblée.
- Pas de rebuild complet de la stack à chaque jalon — uniquement le service impacté.
- Auto-refresh token headless **non garanti** (marqué best-effort) ; le renouvellement manuel
  reste la procédure de référence.

## 14. Ordre d'exécution (jalons)

D1.1 → D1.2 → D1.3 → D1.4 → D1.5 → D2.* (modèles puis endpoints puis extension WS) →
D3.1 → D3.2 → D3.3 → D3.4 → D4.1 → D4.2 → D4.3 → D4.4 → D5.1 → D5.2 → D5.3 → D5.4 →
D6.1 → D6.2 → D6.3 → D6.4 → D6.5 → D6.6 → D7.1 → D7.2 → D7.3 → D7.4 → D8.1 → D8.2 → D8.3 → D8.4.

D2 est traité en **arrière-plan en bloc** à l'intérieur du domaine (modèles Pydantic D2.1 en
premier, puis endpoints D2.2-D2.5 qui en dépendent, puis D2.6 extension WS) car ces étapes
internes ne sont pas indépendantes. Toutefois, le **jalon validable et démoable** pour
l'utilisateur est constitué par la **feature frontend qui consomme ces endpoints** — à savoir
D3.1 → D4.x → D5.x selon le sous-domaine. Concrètement : D2.1+D2.2 sont livrés et validés dans
le même jalon rebuild que la fiche D3 qui les utilise (D3.1 → D3.2 → D3.3 → D3.4), idem pour
les endpoints comparaison (D2.3) validés avec D4.1/D4.2, stratégie (D2.4) avec D5.x, replay
(D2.5) avec D7.4. D2.6 (extension BroadcastPayload) est validé avec D6.1.
