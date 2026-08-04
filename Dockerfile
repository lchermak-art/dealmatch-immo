# DealMatch Immo — backend + frontend statique, image unique.
# Multi-stage pour ne garder dans l'image finale que les dépendances de prod.

FROM node:24-slim AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev

FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./
COPY frontend/ /frontend/

# Le jeu de données et le modèle entraîné doivent être présents dans
# backend/data/ (mutations.json, model.json) — soit copiés dans l'image
# (ligne ci-dessous, adaptée si /data n'existe pas encore au build),
# soit montés en volume, soit régénérés au démarrage via un job d'ingestion
# séparé (recommandé en prod pour ne pas dépendre d'APIs externes au build).
# COPY backend/data ./data

EXPOSE 4000

# --use-system-ca : nécessaire uniquement derrière un proxy d'entreprise qui
# fait de l'inspection TLS (ex. Zscaler) avec un certificat racine interne.
# Sur un hébergeur cloud standard (AWS/Azure) sans proxy sortant, ce flag est
# inoffensif — Node retombe simplement sur le magasin CA du conteneur.
CMD ["node", "--use-system-ca", "src/server.js"]
