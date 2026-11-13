# C4Arch — Relatório das Ondas 2 e 3

- **Status:** Ondas 2 e 3 concluídas em 11/11/2026, com validação final em 12/11/2026
- **Base:** `docs/ANALISE-STRUCTURIZR.md` (lacunas 7–17) e `docs/M2-CHECKLIST.md`

## 1. Escopo entregue

Esta rodada fechou as lacunas apontadas nas observações finais das Ondas 2 e 3,
sem alterar o comportamento padrão das flags (todas continuam `off` fora de
produção).

| Área | Entrega |
|---|---|
| Exportação | `exports.controller`, `exporters.ts` e `png.ts`: Structurizr JSON/DSL, C4-PlantUML, Mermaid, SVG, PNG, HTML e draw.io, sem dependências nativas |
| Views e layout | `views.controller`, `views.routes` e `autolayout.ts`: CRUD de views canônicas e autolayout determinístico |
| Importação | `imports.controller` e `structurizr-import.ts`: workspace Structurizr (JSON/DSL) com escopo C4, hierarquia e gravação legada + canônica; `structurizr-templates.ts` oferece padrões prontos (contexto, containers, microserviços, componentes e workspace em branco) para criar modelos no mesmo pipeline |
| Comentários | `comments.controller` e `comments.routes`: comentários gerais ou ancorados em elemento, com autorização por papel |
| Colaboração | presença por view/sala, cursores, undo/redo por snapshots e hidratação inicial fora da pilha de undo |
| Contrato | OpenAPI 3.1 em `/api/openapi.json`, Swagger UI em `/api/docs`, erros com `error`/`code` e `Idempotency-Key` |
| Cliente tipado | `scripts/generate-client.mjs` gera `apps/web/src/services/generated-api.ts` (29 operações) |
| Operação | migrações versionadas em `schema_migrations`, backup/restore, SBOM CycloneDX e auditoria por organização |
| Worker | valida o schema em vez de criá-lo e faz apenas reparos de dados |
| MCP | workspace `apps/mcp` com 12 ferramentas `c4_*` sobre stdio, consumindo a API HTTP |
| Frontend | shell reduzido, features em `components/`, utilitários em `utils/`, dados em `services/` e router por hash |

## 2. Frontend

O `App.tsx` deixou de concentrar todas as telas. A extração preservou os fluxos
existentes e cobre:

- `components/AppHeader.tsx` e `components/LoginScreen.tsx` — cabeçalho e login;
- `components/Canvas.tsx` — seleção, destaque e cursor remoto;
- `components/VersionsPanel.tsx` — histórico e restore de versões;
- `components/InspectionsPanel.tsx` — relatório de saúde da arquitetura;
- `components/ImportModelsPanel.tsx` — importação em lote por arquivo, pasta,
  Drive ou URL;
- `components/DasEditor.tsx` — edição do DAS por seções, preview e PDF;
- `components/CommentsPanel.tsx`, `ExportPanel.tsx`, `PresenceBar.tsx` e
  `StructurizrImportPanel.tsx` — colaboração, exportação, presença e importação
  Structurizr (com seleção de padrões ao criar um modelo novo);
- `utils/` — Markdown, DAS, texto e rótulos C4;
- `router.ts` — deep links (`#/catalog`, `#/models/:id`).

O shell mantém a restauração de tela no F5 e a persistência de sessão.

## 3. Correções relevantes

- **Contador de versões** (`apps/api/src/c4/versions.ts`): `nextVersion` semeia e
  alinha `model_version_counters` com `MAX(version)` de `model_versions`,
  evitando violação do índice único `(model_id, version)` após importações,
  fixtures ou migrações antigas.
- **Deep link** (`apps/web/src/App.tsx`): o efeito de persistência de tela
  sobrescrevia o hash inicial (`#/catalog`, `#/models/:id`) antes de a rota ser
  aplicada. Um `pendingHashRef` bloqueia a sobrescrita até a rota ser consumida.
- **Importação canônica** (`ModelController.importModel`): grava `c4Scope` e
  `parentId`, mantendo paridade entre tabelas legadas e canônicas.
- **DAS**: fallback canônico/legado, overrides `append` + `hide` e merge de
  overrides ao salvar novamente.

## 4. Validação executada

Ambiente: Node.js, Postgres 16 descartável em Docker (`c4arch-test-db`,
`127.0.0.1:55432`), removido ao final.

| Suíte | Resultado |
|---|---|
| `npm run typecheck` (api, web, realtime, worker, mcp) | OK |
| `npm test` (api) | 113/113 |
| `npm test` (web, Node test runner + Testing Library/jsdom) | 23/23 |
| `npm test` (realtime) | 6/6 |
| `npm run test:e2e --workspace=apps/web` (Playwright/Chromium) | 3/3 |
| `test:schema` (Postgres descartável) | 1/1 |
| `test:m2` (backfill e sombra) | 30/30 |
| `test:m3` (estado, DAS, restore) | 13/13 |
| `npm run build` (todos os workspaces) | OK |

Os testes de componente cobrem header/login, versões, inspeções, importação,
editor do DAS e presença. O E2E cobre login, sessão e deep link com a API
mockada via `page.route`.

## 5. Operação

```bash
# Migrações versionadas
npm run db:migrate

# Contrato e cliente tipado
npm run openapi:client

# Backup/restore e SBOM
npm run backup
npm run restore -- backups/<arquivo>
npm run sbom

# Testes de integração (Postgres descartável)
docker run -d --rm --name c4arch-test-db \
  -e POSTGRES_USER=c4arch -e POSTGRES_PASSWORD=c4arch \
  -e POSTGRES_DB=c4arch_test -p 55432:5432 postgres:16-alpine
# exporte DB_* e RUN_*_TESTS=true, então:
npm run test:schema --workspace=@c4arch/api
npm run test:m2 --workspace=@c4arch/api
npm run test:m3 --workspace=@c4arch/api
```

## 6. Arquivos-chave

- API: `apps/api/src/c4/{exporters,png,autolayout,structurizr-import,versions}.ts`,
  `apps/api/src/controllers/{exports,imports,views,comments}.controller.ts`,
  `apps/api/src/openapi.ts`, `apps/api/src/db/migrate.ts`.
- Web: `apps/web/src/App.tsx`, `apps/web/src/components/`, `apps/web/src/utils/`,
  `apps/web/src/router.ts`, `apps/web/test/`, `apps/web/e2e/`.
- MCP: `apps/mcp/src/index.ts`.
- Scripts: `scripts/{backup,restore,sbom,generate-client}.mjs`,
  `scripts/print-openapi.ts`.
