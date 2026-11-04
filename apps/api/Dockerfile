# syntax=docker/dockerfile:1

# ── Stage 1: build ──────────────────────────────────────────────
# Compila a aplicação. Inclui dependências de build (tsc, webpack, etc.).
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Copia apenas os manifes para aproveitar o cache de build
COPY package.json package-lock.json* ./

# Instala TODAS as dependências (inclui devDependencies para build)
RUN npm ci || npm install

# Copia o restante e constroi
COPY . .
RUN npm run build

# ── Stage 2: runtime ────────────────────────────────────────────
# Imagem mínima para executar a aplicação (sem ferramentas de build).
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# A imagem node já possui usuário 'node', não precisa criar
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Instala apenas dependências de produção
RUN npm ci --omit=dev || npm install --omit=dev

USER node

EXPOSE 4000

# CMD em exec form. Evita um shell intermediário.
CMD ["node", "dist/index.js"]
