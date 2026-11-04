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
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .
RUN npm run build

# ── Stage 2: runtime ────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Servidor estatico (lightweight) para servir o build.
# Substitua pelo servidor que preferir (nginx, caddy, etc.).
RUN npm i -g serve@14

COPY --from=builder --chown=node:node /app/build ./build

USER node

EXPOSE 3000

# Serve a pasta build na porta 3000.
CMD ["serve", "-s", "build", "-l", "3000"]
