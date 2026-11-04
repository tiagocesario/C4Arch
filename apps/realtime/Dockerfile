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

# A imagem node já possui usuário 'node', não precisa criar
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json

RUN npm ci --omit=dev || npm install --omit=dev

USER node

ENV WS_PORT=4001

EXPOSE 4001

CMD ["node", "dist/index.js"]
