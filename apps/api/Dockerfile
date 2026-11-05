# syntax=docker/dockerfile:1

# ── Stage 1: build ──────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# O lockfile é obrigatório: npm ci garante builds reproduzíveis.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ── Stage 2: runtime ────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/package-lock.json ./package-lock.json

# Apenas dependências de produção, sem scripts de instalação.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.PORT||4000;fetch('http://127.0.0.1:'+p+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
