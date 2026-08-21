# 🏎️ Dossier Technique & Présentation de Projet : F1 Telemetry & Analytics Hub (Saison 2026)

**Auteur :** Clément Sauzède  
**Dépôt GitHub :** [https://github.com/Klemz-696/f1-telemetry](https://github.com/Klemz-696/f1-telemetry)  
**Licence :** MIT (Open Source)  
**Version :** 2.0.0 (Prêt pour la réglementation F1 2026)

---

## 📑 Sommaire
1. [Introduction & Contexte](#1-introduction--contexte)
2. [Objectifs du Projet](#2-objectifs-du-projet)
3. [Architecture & Conception Système](#3-architecture--conception-système)
4. [Composants & Stack Technologique](#4-composants--stack-technologique)
5. [Défis Techniques & Solutions Implémentées](#5-défis-techniques--solutions-implémentées)
6. [Sécurité, Isolation & Résilience](#6-sécurité-isolation--résilience)
7. [Installation Plug & Play & Automatisation](#7-installation-plug--play--automatisation)
8. [Fonctionnalités Clés du Tableau de Bord](#8-fonctionnalités-clés-du-tableau-de-bord)
9. [Compétences BTS SIO / Professionnelles Démontrées](#9-compétences-bts-sio--professionnelles-démontrées)

---

## 1. Introduction & Contexte

En Formule 1 moderne, la télémétrie et l'analyse de données en temps réel représentent le cœur de la performance sportive et stratégique. Chaque monoplace est équipée de centaines de capteurs générant des dizaines de milliers de points de données par seconde (vitesse, régime moteur, delta chronométrique, dégradation des pneumatiques, forces G, statut DRS).

Cependant, pour les passionnés, développeurs, créateurs de contenu et ingénieurs en herbe, l'accès à ces données pose plusieurs difficultés majeures :
- Les flux officiels sont chiffrés/compressés (Zlib/Deflate) et transitent via des protocoles temps réel propriétaires (**SignalR Core**).
- Les APIs communautaires ouvertes (OpenF1, Ergast/Jolpica) imposent des limites de requêtes sévères (**HTTP 429 Too Many Requests**).
- Les solutions existantes sont souvent lentes, gourmandes en ressources ou complexes à installer.

Le projet **F1 Telemetry & Analytics Hub** a été conçu pour résoudre l'ensemble de ces problématiques en proposant une infrastructure complète, autonome, conteneurisée et prête à l'emploi.

---

## 2. Objectifs du Projet

- **Ingestion Temps Réel Haute Fréquence** : Capter et désérialiser les trames télémétriques officielles du Live Timing F1 à la volée.
- **Résilience & Protection Anti-Rate-Limit** : Mettre en place une couche proxy intermédiaire intelligente dotée d'un disjoncteur (circuit breaker) et de caches multi-niveaux (RAM + Disque).
- **Persistance Chronologique** : Stocker l'historique et les séries temporelles dans une base de données dédiée (**InfluxDB v2**) avec politique de rétention automatique.
- **Diffusion Asynchrone Ultra-Rapide** : Diffuser l'état global de la course aux clients web connectés via un flux **WebSocket** cadencé à 2 Hz.
- **Interface Utilisateur Moderne & Modulaire** : Offrir une SPA en pur JavaScript / CSS3 sans framework lourd (temps de chargement instantané, mode sombre soigné, animations glassmorphism).
- **Moteur de Simulation & Rejoueur Intégré** : Permettre une utilisation complète hors grand prix grâce à un moteur physique de simulation de course et de gestion des arrêts aux stands.
- **Overlays pour le Streaming (OBS / Twitch / YouTube)** : Fournir des widgets transparents de télémétrie et de duel pilote intégrables directement dans OBS Studio.
- **Expérience Plug & Play Zéro-Configuration** : Fournir un installateur universel en ligne de commande (`setup.py`, `setup.sh`, `setup.ps1`) automatisant la génération de secrets cryptographiques et le démarrage Docker.

---

## 3. Architecture & Conception Système

L'infrastructure s'articule autour d'un modèle en micro-services orchestré avec **Docker Compose** et segmenté en réseaux étanches :

```
                                  ┌───────────────────────────┐
                                  │   Fournisseurs Externes   │
                                  │  • F1 SignalR Core (WSS)  │
                                  │  • OpenF1 API (REST)      │
                                  │  • Jolpica Ergast (REST)  │
                                  └─────────────┬─────────────┘
                                                │
                     ┌──────────────────────────┴──────────────────────────┐
                     ▼                                                     ▼
           [Flux Direct SignalR]                                 [Flux Historique / REST]
        ┌─────────────────────────┐                             ┌─────────────────────────┐
        │   Python Consumer       │                             │   Proxy Node.js (:3001) │
        │   • Auth Bearer JWT     │                             │   • Cache LRU Mémoire   │
        │   • Décompression Zlib  │                             │   • Cache Disque        │
        │   • Normalisation JSON  │                             │   • Disjoncteur Anti-429│
        └────────────┬────────────┘                             └────────────┬────────────┘
                     │                                                       │
                     ▼                                                       ▼
        ┌─────────────────────────┐                             ┌─────────────────────────┐
        │   InfluxDB v2 (:8086)   │◄────────────────────────────┤  Workers Synchronisation│
        │   • Bucket: livetiming  │                             │  • Pneumatiques, Stints │
        │   • Rétention: 7 jours  │                             │  • Classements Mondiaux │
        └────────────┬────────────┘                             └────────────┬────────────┘
                     │                                                       │
                     └──────────────────────────┬────────────────────────────┘
                                                │
                                                ▼
                                  ┌───────────────────────────┐
                                  │    FastAPI Server (:8000) │
                                  │    • Broadcast Loop 2 Hz  │
                                  │    • Agrégation d'État    │
                                  │    • WebSocket Hub /ws    │
                                  └─────────────┬─────────────┘
                                                │
                                                ▼
                                  ┌───────────────────────────┐
                                  │    Nginx Gateway (:80)    │
                                  │    • Reverse Proxy & CSP  │
                                  │    • Serveur Fichiers SPA │
                                  │    • Tunneling WebSocket  │
                                  └─────────────┬─────────────┘
                                                │
                                                ▼
                                  ┌───────────────────────────┐
                                  │    Tableau de Bord Web    │
                                  │    • Timing Tower         │
                                  │    • Carte 2D/3D GPS      │
                                  │    • Synthétiseur Audio   │
                                  │    • Overlays OBS Studio  │
                                  └───────────────────────────┘
```

---

## 4. Composants & Stack Technologique

| Composant | Technologie | Rôle & Particularités |
| :--- | :--- | :--- |
| **Passerelle Web** | Nginx (Alpine Linux) | Point d'entrée unique (port 80/443), headers de sécurité stricts (CSP, XSS, HSTS), routage reverse proxy, compression gzip, distribution des assets statiques. |
| **Serveur Backend** | Python 3.12 / FastAPI / Uvicorn | Gestion du hub WebSocket asynchrone, boucle de calcul et de diffusion (500 ms), endpoints REST pour les états de session. |
| **Ingestion SignalR** | Python / Asyncio / Zlib | Connexion persistante WSS, décompression des flux de télémétrie chiffrés/compressés, filtrage anti-rebond des coordonnées GPS. |
| **Proxy Cache** | Node.js 22 LTS (Zero Dependency) | Développé avec les modules natifs (`http`, `crypto`, `fs`). Gère le cache mémoire (L1) et disque (L2) pour soulager les APIs amont. |
| **Base Séries Temporelles** | InfluxDB v2.7 | Stockage optimisé des métriques chronologiques (vitesse, régime, accélérateur, frein, gaps) avec rétention paramétrable. |
| **Workers de Synchro** | Python Scripts | Récupération planifiée des informations de pneus, arrêts aux stands, météo et classements constructeurs/pilotes. |
| **Interface Client** | HTML5, CSS3, Vanilla JS (ES Modules) | 17 composants modulaires autonomes sans framework (React/Vue non requis), Web Audio API, Canvas 2D / 3D, responsive design. |
| **Installateur CLI** | Python Standard Library | Script d'automatisation cross-platform (`setup.py`) avec gestion complète du cycle de vie des conteneurs. |

---

## 5. Défis Techniques & Solutions Implémentées

### A. Décompression et Normalisation des Flux Temps Réel
- **Problème** : Le flux SignalR de la F1 transmet des messages volumineux encodés en Base64 et compressés avec l'algorithme Zlib/Deflate.
- **Solution** : Écriture d'un décodeur Python sur-mesure (`backend/decoder.py`) réalisant un décodage dynamique avec prise en charge automatique des entêtes Deflate (`wbits = -zlib.MAX_WBITS`), suivi d'une normalisation des coordonnées pour éliminer les anomalies `(0, 0)`.

### B. Résilience et Évitement des Limites d'API (Anti-Rate-Limit)
- **Problème** : Les APIs gratuites comme OpenF1 bloquent les utilisateurs (code HTTP 429) lorsque plusieurs requêtes sont émises simultanément.
- **Solution** : Conception d'un proxy Node.js dédié (`proxy-server/server.js`) intégrant :
  1. **Cache mémoire (L1)** avec TTL dynamique (1 à 5 s pour le live).
  2. **Cache persistant sur disque (L2)** pour les circuits, sessions archivées et calendriers (TTL 24h+).
  3. **Disjoncteur automatique** : En cas de détection d'une réponse 429, le proxy bascule automatiquement en mode secours avec backoff exponentiel et sert le dernier état valide en cache.

### C. Isolation et Sécurité Réseau dans Docker
- **Problème** : Une base de données exposée publiquement représente un risque majeur d'intrusion.
- **Solution** : Définition de 3 sous-réseaux bridge distincts dans `docker-compose.yml` :
  - `net_internal` : Réservé exclusivement à InfluxDB, au consumer et à l'API FastAPI (aucun accès direct depuis l'extérieur).
  - `net_egress` : Permet aux services d'ingestion de joindre les APIs externes sur Internet.
  - `net_frontend` : Relie Nginx, le proxy et l'API pour servir le client.

### D. Synthèse Audio Procédurale sans Fichier Lourd
- **Problème** : Jouer des fichiers audio MP3 pour 20 voitures en continu consomme de la bande passante et manque de dynamisme.
- **Solution** : Développement d'un moteur sonore basé sur la **Web Audio API** (`sound_engine.js`) générant de manière procédurale les bruits de moteur V6 Turbo Hybride (oscillateurs en dent de scie avec modulation FM et filtres passe-bas corrélés au RPM et à la vitesse du véhicule suivi).

---

## 6. Sécurité, Isolation & Résilience

- **Zéro fuite de données d'identification** : Les fichiers de configuration sensibles (`.env`) sont strictement exclus du suivi Git par le `.gitignore`.
- **Génération cryptographique automatique** : L'installateur génère des clés de 26 à 48 caractères via le module `secrets` de Python ou `/dev/urandom`.
- **Protection CORS & WebSocket** : Validation stricte des origines autorisées sur FastAPI et le proxy Node.js.
- **Headers HTTP renforcés** : Nginx applique une politique CSP stricte, bloque l'encapsulation dans des iframes non autorisées (`X-Frame-Options: SAMEORIGIN`) et active la protection MIME.

---

## 7. Installation Plug & Play & Automatisation

Le projet a été conçu pour être déployé en **moins de 60 secondes** sur n'importe quel environnement (Linux, Windows, macOS, serveur distant ou VM Proxmox).

### Lancement Rapide :
```bash
# 1. Cloner le projet
git clone https://github.com/Klemz-696/f1-telemetry.git
cd f1-telemetry

# 2. Lancer l'installateur universel (génère .env + démarre Docker)
python setup.py --quick
# Ou sous Linux/Mac : ./setup.sh
# Ou sous Windows    : .\setup.ps1
```

### Options du Gestionnaire CLI (`setup.py`) :
- `python setup.py` : Menu interactif complet.
- `python setup.py --check` : Diagnostic système (Docker, ports libres 80/443/3001, connectivité Internet).
- `python setup.py --env-only` : Génération sécurisée du fichier `.env`.
- `python setup.py --start` / `--stop` : Démarrage / Arrêt des conteneurs.
- `python setup.py --status` : Tableau de bord de santé des conteneurs.
- `python setup.py --logs` : Suivi des logs en temps réel.
- `python setup.py --clean` : Nettoyage du cache proxy.

---

## 8. Fonctionnalités Clés du Tableau de Bord

1. **Tour de Chronométrage (Live Timing Tower)** :
   - Positions, deltas au leader et intervalles relatifs en temps réel.
   - Types de gommes (Soft, Medium, Hard, Intermediate, Wet), âge des pneumatiques et nombre d'arrêts.
   - Statut DRS, meilleurs tours au tour et secteurs violets/verts.
2. **Carte du Circuit Interactive 2D & 3D** :
   - Tracé vectoriel précis avec numérotation des virages et zones DRS.
   - Interpolation fluide de la trajectoire des pilotes par GPS.
   - Carte de chaleur (Heatmap) des vitesses sur le tour.
3. **Moteur de Simulation & Replay** :
   - 5 modes de fonctionnement : *Auto*, *Direct Live*, *Simulation*, *Archive*, *Offline*.
   - Simulation réaliste des batailles en piste, des dépassements et de l'usure des gommes.
4. **Overlays pour le Streaming (OBS Studio / Streamlabs)** :
   - Mode transparent optimisé pour l'incrustation vidéo (Lower-Third, Duel Télémétrie, Mini-Tour).
5. **Calendrier & Classements Officiels 2026** :
   - Prise en compte de la nouvelle grille 2026, des 11 écuries et des 22 pilotes.

---

## 9. Compétences BTS SIO / Professionnelles Démontrées

Ce projet illustre une maîtrise transverse des compétences en **Systèmes, Réseaux et Développement d'Applications** :

- **Administration Système & Virtualisation** : Déploiement multi-conteneurs Docker, orchestration avec Docker Compose, intégration possible sur hyperviseur Proxmox VE / Debian.
- **Réseau & Sécurité** : Segmentation de réseaux virtuels bridge, pare-feu applicatif Nginx, gestion des certificats SSL/TLS avec Certbot, durcissement des en-têtes HTTP et protection anti-bruteforce/rate-limit.
- **Bases de Données Spécialisées** : Modélisation et requêtage de séries temporelles sous InfluxDB v2 avec politique de rétention des données.
- **Développement Back-End Asynchrone** : Programmation non-bloquante avec Python (Asyncio / FastAPI / Uvicorn) et Node.js (architecture événementielle).
- **Développement Front-End Haute Performance** : Architecture logicielle modulaire en JavaScript moderne (sans surcharge de framework), Web Audio API, Canvas HTML5, CSS responsive.
- **DevOps & Automatisation** : Pipeline d'intégration continue GitHub Actions (`ci.yml`), tests unitaires automatisés, scripts d'installation multi-plateformes en Python, Bash et PowerShell.
