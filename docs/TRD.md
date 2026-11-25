# C4Arch — Technical Requirements Document (TRD)

- **Versão:** 1.1.0
- **Data:** 17/11/2026
- **Status:** Vigente — documento técnico complementar ao `docs/PRD.md`
- **Licença:** MIT
- **Público-alvo:** engenharia, SRE/plataforma, segurança e arquitetura de soluções

> Este documento descreve **como** o C4Arch deve ser construído e operado. O
> **o quê** e o **por quê** ficam no `docs/PRD.md`; aqui estão a rastreabilidade
> técnica dos requisitos funcionais (IDs `RF-xx` definidos no PRD), os requisitos
> técnicos e não funcionais (`TR-xx`), os contratos de interface, o modelo de
> dados e as obrigações de qualidade, segurança e operação. Decisões de
> arquitetura continuam registradas em `docs/ADR/` e não são duplicadas aqui.

---

## 1. Escopo e objetivos técnicos

O C4Arch é uma aplicação web colaborativa para manter **um modelo C4 único e
vivo** (pessoas, sistemas, containers, componentes e relacionamentos),
persistido em PostgreSQL e editado em tempo real por uma equipe pequena.

Objetivos técnicos, em ordem de prioridade:

1. **Integridade do modelo:** nenhuma edição concorrente pode apagar campos ou
   duplicar elementos/relacionamentos.
2. **Fonte única de verdade:** o modelo canônico em PostgreSQL é a origem; DAS,
   PlantUML, draw.io, views e exports são **projeções** dele.
3. **Durabilidade:** toda alteração aceita deve sobreviver a restart, refresh e
   reconexão.
4. **Segurança por padrão:** autenticação obrigatória, autorização por
   organização e por modelo, containers endurecidos, anti-SSRF e anti-XSS.
5. **Portabilidade:** execução local, Docker Compose e Kubernetes (Helm) com as
   mesmas variáveis de ambiente e o mesmo contrato OpenAPI.
6. **Interoperabilidade:** draw.io, C4-PlantUML, Mermaid, SVG, PNG e HTML sem
   lock-in de fornecedor.

**Fora de escopo técnico nesta versão:** edição offline, aplicativo móvel,
multi-região ativo-ativo, sincronização bidirecional com Google Drive/GitLab e
escala horizontal do serviço realtime.

---

## 2. Contexto e visão de arquitetura

```text
                        ┌──────────────────────────────┐
  Navegador  ──HTTP──▶  │  web (React 18 + Vite 6)     │
  (react-flow)          └──────────────┬───────────────┘
                          REST /api    │    WS /ws
                                       ▼
                    ┌───────────────────────────────┐
                    │ api (Express 4 + JWT)         │──▶ PostgreSQL 16
                    │ OpenAPI 3.1 · DAS · exports   │
                    └───────┬───────────────┬───────┘
                            │ internal API  │ HTTP
                            ▼               ▼
             ┌────────────────────┐   ┌──────────────────┐
             │ realtime (ws+Yjs)  │   │ plantuml (Jetty) │
             │ snapshots 1 MiB    │   │ render SVG       │
             └─────────┬──────────┘   └──────────────────┘
                       │ opcional (flag)
                       ▼
                 model_state (BYTEA)

  worker ──▶ PostgreSQL (versões por hash, retenção) e storage
  mcp    ──▶ API HTTP (JSON-RPC por stdio; nunca acessa o banco direto)
```

### 2.1 Containers e responsabilidades

| Container | Stack | Responsabilidade técnica | Porta |
|---|---|---|---|
| `web` | React 18, `@xyflow/react` 12, Vite 6, Tailwind 3 | SPA; editor C4, árvore de arquivos, painéis, preview e geração de cliente tipado | 3000 |
| `api` | Node 20, TypeScript, Express 4, `pg` | REST, autenticação/autorização, modelo canônico, DAS, exports, importação, draw.io, OpenAPI, auditoria, métricas | 4000 |
| `realtime` | Node 20, `ws`, Yjs 13 | Sincronização CRDT por modelo, presença, undo/redo, snapshots JSON e persistência opcional em `model_state` | 4001 |
| `worker` | Node 20, `pg` | Versionamento por hash de conteúdo, retenção de versões automáticas, backfill e reconciliação canônica; *scaffolding* de sincronização externa | 4002 (Helm) |
| `mcp` | Node 20, stdio/JSON-RPC 2.0 | Exposição do modelo a agentes; delega à API HTTP | — |
| `plantuml` | `plantuml/plantuml-server:jetty` | Renderização server-side de SVG | 8080 |
| `db` | PostgreSQL 16 | Persistência relacional, migrações e auditoria | 5432 |

### 2.2 Fonte de verdade e projeções

| Artefato | Natureza | Regra |
|---|---|---|
| `model_elements`, `model_relationships`, `model_views` | Canônico | Fonte de verdade do modelo C4 |
| `models.drawio_xml`, `models.diagrams` | Legado/compatibilidade | Espelho de interoperabilidade; não é fonte independente |
| `elements`, `edges` | Legado | Mantidos para modelos antigos e API REST existente |
| `model_state` (Yjs binário) | Estado colaborativo | Persistência do CRDT, habilitada por `REALTIME_PG_STATE` |
| `models.das_content` | Derivado | Regenerado a cada mudança relevante; overrides em `model_das_overrides` |
| Exportações (PlantUML/Mermaid/SVG/PNG/HTML) | Derivado | Sempre calculadas a partir do canônico |
| `model_versions` | Histórico | Snapshot imutável por hash de conteúdo |

> **Regra de ouro:** nenhuma projeção pode ser editada como se fosse o modelo.
> Exceção controlada: `model_das_overrides`, aplicado sobre o DAS gerado.

---

## 3. Stack e restrições de plataforma

- **Runtime:** Node.js `>=20.0.0` (LTS), `npm@10.9.0`, ESM (`"type": "module"`).
- **Banco:** PostgreSQL 16; extensão `pgcrypto`/`gen_random_uuid()` disponível.
- **Monorepo:** npm workspaces — `apps/api`, `apps/web`, `apps/realtime`,
  `apps/worker`, `apps/mcp`.
- **Navegadores-alvo:** últimas duas versões de Chrome, Edge, Firefox e Safari;
  recursos de `Intl` e `crypto.randomUUID()` são obrigatórios.
- **Sistemas operacionais de desenvolvimento:** Windows (nativo ou WSL2), Linux
  e macOS. Produção: Linux x86_64/arm64 em container.
- **Idioma:** interface e documentação em pt-BR; código, identificadores e API
  em inglês.

---

## 4. Requisitos funcionais (rastreabilidade)

Os IDs `RF-xx` são estáveis e definidos no `docs/PRD.md`. Esta seção mantém
apenas a rastreabilidade técnica e o estado de implementação; as regras de
negócio e os critérios de aceite de produto estão no PRD.

| ID | Requisito | Estado | Implementação de referência |
|---|---|---|---|
| RF-01 | Login e sessão persistente | Entregue | `api/src/auth/*`, JWT `7d`, `/api/auth/login`, `/me` |
| RF-02 | Organização e membership | Entregue (básico) | `organizations`, `memberships`, `/api/orgs` |
| RF-03 | CRUD de modelo (título, descrição, status, pasta) | Entregue | `models.controller`, `models.routes` |
| RF-04 | Busca/filtro de modelos e pastas (sem acentos, contexto hierárquico) | Entregue | `web/src/utils/text.ts`, árvore de pastas |
| RF-05 | Editor C4 com nós e conexões | Entregue | `web/src/components/Canvas.tsx` |
| RF-06 | Edição concorrente sem perda de campos | Entregue | `realtime/src/sync.ts` (merge parcial Yjs) |
| RF-07 | draw.io acessível ao criar/editar modelo | Entregue | `/api/models/:id/drawio`, token escopado |
| RF-08 | Importação/exportação draw.io (XML) | Entregue | `drawio.controller`, `c4/model-import` |
| RF-09 | Pastas, aplicações e serviços | Entregue (CRUD) | `folders`, `apps`, `services` |
| RF-10 | Comentários por elemento | Entregue | `comments`, `/api/models/:id/comments` |
| RF-11 | Versionamento e restauração | Entregue | `model_versions`, `/versions/:versionId/restore` |
| RF-12 | Exportação JSON/YAML (model-as-code) | Planejado | — |
| RF-13 | Sincronização Google Drive/GitLab | Fora do MVP | `integrations` (scaffolding) |
| RF-14 | Permissões owner/editor/viewer ponta a ponta | Parcial | `auth/access.ts`, `canonical-access.ts` |
| RF-15 | Modelos tipados por diagrama C4 (`c4_type`/`c4_scope`) | Entregue | `c4/model-types.ts` |
| RF-16 | Apps/serviços reutilizáveis com propagação e dependências | Entregue | `apps.controller`, `c4/model-graph` |
| RF-17 | Biblioteca draw.io `c4arch` | Entregue | `c4/assets.ts`, `/drawio/library` |
| RF-18 | Perfis e grupos de acesso customizados | Entregue | `access_groups`, `/api/groups` |
| RF-19 | Novo tipo de diagrama no mesmo modelo (`models.diagrams` JSONB) | Entregue | `POST /api/models/:id/diagrams` |
| RF-20 | Navegação entre tipos e evolução contexto→container→componente→código | Entregue | `web/src/App.tsx`, abas de preview |
| RF-21 | Persistência/restauração da tela no F5 | Entregue | `localStorage` `c4arch_view` |
| RF-22 | Pastas em árvore, movimento pai/raiz e prevenção de ciclos | Entregue | `folders.controller`, UI |
| RF-23 | Importação em lote (arquivo/pasta/Drive/URL) com detecção de tipo | Entregue | `imports`, `model-import`, `security/url.ts` |
| RF-24 | DAS automático a partir de todos os diagramas, inclusive no startup | Entregue | `c4/das-service.ts`, `c4/das-canonical.ts` |
| RF-25 | C4-PlantUML: importar/exportar, templates, preview SVG e painel de código | Entregue | `c4/plantuml-*`, `plantuml.controller` |
| RF-26 | Inspections de qualidade do modelo | Entregue | `c4/inspections.ts`, `/models/:id/inspections` |
| RF-27 | Views canônicas, layout por view e autolayout | Entregue | `model_views`, `model_view_layout`, `c4/autolayout` |
| RF-28 | Exportação em C4-PlantUML, Mermaid, SVG, PNG, HTML e draw.io | Entregue | `c4/exporters.ts`, `exports.controller` |
| RF-29 | Servidor MCP para agentes | Entregue | `apps/mcp` (JSON-RPC sobre stdio) |
| RF-30 | Login Google e vínculo por domínio de e-mail | Entregue | `auth.routes`, `login_domain_rules` |
| RF-31 | Auditoria por organização | Entregue | `audit_log`, `/api/audit` |
| RF-32 | OpenAPI 3.1, cliente tipado e idempotência opcional | Entregue | `openapi.ts`, `security/idempotency.ts` |
| RF-33 | Migrações, backup/restore, SBOM, Compose e Helm | Entregue | `db/migrate.ts`, `scripts/*`, `charts/c4arch` |

### 4.1 Regras funcionais que impactam a engenharia

- **RF-03/RF-19:** um modelo possui um tipo primário (`c4_type`); tipos extras
  vivem em `models.diagrams` e **não** podem duplicar o primário (HTTP 409).
- **RF-06:** `updateElement` aplica *merge* de campos; posição não sobrescreve
  título, tipo, descrição ou metadados.
- **RF-19/RF-22:** o vínculo legado `parent_id` é mantido apenas por
  compatibilidade; novas hierarquias usam `model_elements.parent_element_id`.
- **RF-24:** o DAS é sempre recalculado em criação, edição, novo diagrama,
  importação draw.io e primeira leitura de modelo sem conteúdo.
- **RF-25:** **Aplicar** no editor PlantUML converte o texto em elementos,
  relações e views do canônico e propaga o snapshot ao documento colaborativo.

---

## 5. Requisitos técnicos e não funcionais (TR)

Cada requisito tem critério verificável. Metas de latência referem-se a
implantação de referência (4 vCPU, 8 GB RAM, PostgreSQL no mesmo host/rede).

### TR-01 — Desempenho interativo

- `GET /api/models/:id` (sem `drawio_xml` no payload) **p95 ≤ 300 ms** e
  **p99 ≤ 800 ms** para modelos com até 500 elementos e 1.000 relações.
- `GET /api/models/:id/das` com DAS em cache **p95 ≤ 400 ms**; regeneração
  completa **≤ 2 s** para o mesmo limite.
- Renderização/arraste no canvas com 4 editores simultâneos deve manter
  **≥ 30 FPS** e latência percebida de patch **≤ 150 ms** em LAN.
- Exportações PlantUML/Mermaid/SVG para 500 elementos **≤ 5 s**.

### TR-02 — Disponibilidade e recuperação

- Disponibilidade alvo do stack: **99,5% mensal** (exclui manutenção
  anunciada).
- `GET /healthz` responde `200` somente com `SELECT 1` bem-sucedido; caso
  contrário `503`.
- **RPO ≤ 15 min** para o modelo canônico e **RTO ≤ 2 h** restaurando dump +
  storage descritos em `docs/SECURITY.md` e `scripts/restore.mjs`.
- Reinício do `realtime` não pode causar perda definitiva: estado é recuperado
  de `model_state` (quando habilitado) ou do snapshot em `storage`.

### TR-03 — Escalabilidade e limites

- Dimensões de referência por organização: **50 modelos**, **2.000 elementos**
  por modelo, **100 itens por lote de importação**.
- Limites rígidos de payload: JSON global **100 kB**; XML draw.io/PlantUML
  **8 MB**; estado interno Yjs **16 MB**; mensagem WebSocket **1 MiB**.
- Rate limits: API **1.200 req/15 min por IP**; login/registro **10 req/15 min
  por IP**; WebSocket **300 mensagens/10 s por conexão**.
- O `realtime` é **stateful e single-instance** nesta versão; escala horizontal
  exige pub/sub e store compartilhado (fora de escopo).

### TR-04 — Consistência e concorrência

- O documento Yjs é a autoridade durante a sessão colaborativa; o merge é
  **parcial e determinístico**.
- Operações suportadas: `createElement`, `updateElement`, `deleteElement`,
  `createEdge`, `updateEdge`, `deleteEdge`, `updateModel`, `hydrateModel`,
  `replaceModel`.
- Exclusão de elemento remove em cascata as arestas associadas.
- Undo/redo por modelo, com pilha limitada a **50 snapshots**.
- Persistência do CRDT usa *debounce* de **2 s** e *flush* periódico de **15 s**.

### TR-05 — Durabilidade e atomicidade

- Snapshots em disco são gravados em arquivo temporário e promovidos por
  `rename` atômico; nunca se escreve diretamente no arquivo final.
- Estado é gravado também quando o último cliente desconecta.
- `model_state` guarda `state`, `state_vector`, `content_hash`, `revision` e
  `updated_by`; a escrita é idempotente por hash.
- Migrações executam em transação por versão, com `SAVEPOINT` por instrução e
  registro em `schema_migrations`.

### TR-06 — Integridade referencial

- Chaves estrangeiras com `ON DELETE CASCADE` para filhos do modelo e
  `SET NULL` para referências opcionais (`folder_id`, `app_id`, `service_id`).
- `model_relationships.source_id <> target_id` (CHECK).
- `UNIQUE (model_id, identifier)` em `model_elements`, `UNIQUE (model_id, key)`
  em `model_views`, `UNIQUE (org_id, name)` em pastas/apps/serviços.
- `UNIQUE (model_id, content_hash)` impede versões duplicadas.
- IDs são UUID v4; caminhos de storage só aceitam UUID validado.

### TR-07 — Autenticação e autorização

- Autenticação por **JWT HS256**, emissor `c4arch`, expiração configurável
  (`JWT_EXPIRES_IN`, padrão `7d`), segredo mínimo de **32 caracteres**.
- Em produção, a API **não inicia** com segredo placeholder, curto ou com seed
  demo usando senha fraca.
- Autorização por organização em todas as rotas de modelo, elemento, aresta,
  pasta, app, serviço, draw.io, DAS, versões, views e comentários (sem IDOR).
- Matriz mínima de papéis:

| Operação | owner | editor | viewer |
|---|---|---|---|
| Ler modelo/DAS/exports | ✓ | ✓ | ✓ |
| Criar/editar/excluir modelo, elemento, aresta, pasta | ✓ | ✓ | ✗ |
| Restaurar versão | ✓ | ✓ | ✗ |
| Administrar membros e grupos | ✓ | ✗ | ✗ |
| Gerenciar domínios de login | ✓ | ✗ | ✗ |

- `viewer` recebe **403** em qualquer mutação, inclusive via WebSocket.
- Papel é revalidado no WebSocket a cada **30 s** (rebaixamento sem reconexão).

### TR-08 — Segurança de entrada e saída

- **SSRF:** importação por URL valida protocolo (`http`/`https`), resolve DNS,
  bloqueia faixas privadas/loopback/link-local, revalida cada redirecionamento e
  limita bytes; links de pasta do Drive são rejeitados.
- **XSS:** todo conteúdo gerado (título, descrição, DAS, XML) é escapado antes
  de ser injetado em HTML/iframe/print.
- **Upload/XML:** parsing defensivo de draw.io; XML acima de 100 kB na
  importação de modelo retorna **413**.
- **CORS:** allowlist explícita (`CORS_ORIGIN`) mais as origens oficiais do
  diagrams.net; requisições sem `Origin` são permitidas para healthchecks.
- **Headers:** Helmet habilitado; `x-powered-by` desabilitado; CSP própria nas
  páginas que incorporam o draw.io.
- **draw.io:** abertura por token escopado de **5 min**, nunca pelo JWT de
  sessão na URL.
- **Corpo inválido:** JSON que não seja objeto retorna **400** antes de chegar
  ao controller.

### TR-09 — Gestão de segredos

- Segredos vêm exclusivamente do ambiente (`.env` local; Secret no Helm).
- `.env` e artefatos de backup nunca são versionados.
- Rotação de `JWT_SECRET` invalida sessões de forma controlada; `API_TOKEN_REALTIME`
  vazio desabilita as rotas internas (*fail closed*).
- Senhas são armazenadas com hash (nunca em texto claro) e comparadas em tempo
  constante quando aplicável.

### TR-10 — Observabilidade

- **Logs:** JSON ou texto estruturado em stdout/stderr, com `requestId`
  (`X-Request-Id`), rota, status, duração e ator quando autenticado.
- **Métricas Prometheus** em `/metrics` (`METRICS_ENABLED`; padrão ligado em
  desenvolvimento e desligado em produção). Expor apenas na rede interna.
- **Healthcheck:** `/healthz` para Docker/Compose/Kubernetes.
- **Auditoria:** toda mutação relevante gera registro em `audit_log`
  (`action`, `entity_type`, `entity_id`, `actor`, `metadata`), consultável em
  `/api/audit` por organização.
- **Erros:** resposta padronizada `{ "error": string, "code": string }`; stack
  traces nunca vão ao cliente.

### TR-11 — Contratos e interoperabilidade

- **OpenAPI 3.1** publicado em `/api/openapi.json`, Swagger UI em `/api/docs`;
  o cliente tipado `apps/web/src/services/generated-api.ts` é gerado por
  `npm run openapi:client` e deve ser regenerado em toda mudança de contrato.
- **Idempotência:** métodos mutantes aceitam `Idempotency-Key`; replay devolve
  a resposta original com `Idempotency-Replayed: true`.
- **Convenções JSON:** `camelCase` na API pública; `snake_case` interno do
  PostgreSQL normalizado na borda.
- **WebSocket:** JSON com `type`, `modelId` e `patch`/`model`; mensagens
  inválidas retornam `{ "type": "error", "error": "<motivo>" }`.
- **draw.io e PlantUML:** aceitam `?type=<c4Type>`; tipos válidos em
  `C4_MODEL_TYPES` (`system-context`, `container`, `component`, `code`,
  `system-landscape`, `dynamic`, `deployment`).

### TR-12 — Portabilidade e deploy

- **Compose de desenvolvimento:** `db`, `api`, `web`, `realtime`, `worker`,
  `plantuml` e job `storage-init`; portas publicadas em `127.0.0.1` por padrão
  (`BIND_ADDR`).
- **Produção:** overlay `compose.production.yaml`; API e realtime não publicam
  portas no host; reverse proxy encaminha `/api`→`api:4000` e `/ws`→`realtime:4001`.
- **Kubernetes:** chart Helm em `charts/c4arch` com Deployments, Service,
  Ingress opcional, ConfigMap, Secret, PostgreSQL e resources configuráveis.
- **Containers:** non-root (`node`), `init: true`, `no-new-privileges`,
  `cap_drop: ALL`, healthchecks, filesystem somente-leitura em produção e
  `npm ci --omit=dev --ignore-scripts`.
- **URLs públicas:** `PUBLIC_API_URL`/`PUBLIC_WS_URL` são injetadas no build do
  frontend e devem usar `https://`/`wss://` em produção.

### TR-13 — Qualidade e testabilidade

- `npm run typecheck` deve passar em todos os workspaces sem `any` implícito.
- `npm run build --workspace=apps/web` executa `tsc --noEmit` antes do Vite;
  erro de tipo quebra o build.
- Cobertura mínima obrigatória por natureza:
  - **unidade:** merge parcial, cascata, validação de UUID, SSRF, parsers
    draw.io/PlantUML, exportadores, DAS, autolayout, PNG, OpenAPI, tokens;
  - **integração:** schema/migrações, backfill canônico, `model_state`,
    overrides de DAS (com PostgreSQL 16 real);
  - **componente:** header/login, versões, inspeções, importação, editor de DAS,
    presença;
  - **E2E:** login, sessão e deep link (Playwright + Chromium, API mockada).
- Testes usam o runner nativo do Node com `tsx`; nenhum teste unitário pode
  depender de rede externa.

### TR-14 — Compatibilidade e migração de dados

- Migrações são **forward-only** e idempotentes (`IF NOT EXISTS`); rollback é
  manual por `scripts/rollback-m{1,2,3}.sql`.
- Dados legados (`elements`, `edges`, `drawio_xml`, `parent_id`) permanecem
  legíveis; backfill e reconciliação são executados por scripts dedicados.
- **Feature flags** (`off|shadow|on`) controlam a transição para o canônico:
  `CANONICAL_MODEL`, `CANONICAL_VIEWS`, `DAS_OVERRIDES`, `VERSION_HASH`,
  `REALTIME_PG_STATE`, `PROJECTOR_SHADOW`. Padrão: `off`.
- `shadow` executa o caminho novo em paralelo sem servir a resposta; `on` o
  promove a fonte. Toda promoção exige reconciliação prévia sem divergências.

### TR-15 — Manutenibilidade

- Uma única fonte de tipos de domínio no frontend
  (`apps/web/src/services/types.ts`).
- Módulos de domínio em `apps/api/src/c4/` não acessam `req`/`res`; controllers
  fazem apenas validação, autorização e tradução HTTP.
- Código morto e dependências não utilizadas devem ser removidos antes de
  release; `npm audit --audit-level=low` não pode apresentar vulnerabilidades
  conhecidas sem justificativa registrada em `docs/SECURITY.md`.

### TR-16 — Acessibilidade e usabilidade técnica

- Componentes interativos com rótulo acessível (`aria-label`), foco visível e
  navegação por teclado nos painéis principais.
- Mensagens de erro da API são exibidas ao usuário sem stack trace e com ação
  de recuperação quando aplicável.
- A restauração de tela (`c4arch_view`) nunca deve sobrescrever uma navegação
  explícita do usuário.

---

## 6. Contratos técnicos

### 6.1 REST — convenções

Base: `/api`. Autenticação: `Authorization: Bearer <jwt>` (exceto login,
registro, callback Google, `/healthz`, `/metrics`, `/api/openapi.json` e
`/api/docs`).

| Grupo | Endpoints representativos |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `GET /auth/google`, `GET /auth/google/callback`, `GET/POST /auth/domains`, `DELETE /auth/domains/:id` |
| Organizações | `GET/POST /orgs`, `GET /orgs/:id`, `GET/POST /orgs/:id/members`, `PATCH/DELETE /orgs/:id/members/:userId` |
| Modelos | `GET/POST /models`, `POST /models/import`, `GET/PUT/DELETE /models/:id`, `POST /models/:id/diagrams`, `GET/PUT /models/:id/das` |
| Versões | `GET /models/:id/versions`, `GET /models/:id/versions/:versionId`, `POST /models/:id/versions/:versionId/restore`, `GET /models/:id/inspections` |
| Elementos | `GET/POST /models/:modelId/elements`, `GET/PUT/DELETE /models/:modelId/elements/:elementId` |
| Arestas | `GET/POST /models/:modelId/edges`, `GET/PUT/DELETE /models/:modelId/edges/:edgeId` |
| Views | `GET /models/:id/views`, `GET/PUT /models/:id/views/:key/layout`, `POST /models/:id/views/:key/autolayout` |
| Comentários | `GET/POST /models/:id/comments`, `PATCH/DELETE /models/:id/comments/:commentId` |
| Pastas | `GET/POST /folders`, `PUT/DELETE /folders/:id` |
| Catálogo | `GET/POST /apps`, `GET /apps/library`, `GET /apps/:id/dependencies`, `PUT/DELETE /apps/:id`; equivalentes em `/services` |
| draw.io | `POST /models/:id/drawio/token`, `GET /models/:id/drawio`, `GET /models/:id/drawio/xml`, `GET /models/:id/drawio/library`, `POST /models/:id/drawio/import` |
| Exportação | `GET /models/:id/exports`, `GET /models/:id/export/:format`, `GET /models/:id/preview` |
| PlantUML | `GET /models/import/plantuml/templates`, `POST /models/import/plantuml`, `POST /models/:id/import/plantuml`, `POST /plantuml/render` |
| Grupos | `GET/POST /groups`, `PUT/DELETE /groups/:id`, `GET/POST /groups/:id/members`, `DELETE /groups/:id/members/:userId` |
| Auditoria | `GET /audit` |
| Interno | `GET/PUT /internal/models/:id/state` (somente com `API_TOKEN_REALTIME`) |

Códigos esperados: `200/201` sucesso, `400` validação, `401` não autenticado,
`403` sem papel, `404` inexistente, `409` conflito (tipo de diagrama duplicado),
`413` payload excessivo, `429` rate limit, `500` erro interno.

### 6.2 WebSocket

- Endpoint: `ws://<host>:4001/ws`, path fixo `/ws`, payload máximo 1 MiB.
- Autenticação: token de sessão apresentado na conexão; token ausente só é
  aceito com `WS_ALLOW_ANONYMOUS=true` (nunca em produção).
- Entrada: `join`, `patch`, `undo`, `redo`, `presence`, `disconnect`.
- Saída: `state`, `update`, `presence`, `error`.
- `join` retorna o estado serializado do modelo; `patch` responde com `update`
  para todos os clientes da sala, inclusive o autor.
- `presence` transporta `clientId`, `name`, `color`, `viewKey`, `cursor` e
  `updatedAt`, segmentado por view/sala.
- Qualquer mensagem acima do limite de taxa ou com `modelId` não-UUID é
  rejeitada sem alterar o documento.

### 6.3 API interna de estado

`PUT /api/internal/models/:id/state` recebe
`{ "state": "<base64 do update Yjs>" }`; `GET` devolve
`{ contentHash, state, stateVector, revision }`. Autenticação por
`X-Internal-Token`; ausência de token desabilita o roteador inteiro.

### 6.4 MCP

- Transporte: JSON-RPC 2.0 por stdio, uma mensagem JSON por linha.
- Configuração: `C4ARCH_API_URL`, `C4ARCH_TOKEN`.
- Ferramentas: listar/consultar/criar/atualizar modelos, obter DAS, executar
  inspections, listar views, autolayout, exportar, importar e comentar.
- O MCP **não** acessa o PostgreSQL diretamente; toda autorização e auditoria
  são as da API.

---

## 7. Modelo de dados

### 7.1 Núcleo de identidade e organização

`users`, `organizations`, `memberships` (`owner|editor|viewer`),
`access_groups`, `access_group_members`, `login_domain_rules`.

### 7.2 Modelo C4 canônico

- `model_elements`: `parent_element_id`, `identifier`, `kind`
  (`person`, `software_system`, `container`, `component`, `deployment_node`,
  `infrastructure_node`, `container_instance`, `software_system_instance`),
  `name`, `description`, `technology`, `url`, `tags`, `properties`, vínculos
  opcionais `app_id`/`service_id`.
- `model_relationships`: `source_id`, `target_id`, `description`, `technology`,
  `tags`, `properties`; proíbe auto-relacionamento.
- `model_views`: `key`, `type` (`system_context`, `container`, `component`,
  `dynamic`, `deployment`, `filtered`, `image`), escopo, `include`/`exclude`,
  `auto_layout`.
- `model_view_layout`: posição e estilo por elemento/objeto por view.
- `model_das_overrides`: `section_key`, `content`, `mode`
  (`replace|append|hide`).

### 7.3 Compatibilidade e colaboração

- `models`: metadados, `c4_type`, `c4_scope`, `drawio_xml`, `diagrams` (JSONB),
  `das_content`, `das_generated_at`, `das_source_hash`, `das_override_count`,
  `parent_id` legado.
- `elements`/`edges`: modelo legado usado pelo editor REST/React Flow.
- `model_state`: snapshot binário Yjs + hash/revisão.
- `model_versions` + `model_version_counters`: histórico imutável com `kind`
  (`auto|manual|restore|import`), `content_hash`, autor e rótulo.
- `comments`, `model_events`, `audit_log`, `idempotency_keys`, `integrations`.

### 7.4 Índices obrigatórios

- `models(org_id)`, `models(folder_id)`, `models(parent_id)`, `models(c4_type)`.
- `elements(model_id)`, `edges(model_id)`, `folders(org_id)`,
  `apps(org_id)`, `services(org_id)`.
- `model_elements(model_id)`, `(parent_element_id)`, `(model_id, kind)`.
- `model_relationships(model_id)`, `(source_id)`, `(target_id)`.
- `model_views(model_id)`, `(scope_element_id)`.
- `model_versions(model_id, created_at DESC)`, único `(model_id, version)` e
  único parcial `(model_id, content_hash)`.
- `audit_log(org_id, created_at DESC)`, `comments(model_id, created_at)`,
  `model_events(model_id, created_at DESC)`.

### 7.5 Migrações

| Versão | Conteúdo |
|---|---|
| `001-base-schema` | Schema base (identidade, modelos, elementos, arestas, comentários, versões, auditoria, integrações, grupos, domínios) |
| `002-base-alters` | Alters acumulados da Onda 1 (draw.io, diagrams, DAS, metadados de versão, índices) |
| `003-wave2-collaboration` | Idempotência, eventos de modelo, índices de comentários |

Aplicação: `npm run db:migrate` (`apps/api/src/scripts/run-migrations.ts`).

---

## 8. Fluxos técnicos críticos

### 8.1 Colaboração em tempo real

1. Cliente conecta em `/ws` e envia `join` com `modelId`.
2. Servidor valida UUID e autorização; carrega `model_state` (flag `on`) ou
   snapshot em `storage`/API e hidrata o `Y.Doc` **somente se vazio**.
3. Cada `patch` é validado, aplicado ao CRDT e retransmitido como `update`.
4. Alterações marcam o modelo como *dirty*; persistência ocorre com debounce de
   2 s e flush a cada 15 s, além do flush na desconexão do último cliente.
5. Falha de persistência mantém `dirty=true` e registra aviso; não descarta o
   estado em memória.

### 8.2 Geração do DAS

1. Gatilhos: criação/edição de modelo, novo diagrama, importação draw.io,
   primeira leitura sem conteúdo e startup da API.
2. Extrai elementos/relações de `model_elements`/`model_relationships` e, para
   compatibilidade, do XML draw.io (incluindo placeholders `%c4Name%`,
   `%c4Description%`, `%c4Technology%`, `%c4Type%`).
3. Enriquece shapes da biblioteca `c4arch` com dados de `apps`/`services`.
4. Gera Markdown com informações do modelo, inventário de diagramas, seções por
   nível C4 e tabelas de elementos/conexões.
5. Aplica overrides de `model_das_overrides`; grava `das_content`,
   `das_generated_at` e `das_source_hash`.
6. Preview/PDF usam a mesma renderização e exibem o draw.io em iframe isolado.

### 8.3 Versionamento por conteúdo

- Worker calcula `sha256` estável do snapshot; conteúdo inédito consome o
  contador de versão e grava `model_versions`; conteúdo repetido é ignorado.
- Execução a cada **5 min**; retenção de **30** versões automáticas.
- Restauração cria uma nova versão `kind=restore` e reaplica o snapshot ao
  modelo, sem apagar o histórico.

### 8.4 Importação de modelos

- Fonte exclusiva por requisição: `xml` **ou** `url`.
- `xml` acima de 100 kB → 413; URL inválida/host interno → 400; pasta
  inexistente → 404; viewer → 403.
- Tipo C4 inferido pelo nome/título (contexto, container, componente, código,
  landscape, dinâmico, implantação), padrão `container`.
- Cada item do lote é independente: falha não interrompe os demais; resposta por
  item com sucesso/falha.

### 8.5 PlantUML

- Exportação gera fonte C4-PlantUML a partir do canônico.
- Renderização ocorre na API via `PLANTUML_RENDER_URL_TEMPLATE`
  (`{encoded}` obrigatório); o SVG retorna como imagem.
- Erros de sintaxe são exibidos como desenho de erro do PlantUML.
- **Aplicar** faz parsing do fonte para elementos/relações/views e propaga via
  realtime.

---

## 9. Segurança operacional

Obrigações mínimas de implantação:

1. `JWT_SECRET` aleatório com ≥32 caracteres; `DEMO_ADMIN_PASSWORD` forte se
   `SEED_DEMO=true`; seed desabilitado em produção por padrão.
2. `CORS_ORIGIN` restrito aos domínios reais; `TRUST_PROXY=true` apenas atrás de
   proxy confiável.
3. TLS terminado no reverse proxy; `PUBLIC_API_URL`/`PUBLIC_WS_URL` em
   `https`/`wss`.
4. `DATABASE_URL`/`DB_PASSWORD` sem placeholders; senha forte e rotação
   periódica.
5. `API_TOKEN_REALTIME` definido apenas quando `model_state` estiver em uso e
   inacessível fora da rede interna.
6. Portas publicadas apenas em `127.0.0.1` em desenvolvimento; nenhuma porta de
   API/realtime exposta no host em produção.
7. Backups criptografados em repouso, com teste de restauração documentado.
8. Logs sem segredos, tokens, senhas ou conteúdo integral de documentos.

Checklist ampliado e riscos residuais: `docs/SECURITY.md`.

---

## 10. Observabilidade e operação

| Sinal | Onde | Uso |
|---|---|---|
| `/healthz` | API | Liveness/readiness com verificação do banco |
| `/metrics` | API | Prometheus (habilitar por ambiente, rede interna) |
| `X-Request-Id` | API | Correlação de requisição nos logs |
| `audit_log` | PostgreSQL | Rastreabilidade de mutações por organização |
| `schema_migrations` | PostgreSQL | Estado das migrações aplicadas |
| Logs do realtime | stdout | Falhas de persistência, hidratação e mensagens inválidas |
| `backups/` | Volume/host | Dump + storage + manifesto por execução |

Procedimentos operacionais: `npm run db:migrate`, `npm run backup`,
`npm run restore -- <arquivo>`, `npm run sbom`.

---

## 11. Estratégia de verificação

| Camada | Ferramenta | Comando | Critério de aprovação |
|---|---|---|---|
| Typecheck | `tsc` | `npm run typecheck` | Zero erros nos 5 workspaces |
| Unidade API | Node test + tsx | `npm test --workspace=@c4arch/api` | 100% dos testes verdes |
| Unidade web | Node test + jsdom | `npm test --workspace=@c4arch/web` | 100% verdes |
| Realtime | Node test | `npm test --workspace=@c4arch/realtime` | 100% verdes |
| Integração SQL | PostgreSQL 16 | `npm run test:schema --workspace=@c4arch/api` | Migrações e backfill idempotentes |
| E2E | Playwright | `npm run test:e2e --workspace=@c4arch/web` | Login, sessão e deep link |
| Contrato | OpenAPI | `npm run openapi:client` | Cliente gerado sem diff inesperado |
| Dependências | `npm audit` | `npm audit --audit-level=low` | Sem vulnerabilidades sem justificativa |

Referência de 14/11/2026: 146 testes aprovados (113 API + 9 realtime + 24 web).

---

## 12. Entrega, rollout e feature flags

1. **Migrar** o banco (`schema_migrations`) antes de subir a nova versão da API.
2. **Backfill** canônico (`backfill:canonical`) e reconciliação
   (`reconcile:canonical`) antes de promover qualquer flag.
3. **Shadow:** `CANONICAL_MODEL=shadow`, `CANONICAL_VIEWS=shadow`,
   `PROJECTOR_SHADOW=shadow`, `VERSION_HASH=shadow`; comparar sem servir.
4. **Promover:** `on` apenas com divergência zero nos relatórios de shadow.
5. **Realtime:** `REALTIME_PG_STATE=on` exige `API_TOKEN_REALTIME` e testes de
   flush/restore.
6. **Rollback:** desligar flags para `off` e, se necessário, aplicar os scripts
   `scripts/rollback-m*.sql` com backup prévio.
7. **Frontend:** flags `VITE_*` são de build; mudanças exigem novo build da web.

---

## 13. Riscos técnicos e dívidas conhecidas

| Risco | Impacto | Mitigação atual / próxima ação |
|---|---|---|
| Duas fontes concorrentes (canônico × Yjs/legado) | Divergência de dados | Flags de sombra + reconciliação; consolidar persistência do realtime |
| `realtime` single-instance e em memória | Sem escala horizontal; perda em crash | Snapshot + `model_state`; pub/sub e store compartilhado no roadmap |
| Permissões ainda parciais em algumas rotas | Escalada lateral | Testes de acesso por rota; revisão contínua (RF-14) |
| Migrações legadas tolerantes a erro | Estrutura parcial silenciosa | Novas migrações são estritas; `test:schema` no CI |
| Sem paginação explícita em listagens grandes | Latência/memória | Limites de dimensão (TR-03); avaliar paginação |
| Sincronização Drive/GitLab não habilitada | Interoperabilidade limitada | ADR-0002 rejeitada; manter fora do MVP |
| Dependência de serviço PlantUML externo | Preview indisponível | Compose local + template configurável |
| Cobertura E2E com API mockada | Regressões de integração real | Job de schema + testes de integração no CI |

---

## 14. Critérios de aceite técnicos

- [ ] Typecheck e build verdes nos cinco workspaces.
- [ ] Migrações aplicadas do zero e sobre banco existente sem erro fatal.
- [ ] Backfill/reconciliação sem divergências antes de ligar flags.
- [ ] `POST /api/models/:id/diagrams` retorna 409 para tipo duplicado e 403 para viewer.
- [ ] Mover elemento no WebSocket preserva título, tipo, descrição e metadados.
- [ ] Snapshot é gravado de forma atômica e recuperado após restart.
- [ ] `model_state` grava e restaura o CRDT com `content_hash` estável.
- [ ] DAS é regenerado em criação, edição, novo diagrama, importação e startup.
- [ ] Importação rejeita URL interna, pasta do Drive e XML acima do limite.
- [ ] OpenAPI 3.1 e cliente tipado refletem as rotas publicadas.
- [ ] `/healthz` responde 503 com banco indisponível.
- [ ] Containers sobem non-root, sem capabilities e com healthcheck.
- [ ] Backup e restore reproduzem modelo + storage em ambiente limpo.
- [ ] `npm audit --audit-level=low` sem achados sem justificativa.

---

## 15. Rastreabilidade de decisões

| Tema | ADR |
|---|---|
| Tempo real com Yjs | ADR-0001 |
| Adaptador de storage e Drive/GitLab (rejeitada) | ADR-0002 |
| Docker Compose | ADR-0003 |
| Licença MIT | ADR-0004 |
| Nome do projeto | ADR-0005 |
| React Flow 12 | ADR-0006 |
| API autocontida | ADR-0007 |
| Reconexão do WebSocket | ADR-0008 |
| CRUD do modelo | ADR-0009 |
| Merge parcial no realtime | ADR-0010 |
| Typecheck do frontend | ADR-0011 |
| CRUD draw.io | ADR-0012 |
| Remoção de código morto | ADR-0013 |
| Hardening de segurança | ADR-0014 |
| Grupos de acesso | ADR-0015 |
| Biblioteca draw.io `c4arch` | ADR-0016 |
| Vínculo entre tipos de diagrama | ADR-0017 |
| Multi-diagrama no mesmo modelo | ADR-0018 |
| Importação e DAS automático | ADR-0019 |
| Hardening de importação/grupos/XSS | ADR-0020 |
| Modelo canônico como fonte única | ADR-0021 |
| Views como projeções | ADR-0022 |
| DAS como projeção com overrides | ADR-0023 |
| Versionamento restaurável e estado colaborativo | ADR-0024 |
| PlantUML como formato de intercâmbio | ADR-0025 |

---

## 16. Glossário técnico

- **Modelo canônico:** representação relacional única do C4 (`model_elements`,
  `model_relationships`, `model_views`).
- **Projeção:** artefato derivado do canônico (DAS, exportações, layouts).
- **CRDT:** estrutura replicável sem conflito; aqui, documento Yjs por modelo.
- **Snapshot:** serialização completa do documento Yjs.
- **Flag `shadow`:** executa o caminho novo em paralelo sem servir a resposta.
- **DAS:** Documento de Arquitetura de Soluções, gerado a partir do modelo.
- **C4 type:** tipo de diagrama C4 (`system-context`, `container`, etc.).
- **Idempotência:** repetição segura de uma requisição mutante com a mesma chave.

---

## Histórico de versões

| Versão | Data | Alteração |
|---|---|---|
| 1.0.0 | 17/11/2026 | Criação do TRD com requisitos funcionais herdados (RF-01 a RF-25) e requisitos técnicos (TR-01 a TR-16) |
| 1.1.0 | 17/11/2026 | PRD recriado no repositório; TRD passa a ser complementar, incorpora RF-26 a RF-33 na rastreabilidade e alinha o status dos requisitos ao código |
