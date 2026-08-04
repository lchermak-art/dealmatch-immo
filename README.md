# DealMatch Immo — MVP

Outil d'aide à la décision pour investisseurs locatifs : estimation de prix,
détection de biens sous-évalués et calcul de rentabilité, sur données 100%
publiques (DVF+, DPE). **Aucune intermédiation immobilière** — voir la note
réglementaire en bas de ce fichier.

Ville pilote : **Toulouse** (code INSEE 31555).

## Ce que fait le MVP

- **Estimation de prix** (`/api/estimate`) : à partir d'une adresse et d'une
  surface, retourne un prix estimé + fourchette, via un modèle de régression
  entraîné sur ~4 200 ventes réelles d'appartements toulousains.
- **Détection d'opportunités** (`/api/opportunities`) : liste les
  transactions passées dont le prix était significativement inférieur à
  l'estimation du modèle — démonstration du principe (le produit final
  comparerait aux annonces en cours, pas à l'historique).
- **Rentabilité locative** (`/api/rentability`) : rentabilité brute/nette à
  partir d'un prix d'achat et d'un loyer.

## Précision du modèle — résultat honnête

Le pipeline suit la logique du guide business (paliers de précision en
enrichissant progressivement les données), mais avec des résultats **plus
élevés que les benchmarks cités (14% → 11% → 9% MAPE)** :

| Modèle | Features | MAPE mesuré |
|---|---|---|
| A — DVF brut | surface + tendance temporelle | **29,6%** |
| B — + DPE | + étiquette énergétique + période de construction | **27,9%** |
| C — + localisation | + distance au centre + 35 clusters géographiques | **20,3%** |

**Pourquoi l'écart avec 9-11% ?** Deux causes identifiées et documentées
pendant la construction :
1. Le DVF ne contient ni l'étage, ni l'état du bien, ni l'exposition — une
   analyse de variance intra-cellule géographique (~1km²) montre un
   coefficient de variation résiduel de 25-30% même sur un périmètre très
   fin, ce qui est un plancher de bruit structurel du DVF seul.
2. Les études atteignant 9% travaillent probablement avec des données de
   quartier plus riches (IRIS INSEE, prix au m² de rue, DVF+ historique sur
   10+ ans) que ce que ce MVP mobilise en quelques heures de développement.

**Pistes concrètes pour se rapprocher de 9-11% dans une V2** : enrichir avec
les données IRIS (revenu médian, catégories socio-pro par quartier — Insee,
gratuit), utiliser un modèle non-linéaire (gradient boosting plutôt que
régression log-linéaire), et exploiter plusieurs années d'historique pour
lisser les variations conjoncturelles.

## Architecture

```
dealmatch-immo/
├── backend/
│   ├── src/
│   │   ├── config.js              # config centralisée (variables d'env)
│   │   ├── server.js              # serveur Express (API + sert le frontend statique)
│   │   ├── lib/
│   │   │   ├── httpClient.js      # fetch avec retry (API DVF+ préprod instable)
│   │   │   ├── linearAlgebra.js   # régression OLS sans dépendance externe
│   │   │   └── kmeans.js          # clustering géographique simple
│   │   ├── services/
│   │   │   ├── dvfClient.js       # client API DVF+ (Cerema)
│   │   │   ├── dpeClient.js       # client API DPE (ADEME)
│   │   │   ├── banClient.js       # client API Adresse (géocodage)
│   │   │   └── scoringService.js  # estimation, opportunités, rentabilité
│   │   ├── routes/api.js          # endpoints REST
│   │   └── scripts/
│   │       ├── ingest.js          # récupère et nettoie DVF+/DPE
│   │       └── train.js           # entraîne le modèle, écrit data/model.json
│   ├── data/                      # généré par ingest.js / train.js (non versionné)
│   └── package.json
├── frontend/                      # HTML/CSS/JS vanilla, aucun framework/build step
│   ├── index.html
│   └── app.js
├── Dockerfile
├── docker-compose.yml
└── README.md (ce fichier)
```

**Choix technique : Node.js + JS vanilla, sans framework front, sans base de
données.** Le jeu de données tient dans un fichier JSON (~4-5 Mo une fois
nettoyé) largement suffisant pour un MVP mono-ville. Cela évite toute
dépendance native (pas de compilation SQLite/PostgreSQL driver nécessaire) et
rend le projet trivialement portable : un seul `Dockerfile`, aucune
dépendance à un service géré propriétaire (pas de Lambda, pas de RDS, pas de
Firestore) — donc transférable tel quel entre hébergeurs.

## Lancer en local

Prérequis : Node.js 20+ (Node ≥ 23.8 recommandé si vous êtes derrière un
proxy d'entreprise avec inspection TLS — voir la note plus bas).

```bash
cd backend
npm install
cp .env.example .env          # ajuster si besoin (ville, ports)
npm run ingest                # récupère les données DVF+/DPE réelles (~5-10 min)
npm run train                 # entraîne le modèle (quelques secondes)
npm start                     # démarre le serveur sur http://localhost:4000
```

Le frontend est servi automatiquement par le backend sur la même origine
(`http://localhost:4000/`) — pas de serveur front séparé à lancer.

**Note réseau d'entreprise (proxy avec inspection TLS, ex. Zscaler) :** si
`npm run ingest` ou le géocodage échouent avec une erreur `unable to get
local issuer certificate`, c'est que Node.js n'utilise pas le magasin de
certificats système par défaut. Les scripts `npm run ingest` et `npm start`
incluent déjà le flag `--use-system-ca`, qui résout ce cas sans rien à
configurer de plus — **ce flag nécessite Node.js ≥ 23.8** (macOS/Windows dès
23.8, Linux peu après ; disponible sur les lignes 22.x et 24.x via backport).
Avec une version de Node plus ancienne, soit mettre à jour Node, soit fournir
le certificat racine de l'entreprise via `NODE_EXTRA_CA_CERTS=/chemin/vers/le/certificat.pem`.
Sur un poste/serveur sans proxy d'inspection TLS, ce flag est sans effet.

## Déploiement

Le backend est une application Node/Express standard, sans service cloud
propriétaire imposé — elle se déploie à l'identique sur AWS, Azure, ou tout
hébergeur supportant Docker.

### Option A — via le Dockerfile fourni

```bash
docker build -t dealmatch-immo .
docker run -p 4000:4000 -v $(pwd)/backend/data:/app/data dealmatch-immo
```

> **Non testé sur cette machine** (Docker non installé dans cet
> environnement de développement) — le Dockerfile suit un pattern standard
> Node/Express multi-stage, mais valider le premier build avant mise en
> production.

Le conteneur ne contient pas les données par défaut (`backend/data/`) — deux
options :
- monter `backend/data/` en volume (comme dans `docker-compose.yml`), en
  ayant lancé `npm run ingest && npm run train` en amont sur la machine hôte
  ou dans un job CI dédié ;
- ou décommenter `COPY backend/data ./data` dans le `Dockerfile` pour figer
  les données dans l'image (plus simple, mais l'image devient à reconstruire
  à chaque rafraîchissement de données).

### Option B — AWS

- **App Runner** (le plus simple) : pointer directement sur le Dockerfile
  dans un repo Git, ou pousser l'image vers **ECR** puis créer un service App
  Runner dessus. Pas de configuration réseau à gérer.
- **ECS Fargate** : pousser l'image vers ECR, définir une task definition
  (1 conteneur, port 4000), exposer via un Application Load Balancer. Utile
  si le produit grandit (plusieurs services, autoscaling fin).
- Dans les deux cas, les données (`backend/data/`) doivent être régénérées
  au démarrage (ingestion dans l'entrypoint) ou stockées sur **EFS**/**S3**
  (téléchargées au démarrage du conteneur) plutôt que montées en volume local.

### Option C — Azure

- **Azure Container Apps** (équivalent d'App Runner) : déploiement direct
  depuis une image dans **Azure Container Registry**, scaling automatique
  inclus.
- **Azure App Service (conteneurs Linux)** : alternative si l'équipe est déjà
  outillée autour d'App Service.
- Stockage des données : **Azure Files** monté dans le conteneur, ou
  téléchargement depuis **Blob Storage** au démarrage.

### Variables d'environnement à définir en production

Voir `backend/.env.example` — aucune clé API n'est requise (toutes les
sources de données sont en open data sans authentification). Seul `PORT`
doit généralement être adapté à la convention de la plateforme cible (AWS App
Runner et Azure Container Apps injectent souvent leur propre `PORT`).

## Avertissement réglementaire (loi Hoguet)

Ce produit **ne réalise et ne doit jamais réaliser** d'intermédiation
immobilière : pas de mise en relation acheteur/vendeur pour le compte d'un
tiers, pas de négociation, pas de commission assise sur une transaction. Le
modèle économique prévu est un abonnement à un outil d'aide à la décision
(scoring, alertes, calcul de rentabilité) — l'utilisateur négocie et signe
seul ou via son propre professionnel. Toute évolution du produit vers une
commission liée à une transaction réalisée doit être requalifiée
juridiquement (carte professionnelle CCI mention T, garantie financière,
assurance RC Pro) avant d'être développée.
