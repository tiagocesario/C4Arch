# apps/worker/Dockerfile
#
# Servico de trabalho para sincronizacao de modelo com Google Drive
# e/ou GitLab (adapter storage), mantendo versions e snapshots.

FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/package-lock.json ./package-lock.json

RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

USER node

# Variaveis de configuracao passadas via compose ou .env
ENV STORAGE_DRIVER=drive
ENV DRIVE_FOLDER_ID=
ENV DRIVE_CLIENT_ID=
ENV DRIVE_CLIENT_SECRET=
ENV GLAB_PROJECT_ID=
ENV GLAB_TOKEN=

EXPOSE 4002

CMD ["node", "dist/index.js"]
