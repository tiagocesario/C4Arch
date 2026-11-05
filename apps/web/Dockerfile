# apps/web/Dockerfile
#
# Multi-stage build para o frontend React (C4Arch).

# ── Stage 1: build ──────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

ARG VITE_WS_URL=ws://localhost:4001
ARG VITE_API_URL=http://localhost:4000
ENV VITE_WS_URL=${VITE_WS_URL}
ENV VITE_API_URL=${VITE_API_URL}

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ── Stage 2: runtime ────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# O servidor estático usa apenas módulos nativos do Node. Não instala
# dependências em runtime: menor superfície de ataque e imagem menor.
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server.mjs ./server.mjs

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
