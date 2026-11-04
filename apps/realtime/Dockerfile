# apps/realtime/Dockerfile
#
# Servico WebSocket para sincronizacao em tempo real (Yjs).
# Nao expoe portas no compose.production.yaml; apenas aceita conexoes
# via rede interna (c4arch-network).

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY --from=builder --chown=app:app /app ./ 2>/dev/null || true

# Se o scope do repositorio usar build output, copie depois:
# COPY --from=builder --chown=app:app /app/dist ./dist

USER app

ENV WS_PORT=4001

EXPOSE 4001

CMD ["node", "dist/server.js"]
