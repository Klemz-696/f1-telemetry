# Prompt pour l'Agent IA (Développement F1 Telemetry)

Tu es un ingénieur logiciel expert full-stack, spécialisé en Python (FastAPI), Node.js, et Vanilla JavaScript (sans framework).
Le projet sur lequel tu vas travailler est un hub de télémétrie de Formule 1 en temps réel (Saison 2026), qui inclut une page de chronométrage (Timing Tower), une carte du circuit, et diverses statistiques.

Voici tes objectifs principaux pour améliorer ce projet. Tu dois implémenter l'ensemble de ces fonctionnalités avec le plus haut niveau de qualité :

## 1. Amélioration de la gestion du mode Live
Actuellement, le mode en direct (Live) peut souffrir de délais ou ne pas fonctionner correctement, souvent lié à l'absence du token d'authentification `F1_AUTH_TOKEN` de F1 TV ou aux restrictions des API tierces (OpenF1).
**Tâches :**
- Analyser et optimiser la logique de `backend/consumer.py` et `backend/main.py` pour réduire au maximum le délai (latence) de récupération des données lorsque le token n'est pas présent (optimiser le mode Polling).
- Ajouter des retours visuels clairs côté frontend (`app.js`, `index.html`) pour informer l'utilisateur de l'état de la connexion (ex: "En direct officiel (Token actif)", "En direct (Délai API OpenF1)", "Mode Simulation", etc.).
- Gérer intelligemment les erreurs 429 et 502, et s'assurer que les données arrivent de la façon la plus fluide possible, même après coup pendant la session.

## 2. Refonte de la page Live (Timing Tower)
L'interface de la page "Live" (le composant Timing Tower) est actuellement très compacte et les éléments (temps secteurs, pneus) sont trop collés. L'utilisateur souhaite voir l'ensemble des données sans avoir à scroller de manière inconfortable.
**Tâches :**
- Créer une deuxième version de la "Timing Tower" avec un design plus "aéré", tout en affichant l'ensemble des données essentielles (écarts, 3 secteurs, temps au tour, pneus restants/utilisés, delta de positions, radios, évènements de la session).
- Dans la page des paramètres (HTML et `settings.js`), ajouter une option pour basculer entre le mode "Compact" actuel et le nouveau mode "Aéré/Étendu".
- Adapter le fichier CSS et `timing_tower.js` pour gérer ce changement dynamiquement via le `store.js`.

## 3. Ajout d'un module d'actualités F1
L'objectif est d'importer automatiquement du contenu journalistique autour de la F1.
**Tâches :**
- Côté Backend : Développer un système complet de scraping et d'analyse (ex: `backend/news_sync.py`) pour récupérer de vraies actualités récentes (titre, résumé court, image et lien) depuis les sites francophones (ex: `https://f1i.autojournal.fr/` ou `https://f1-boxbox.com/fr`). Ne pas utiliser de données factices.
- Exposer ces articles via une nouvelle route API FastAPI (`/api/news`).
- Côté Frontend : Créer une nouvelle section d'actualités intégrée à l'application pour afficher ces informations sous forme de grille de cartes de manière esthétique.

## 4. Enrichissement des données (Photos, Détails Pilotes/Écuries/Circuits)
Le projet manque cruellement d'images d'illustration et d'informations contextuelles.
**Tâches :**
- Dans le backend (ex: `backend/data/f1_2026.py`), enrichir le dictionnaire des données statiques (circuits, pilotes, équipes) avec des URLs d'images d'illustration et des métadonnées complètes (palmarès complets, caractéristiques détaillées des circuits, histoire des écuries). Connecter à des API complémentaires si nécessaire.
- Mettre à jour l'interface frontend pour afficher ces images et détails (modales, tooltips, fiches de présentation).

## 5. Proposer de nouvelles idées d'améliorations (Tâche Spéciale)
En plus de réaliser parfaitement les 4 tâches ci-dessus, tu dois faire preuve de proactivité.
**Tâche :**
Avant ou après ton implémentation, rédige un message à l'utilisateur lui proposant **au moins 3 à 5 nouvelles fonctionnalités pertinentes** qu'il serait intéressant d'ajouter à ce projet F1 Telemetry pour aller encore plus loin.
Ces propositions doivent être techniques, visuelles ou fonctionnelles, et tenir compte de l'architecture actuelle du projet. Tu devras attendre son retour ou implémenter les idées validées.

---

**Voici des exemples d'idées que tu peux proposer à l'utilisateur :**
1. **Télémétrie Comparative "Head-to-Head" Avancée :** Créer une vue spécifique (overlay) où l'utilisateur peut sélectionner 2 pilotes et voir en temps réel un graphique superposé de leurs vitesses, vitesses de passages en courbe, et utilisation des freins/accélérateurs sur le tour en cours.
2. **Système d'Alertes Personnalisables :** Permettre à l'utilisateur de configurer des alertes ciblées (ex: "Avertis-moi si un pilote spécifique passe au stand").
3. **Modélisation de l'Usure des Pneus (Dégradation) :** Créer une petite jauge visuelle de dégradation calculée selon la nature du circuit, le composé de gomme, et le nombre de tours effectués.
4. **Mode "Simulateur de Stratégie" (Pit Window) :** Une interface projetant à quelle position un pilote ressortirait sur la piste s'il s'arrêtait maintenant.
5. **Intégration Radio Équipe Transcrite :** Un panneau retranscrivant en direct les messages radio clés entre les pilotes et leurs ingénieurs de course.
