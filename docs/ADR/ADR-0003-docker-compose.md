# ADR-0003 — Docker + Compose para desenvolvimento e produção

- **Status:** Adotada
- **Contexto:** O produto precisa rodar de forma reproduzível, incluindo Windows. A stack original foi quebrada e precisou ser reconstruída sob medida.
- **Decisão:** Usar Docker + `docker-compose.yaml` (dev) com cinco serviços: `db`, `api`, `web`, `realtime`, `worker`. Cada serviço tem Dockerfile multi-stage (`node:20-bookworm-slim`), portas expostas (`api` 4000, `realtime` 4001), variáveis de ambiente via `.env.example` e volume `/app/storage` para persistência do modelo.
- **Consequências:** + único comando `docker compose up -d` e ambiente reproduzível; - dependência do Docker no ambiente de desenvolvimento e revisão de permissão de volume (remover `USER app` para não travar o volume de storage).
