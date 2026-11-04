# apps/realtime/Dockerfile
#
# Servico WebSocket para sincronizacao em tempo real (Yjs).
# Nao expoe portas no compose.production.yaml; apenas aceita conexoes
# via rede interna (c4arch-network).

FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app

COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./package.json

RUN npm ci --omit=dev || npm install --omit=dev

USER app

ENV WS_PORT=4001

EXPOSE 4001

CMD ["node", "dist/server.js"]
