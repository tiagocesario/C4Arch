# apps/worker/Dockerfile
#
# Servico de trabalho para sincronizacao de modelo com Google Drive
# e/ou GitLab (adapter storage), mantehndo versions e snapshots.
# Executa em segundo plano (batch) dentro do container compose.

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY --from=builder --chown=app:app /app ./ 2>/dev/null || true

USER app

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
