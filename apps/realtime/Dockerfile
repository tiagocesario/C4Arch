# apps/realtime/Dockerfile
#
# Servico WebSocket para sincronizacao em tempo real (Yjs).

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

ENV WS_PORT=4001

EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const p=process.env.WS_PORT||4001;const s=require('net').connect(p,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),3000)"

CMD ["node", "dist/index.js"]
