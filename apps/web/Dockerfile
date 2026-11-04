# apps/web/Dockerfile
#
# Multi-stage build para o frontend React (C4Arch).
#
# Construir:
#   docker build -f apps/web/Dockerfile -t c4arch-web:latest .
#
# Em producao, use o compose.production.yaml que mapeia a porta 80.

# ── Stage 1: build ──────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .
RUN npm run build

# ── Stage 2: runtime ────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# A imagem node já possui usuário 'node', não precisa criar
RUN npm i -g serve@14

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json

RUN npm ci --omit=dev || npm install --omit=dev

USER node

EXPOSE 3000

# Serve a pasta dist na porta 3000.
CMD ["serve", "-s", "dist", "-l", "3000"]
