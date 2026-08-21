# Dockerfile — F1 Cache Proxy
# Node 22 LTS Alpine : léger, fetch natif intégré
FROM node:22-alpine

LABEL maintainer="F1Dashboard"
LABEL description="Proxy de cache anti-429 pour OpenF1 et Jolpica"

WORKDIR /app

# Copie des fichiers sources (pas de node_modules — zéro dépendance)
COPY package.json server.js ./

# Répertoire de cache persistant (monté en volume dans docker-compose)
RUN mkdir -p /cache && chown node:node /cache

USER node

ENV PROXY_PORT=3001 \
    CACHE_DIR=/cache \
    NODE_ENV=production

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/status | grep -q '"ok":true' || exit 1

CMD ["node", "server.js"]
