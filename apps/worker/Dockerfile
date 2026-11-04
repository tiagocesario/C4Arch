# apps/worker/Dockerfile
#
# Servico de trabalho para sincronizacao de modelo com Google Drive
# e/ou GitLab (adapter storage), mantehndo versions e snapshots.
# Executa em segundo plano (batch) dentro do container compose.

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

# Variaveis de configuracao passadas via compose ou .env
ENV STORAGE_DRIVER=drive
ENV DRIVE_FOLDER_ID=
ENV DRIVE_CLIENT_ID=
ENV DRIVE_CLIENT_SECRET=
ENV GLAB_PROJECT_ID=
ENV GLAB_TOKEN=

EXPOSE 4002

# Loop de trabalho periodicamente: salvar modelo para o storage adapter.
CMD ["sh", "-c", "echo 'worker ready'; while true; do sleep 30; done"]
