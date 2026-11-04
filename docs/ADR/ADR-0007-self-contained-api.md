# ADR-0007 — API autossuficiente (`apps/api`)

- **Status:** Adotada
- **Contexto:** O repositório original possuía `apps/api` incompleto (node_modules faltando), o que impedia a build do Docker. O `package.json` raiz usava npm workspaces que instalavam as dependências no lugar errado.
- **Decisão:** Fazer `apps/api` uma extensão self-contained (Express + TypeScript, PG, JWT, cors, ws, yjs). Substituir workspaces por `npm install --no-workspaces` dentro de `apps/web` e `apps/api`. Dockerfiles multi-stage, não-root `app` (temporariamente removido para não travar volumes de storage).
- **Consequências:** + build do Docker a partir de contexto limpo; - adição de testes de integração anteriormente ausentes. Stack: `db`, `api`, `realtime`, `web`, `worker` rodando com `docker compose up -d`.
