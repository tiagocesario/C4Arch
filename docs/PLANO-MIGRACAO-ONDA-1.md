# C4Arch — Plano de migração da Onda 1

- **Versão:** 1.0.0
- **Data:** 11/11/2026
- **Status:** Aprovado; M0 e M1 concluídos, M2 não iniciado
- **Escopo:** schema, endpoints, UI, rollout, testes, critérios de aceite, riscos
  e rollback da Onda 1 definida em `docs/ANALISE-STRUCTURIZR.md`
- **Acompanhamento do M0:** `docs/M0-CHECKLIST.md`
- **ADRs relacionados:** ADR-0021 (modelo canônico), ADR-0022 (views),
  ADR-0023 (DAS com overrides), ADR-0024 (versionamento e estado colaborativo)

## 1. Objetivo

Transformar o C4Arch de **quatro fontes de verdade** (Postgres, Yjs, snapshots
em disco e XML draw.io) em **um modelo canônico com projeções confiáveis**, sem:

- remover a colaboração em tempo real;
- abandonar o draw.io;
- abandonar o DAS em português;
- quebrar as APIs e a UX existentes.

A Onda 1 termina quando:

1. canvas, draw.io e DAS contam a mesma história após restart;
2. edições manuais do DAS não são mais perdidas;
3. versões só são criadas quando o modelo muda e podem ser restauradas;
4. o estado colaborativo é durável no Postgres.

## 2. Situação atual vs. alvo

### 2.1 Hoje

```text
┌──────────────┐   WebSocket   ┌──────────────┐   arquivo    ┌──────────────┐
│ Canvas React │ ────────────► │ Yjs (memória)│ ───────────► │ snapshot JSON│
│ Flow         │               └──────────────┘              │ em disco     │
└──────────────┘                                             └──────┬───────┘
       │ REST                                                       │ 30s
       ▼                                                            ▼
┌──────────────┐   XML    ┌──────────────────┐              ┌──────────────┐
│ elements /   │ ◄─────── │ models.drawio_xml│              │ worker       │
│ edges        │          │ models.diagrams  │              │ model_versions│
└──────┬───────┘          └────────┬─────────┘              └──────────────┘
       │                           │
       └──────────► DAS ◄──────────┘
```

Problemas:

- O canvas não grava em `elements`/`edges`.
- O DAS lê Postgres + XML, então ignora edições do canvas.
- `models.diagrams` guarda um desenho independente por tipo.
- `PUT /das` permite editar, mas a regeneração sobrescreve.
- O worker cria versão a cada 30s, sem hash, retenção ou restore.
- O worker tem migrações próprias; há dois donos do schema.

### 2.2 Alvo

```text
┌──────────────┐   WebSocket   ┌──────────────┐   debounce   ┌──────────────┐
│ Canvas React │ ────────────► │ Yjs (memória)│ ───────────► │ model_state  │
│ Flow         │               └──────────────┘              │ (Postgres)   │
└──────────────┘                                             └──────┬───────┘
       │ REST                                                       │ projetor
       ▼                                                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ model_elements · model_relationships · model_views · model_view_layout    │
└───────────┬───────────────────┬───────────────────────┬──────────────────┘
            │                   │                       │
            ▼                   ▼                       ▼
     API REST / views     DAS gerado + overrides    versões por hash
            │                   │                       │
            └──────────► draw.io adapter ◄──────────────┘
```

Regras:

- **Uma fonte de verdade lógica:** modelo canônico.
- **Uma fonte de verdade do estado colaborativo:** `model_state`.
- **Um único escritor das tabelas canônicas:** o projetor.
- **Draw.io, DAS, exportação e catálogo são projeções/adaptadores.**
- **Um único dono do schema:** a API.

## 3. Schema alvo

### 3.1 Novas tabelas

```sql
-- Elementos do modelo canônico
CREATE TABLE IF NOT EXISTS model_elements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id          UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  parent_element_id UUID REFERENCES model_elements(id) ON DELETE CASCADE,
  identifier        TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN (
                      'person','software_system','container','component',
                      'deployment_node','infrastructure_node',
                      'container_instance','software_system_instance')),
  name              TEXT NOT NULL,
  description       TEXT,
  technology        TEXT,
  url               TEXT,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  properties        JSONB NOT NULL DEFAULT '{}'::jsonb,
  app_id            UUID REFERENCES apps(id) ON DELETE SET NULL,
  service_id        UUID REFERENCES services(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (model_id, identifier)
);

CREATE INDEX IF NOT EXISTS idx_model_elements_model
  ON model_elements(model_id);
CREATE INDEX IF NOT EXISTS idx_model_elements_parent
  ON model_elements(parent_element_id);
CREATE INDEX IF NOT EXISTS idx_model_elements_kind
  ON model_elements(model_id, kind);

-- Relações do modelo canônico
CREATE TABLE IF NOT EXISTS model_relationships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id    UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  source_id   UUID NOT NULL REFERENCES model_elements(id) ON DELETE CASCADE,
  target_id   UUID NOT NULL REFERENCES model_elements(id) ON DELETE CASCADE,
  description TEXT,
  technology  TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  properties  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_id <> target_id)
);

CREATE INDEX IF NOT EXISTS idx_model_relationships_model
  ON model_relationships(model_id);
CREATE INDEX IF NOT EXISTS idx_model_relationships_source
  ON model_relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_model_relationships_target
  ON model_relationships(target_id);

-- Views como projeções do modelo
CREATE TABLE IF NOT EXISTS model_views (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id         UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN (
                     'system_context','container','component','dynamic',
                     'deployment','filtered','image')),
  scope_element_id UUID REFERENCES model_elements(id) ON DELETE SET NULL,
  title            TEXT,
  description      TEXT,
  include          JSONB NOT NULL DEFAULT '[]'::jsonb,
  exclude          JSONB NOT NULL DEFAULT '[]'::jsonb,
  auto_layout      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (model_id, key)
);

CREATE INDEX IF NOT EXISTS idx_model_views_model
  ON model_views(model_id);
CREATE INDEX IF NOT EXISTS idx_model_views_scope
  ON model_views(scope_element_id);

-- Layout por view (separado do modelo)
CREATE TABLE IF NOT EXISTS model_view_layout (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  view_id    UUID NOT NULL REFERENCES model_views(id) ON DELETE CASCADE,
  element_id UUID REFERENCES model_elements(id) ON DELETE CASCADE,
  object_key TEXT,
  x          DOUBLE PRECISION,
  y          DOUBLE PRECISION,
  width      DOUBLE PRECISION,
  height     DOUBLE PRECISION,
  style      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_view_layout_element
  ON model_view_layout(view_id, element_id)
  WHERE element_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_view_layout_object
  ON model_view_layout(view_id, object_key)
  WHERE object_key IS NOT NULL;

-- Estado colaborativo durável
CREATE TABLE IF NOT EXISTS model_state (
  model_id     UUID PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
  state        BYTEA NOT NULL,
  state_vector BYTEA,
  content_hash TEXT NOT NULL,
  revision     BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Overrides manuais do DAS
CREATE TABLE IF NOT EXISTS model_das_overrides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id    UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  content     TEXT,
  mode        TEXT NOT NULL DEFAULT 'replace'
              CHECK (mode IN ('replace','append','hide')),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (model_id, section_key)
);

CREATE INDEX IF NOT EXISTS idx_model_das_overrides_model
  ON model_das_overrides(model_id);
```

### 3.2 Alterações em tabelas existentes

```sql
-- Metadados do DAS renderizado
ALTER TABLE models ADD COLUMN IF NOT EXISTS das_generated_at   TIMESTAMPTZ;
ALTER TABLE models ADD COLUMN IF NOT EXISTS das_source_hash    TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS das_override_count INTEGER NOT NULL DEFAULT 0;

-- Versionamento por conteúdo
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS author_id    UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS label        TEXT;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS description  TEXT;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS kind         TEXT NOT NULL DEFAULT 'auto'
  CHECK (kind IN ('auto','manual','restore','import'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_versions_hash
  ON model_versions(model_id, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_model_versions_model_created
  ON model_versions(model_id, created_at DESC);

-- vínculo de app/serviço no elemento canônico já está na tabela nova;
-- as colunas em `elements` continuam por compatibilidade até M6.
```

> **Observação:** `content_hash` começa anulável para permitir backfill. A
> unicidade é parcial (`WHERE content_hash IS NOT NULL`) para não bloquear
> versões legadas sem hash.

### 3.3 Índices e integridade

- `model_elements.identifier` é estável e usado pelo adapter draw.io
  (`c4archElementId`) e pela exportação.
- `model_relationships` não permite auto-relação.
- `model_views.key` é estável por modelo (`context`, `containers`,
  `components`, `dynamic`, `deployment`).
- `model_view_layout` permite `element_id NULL` para posições de anotações
  visuais (notas, legendas), identificadas por `object_key`; as unicidades são
  parciais para não conflitar com `NULL`.
- `model_state.state` é o update Yjs completo; `state_vector` acelera sync
  incremental.

## 4. Mapeamento do legado

### 4.1 Elementos

| Legado (`elements`) | Canônico (`model_elements`) | Regra |
|---|---|---|
| `id` | `id` | preservar UUID |
| `model_id` | `model_id` | direto |
| `type = 'actor'` | `kind = 'person'` | mapeamento |
| `type = 'system'` | `kind = 'software_system'` | mapeamento |
| `type = 'container'` | `kind = 'container'` | direto |
| `type = 'component'` | `kind = 'component'` | direto |
| `title` | `name` | direto |
| `description` | `description` | direto |
| `metadata.technology` | `technology` | extrair |
| `metadata.url` | `url` | extrair |
| `metadata.tags` | `tags` | array ou split por vírgula |
| `metadata.*` restante | `properties` | preservar |
| `app_id`, `service_id` | iguais | direto |
| `position_x`, `position_y` | `model_view_layout` | na view primária do modelo |
| — | `identifier` | slug do nome + sufixo curto do UUID |
| — | `parent_element_id` | inferir por contenção no XML, quando possível |

### 4.2 Relações

| Legado (`edges`) | Canônico (`model_relationships`) | Regra |
|---|---|---|
| `id` | `id` | preservar UUID |
| `model_id` | `model_id` | direto |
| `from_id` | `source_id` | direto |
| `to_id` | `target_id` | direto |
| `label` | `description` | direto |
| `type` | `properties.legacyType` | preservar para estilo |
| — | `technology` | extrair do label quando houver `[Tecnologia]` |
| — | `tags` | `{}` |

O `type` legado (`call`, `http`, `message`, `depends`) **não** é semântica C4;
ele vira dica de estilo em `properties.legacyType` e não é usado em validação.

### 4.3 Views

| Legado | Canônico | Regra |
|---|---|---|
| `models.c4_type` + `models.drawio_xml` | `model_views` (key = `c4_type`) | view primária |
| `models.diagrams[].c4Type` + `.drawioXml` | `model_views` (key = `c4Type`) | uma view por item |
| `models.c4_scope` | `model_views.scope_element_id` | casar por nome com `model_elements`; se ambíguo, `NULL` e marcar `legacy` |
| `models.parent_id` | mantém hierarquia de modelos | usado para herdar escopo |
| posições no XML | `model_view_layout` | best-effort por `c4archElementId` ou nome |
| formas sem ID C4 | `model_view_layout` com `element_id NULL` | anotações visuais |

### 4.4 DAS

| Legado | Novo | Regra |
|---|---|---|
| `models.das_content` | `models.das_content` (renderizado) | continua sendo o cache de leitura |
| texto editado manualmente | `model_das_overrides` | diff contra o DAS gerado; criar override `replace` nas seções divergentes |
| `PUT /das` com texto integral | overrides por seção | converter; se não for possível, override `document` |
| regeneração | gera + aplica overrides | nunca apaga override |

### 4.5 Versões

| Legado | Novo | Regra |
|---|---|---|
| `model_versions.snapshot` (Yjs) | snapshot canônico | converter no backfill |
| `version` | `version` | preservar |
| `created_by` | `author_id` | copiar |
| — | `content_hash` | calcular; duplicatas ficam com hash `NULL` e são arquivadas |
| `model_version_counters` | `MAX(version)` transacional | descontinuar em M6 |

## 5. Endpoints

### 5.1 Modelo canônico

```text
GET    /api/models/:id/model
       → { model, elements, relationships, views, layout, meta }

PUT    /api/models/:id/model
       → substitui o modelo canônico (editor REST; requer If-Match)

GET    /api/models/:id/elements
POST   /api/models/:id/elements
GET    /api/models/:id/elements/:elementId
PUT    /api/models/:id/elements/:elementId
DELETE /api/models/:id/elements/:elementId

GET    /api/models/:id/relationships
POST   /api/models/:id/relationships
PUT    /api/models/:id/relationships/:relationshipId
DELETE /api/models/:id/relationships/:relationshipId
```

As rotas antigas `/:modelId/elements` e `/:modelId/edges` continuam
funcionando e passam a operar sobre as tabelas canônicas, com adaptação de
payload (`type` ↔ `kind`, `from_id`/`to_id` ↔ `source_id`/`target_id`).

### 5.2 Views e layout

```text
GET    /api/models/:id/views
POST   /api/models/:id/views
GET    /api/models/:id/views/:viewId
PUT    /api/models/:id/views/:viewId
DELETE /api/models/:id/views/:viewId

GET    /api/models/:id/views/:viewId/layout
PUT    /api/models/:id/views/:viewId/layout
       → upsert em lote: [{ elementId, x, y, width, height, style }]

POST   /api/models/:id/views/:viewId/autolayout
GET    /api/models/:id/views/:viewId/resolved
       → subconjunto de elementos/relações visíveis na view
```

`POST /api/models/:id/diagrams` continua aceitando `{ c4Type, drawioXml }` e
cria/atualiza a view correspondente (compatibilidade).

### 5.3 Validação

```text
POST   /api/models/:id/validate
       → { errors: [...], warnings: [...], infos: [...] }
```

Regras iniciais (Onda 1):

| Código | Severidade | Regra |
|---|---|---|
| `ELEMENT_NO_NAME` | error | elemento sem nome |
| `ELEMENT_DUPLICATE_NAME` | error | nome duplicado no mesmo escopo |
| `RELATIONSHIP_DANGLING` | error | relação aponta para elemento inexistente |
| `VIEW_EMPTY` | warning | view sem elementos |
| `VIEW_SCOPE_MISSING` | warning | view de container/componente sem escopo |
| `ELEMENT_ORPHAN` | warning | elemento fora de todas as views |
| `ELEMENT_NO_DESCRIPTION` | info | elemento sem descrição |
| `CONTAINER_NO_TECHNOLOGY` | info | container sem tecnologia |
| `RELATIONSHIP_NO_DESCRIPTION` | info | relação sem descrição |

### 5.4 DAS

```text
GET    /api/models/:id/das
GET    /api/models/:id/das/overrides
PUT    /api/models/:id/das/overrides/:sectionKey
DELETE /api/models/:id/das/overrides/:sectionKey
POST   /api/models/:id/das/regenerate
GET    /api/models/:id/das/preview
```

`GET /das` devolve `content`, `generatedAt`, `sourceHash` e `sections[]` com
`mode` e `edited`.

### 5.5 Versões

```text
GET    /api/models/:id/versions?limit=30&cursor=...
GET    /api/models/:id/versions/:version
POST   /api/models/:id/versions
POST   /api/models/:id/versions/:version/restore
PATCH  /api/models/:id/versions/:version
```

### 5.6 Interno

```text
PUT    /api/internal/models/:id/state
       Header: X-Internal-Token
       Body:   { state: base64, stateVector?: base64, revision: number, updatedBy?: uuid }
       → { contentHash, projectedRevision }
```

- Protegido por token interno (`INTERNAL_TOKEN`), não exposto publicamente.
- Idempotente por `revision` e `content_hash`.
- Dispara a projeção canônica.

### 5.7 Compatibilidade e versionamento de API

- Todas as rotas novas são aditivas.
- Rotas antigas continuam por pelo menos um ciclo de estabilização (M6).
- Erros seguem o formato atual; campos novos são opcionais.
- `ETag`/`If-Match` em `PUT /models/:id` e `PUT /models/:id/model` para
  concorrência otimista.

## 6. UI

### 6.1 Split do frontend

`apps/web/src/App.tsx` (2.820 linhas) será dividido em features:

```text
apps/web/src/
├── app/
│   ├── App.tsx              # shell, router, providers
│   └── routes.tsx
├── features/
│   ├── files/               # árvore de pastas, modelos, importação
│   ├── editor/              # canvas React Flow + Yjs
│   ├── preview/             # abas de views + draw.io
│   ├── das/                 # editor do DAS, badges, exportação
│   ├── catalog/             # apps e serviços
│   └── admin/               # usuários, grupos, domínios
├── components/              # design system mínimo
├── lib/                     # API client, auth, hooks
└── types/
```

Regras:

- Nenhuma feature importa diretamente o estado de outra; comunicação via
  contexto/hooks e API.
- `App.tsx` final deve ficar abaixo de 300 linhas.
- O modo atual (`files | edit | users | groups | catalog | domains`) vira rota.
- O canvas e o DAS continuam funcionando durante o split (mudança estrutural,
  sem mudança de comportamento).

### 6.2 Views na UI

- O preview deixa de ter “abas por tipo de diagrama” e passa a ter **abas por
  view** (`Contexto`, `Containers`, `Componentes`, `Dinâmico`, `Deployment`).
- Cada aba mostra:
  - badge do tipo (`system_context`, `container`, ...);
  - escopo (“Sistema: Pedidos”);
  - botão “Abrir no draw.io”;
  - botão “Editar layout”;
  - indicador de validação (erros/warnings).
- Drill-down: clicar em um sistema no contexto abre/filtra a view de containers
  daquele sistema; clicar em um container abre a view de componentes.
- Criar uma view nova não duplica elementos: ela reutiliza o modelo.

### 6.3 DAS na UI

- Cada seção exibe badge **Gerado**, **Editado**, **Anexado**, **Oculto** ou
  **Órfão**.
- Ações por seção: **Editar**, **Restaurar gerado**, **Ocultar/Mostrar**.
- Botão **Atualizar DAS** (preserva overrides) e **Regenerar tudo** (descarta
  edições, com confirmação explícita).
- Aviso quando o modelo mudou desde a última geração: “O modelo mudou; o DAS
  pode estar desatualizado”.
- Exportação PDF/Markdown/HTML usa o DAS renderizado, nunca regenera sozinha.

### 6.4 Versões na UI

- Painel lateral “Histórico” com lista de versões: data, autor, label, tipo
  (`auto`, `manual`, `restore`, `import`).
- Ações: **Ver**, **Comparar**, **Restaurar**, **Rotular**.
- Diff resumido antes de restaurar: elementos/relações/views adicionados,
  removidos e alterados; seções do DAS afetadas.
- Versões manuais são destacadas e não expiram.

### 6.5 Validação na UI

- Badge de “saúde da arquitetura” no cabeçalho do modelo.
- Painel com erros/warnings/infos, agrupados por view e por elemento.
- Clicar em um item leva ao elemento/view correspondente.

## 7. Fases de rollout

### M0 — Preparação (2–3 dias)

> **Concluído em 11/11/2026.** Evidências, backup e arquivos em
> `docs/M0-CHECKLIST.md`.

- Criar feature flags:

  ```text
  CANONICAL_MODEL=off|shadow|on
  CANONICAL_VIEWS=off|shadow|on
  DAS_OVERRIDES=off|on
  VERSION_HASH=off|on
  REALTIME_PG_STATE=off|on
  PROJECTOR_SHADOW=off|on
  ```

- Backup completo do banco e dos snapshots.
- Congelar mudanças de schema conflitantes.
- Adicionar telemetria: tempo de request, contagem de modelos, tamanho de
  snapshots, erros de projeção.
- Remover `apps/api/storage/*.json` do Git e ajustar `.gitignore`.
- Criar CI mínimo (typecheck + testes existentes).

**Saída:** flags disponíveis, backup validado, CI verde.

### M1 — Schema (3–5 dias)

> **Concluído em 11/11/2026.** DDL aplicado e verificado duas vezes; rollback em
> `scripts/rollback-m1.sql`; evidências em `docs/M1-CHECKLIST.md`.

- Aplicar DDL da seção 3 em `apps/api/src/db/migrate.ts`.
- Adicionar `content_hash`, `author_id`, `label`, `description`, `kind` em
  `model_versions`.
- Criar `model_state`, `model_das_overrides`, `model_elements`,
  `model_relationships`, `model_views`, `model_view_layout`.
- Nenhuma mudança de comportamento; tudo atrás de flag.

**Saída:** schema criado, migração idempotente, rollback por `DROP` documentado.

### M2 — Backfill e leitura em sombra (5–8 dias)

- Script de backfill:
  1. copiar `elements` → `model_elements`;
  2. copiar `edges` → `model_relationships`;
  3. criar views a partir de `models.c4_type`/`models.diagrams`;
  4. extrair layout do XML quando possível;
  5. inferir `scope_element_id` a partir de `c4_scope`/`parent_id`;
  6. calcular `content_hash` das versões existentes;
  7. converter `das_content` editado em overrides.
- Rodar `CANONICAL_MODEL=shadow`: a API lê do legado e compara com o canônico,
  registrando divergências (sem alterar a resposta).
- Relatório de divergências por modelo; corrigir heurísticas.

**Saída:** ≥ 95% dos modelos com backfill sem erro; divergências conhecidas e
documentadas.

### M3 — Escrita canônica, DAS e versões (8–12 dias)

- `PUT /api/internal/models/:id/state` e gravação de `model_state` pelo
  realtime (debounce 2s, flush 15s).
- Projetor idempotente em modo sombra (`PROJECTOR_SHADOW=on`), comparando
  `model_state` → tabelas canônicas com o estado atual.
- `regenerateModelDAS` passa a:
  1. gerar do canônico;
  2. aplicar overrides;
  3. respeitar `das_source_hash`;
  4. gravar `das_generated_at`, `das_override_count`.
- `PUT /das` grava overrides por seção.
- Worker passa a criar versões por hash (máximo a cada 5 min), com retenção 30
  e `kind='auto'`.
- Endpoints de versões e restore.
- Backfill de overrides do DAS concluído.

**Saída:** DAS preserva edições; versões só mudam quando o modelo muda;
projetor sem divergências relevantes.

### M4 — UI (10–15 dias)

- Split do frontend em features (seção 6.1), sem mudança de comportamento.
- Abas por view, drill-down, badges de escopo.
- DAS com badges, edição por seção, restaurar/ocultar, aviso de desatualizado.
- Painel de versões com diff e restore.
- Painel de validação.
- Flags `CANONICAL_VIEWS=on`, `DAS_OVERRIDES=on`, `VERSION_HASH=on` para
  usuários internos/beta.

**Saída:** beta interno usando o fluxo novo; feedback coletado.

### M5 — Cutover (5–7 dias)

- `CANONICAL_MODEL=on`, `CANONICAL_VIEWS=on`, `PROJECTOR_SHADOW=off`,
  `REALTIME_PG_STATE=on` para todos.
- Monitorar por 1 semana:
  - divergência canvas ↔ DAS;
  - falhas de projeção;
  - versões criadas/dia;
  - erros 5xx;
  - tempo de geração do DAS.
- Rodar reconciliação diária durante 2 semanas.

**Saída:** produção no caminho novo, sem incidentes críticos.

### M6 — Limpeza (3–5 dias)

- Remover leitura de `models.diagrams` como definição de views.
- Remover dual-write e código de fallback.
- Remover migrações do worker; `integrations` e `model_versions` passam a ser
  criadas só pela API.
- Descontinuar `model_version_counters`.
- Remover colunas legadas de `elements`/`edges` quando não houver mais leitores
  (ou mantê-las como views SQL de compatibilidade).
- Remover snapshot de runtime do Git.
- Atualizar documentação e ADRs para “Adotada”.

**Saída:** um único caminho de dados; dívida da Onda 1 quitada.

## 8. Estratégia de flags e fallback

| Flag | `off` | `shadow` | `on` |
|---|---|---|---|
| `CANONICAL_MODEL` | lê/grava legado | lê legado, compara canônico | lê/grava canônico |
| `CANONICAL_VIEWS` | `models.diagrams` | resolve views e compara | views canônicas |
| `PROJECTOR_SHADOW` | não projeta | projeta e compara | projeta e serve |
| `DAS_OVERRIDES` | `das_content` direto | — | gera + overrides |
| `VERSION_HASH` | versão a cada 30s | calcula hash, não bloqueia | versão por hash |
| `REALTIME_PG_STATE` | snapshot em disco | grava os dois | `model_state` |

Fallback:

- Se o canônico estiver vazio/inconsistente para um modelo, a API usa o legado
  e registra `canonical_fallback=true`.
- Se a projeção falhar, o realtime continua servindo o `Y.Doc` em memória e o
  disco; o job de reconciliação tenta de novo.
- Se o DAS não puder ser gerado do canônico, usa o último `das_content` e marca
  `stale=true`.

## 9. Testes

### 9.1 Unitários

- Mapeamento de tipos (`actor → person`, etc.).
- Resolvedor de `include`/`exclude` (views vazias, ancestrais, relações).
- Normalização de hash (ordem de chaves, arrays, nulos).
- Aplicação de overrides (`replace`, `append`, `hide`, órfãos).
- Cálculo de retenção de versões.
- Regras de validação.

### 9.2 Integração

- Backfill em banco com dados representativos (todos os tipos de diagrama).
- Projetor idempotente: aplicar o mesmo estado 1x e 2x produz o mesmo resultado.
- Concorrência: edição no canvas + regeneração de DAS + restore.
- `PUT /internal/state` com token inválido, revisão antiga e payload grande.
- Restore cria nova versão e não apaga histórico.
- `GET /das` reflete o modelo após edição no canvas.
- Compatibilidade das rotas antigas de `elements`/`edges`/`diagrams`.

### 9.3 Frontend

- Abas de views, drill-down, badges.
- Editor do DAS: editar seção, restaurar, ocultar, regenerar tudo.
- Painel de versões: listar, comparar, restaurar.
- Validação: badges e navegação para o item.

### 9.4 E2E (mínimo)

1. Criar modelo → desenhar no canvas → aguardar persistência → recarregar →
   modelo e DAS iguais.
2. Editar DAS → regenerar → edição preservada.
3. Criar duas versões com mudanças → restaurar a primeira → modelo e DAS
   voltam.
4. Importar draw.io → view criada → DAS inclui elementos.

### 9.5 Carga

- Modelo com 500 elementos / 800 relações / 10 views:
  - projeção < 2s;
  - `GET /model` < 500ms;
  - geração de DAS < 5s.

## 10. Critérios de aceite

- [ ] Canvas e DAS mostram os mesmos elementos e relações após restart.
- [ ] Nenhuma edição manual do DAS é perdida em regeneração.
- [ ] Overrides do DAS são visíveis, restauráveis e exportados.
- [ ] Versões só são criadas quando `content_hash` muda.
- [ ] Retenção de 30 versões automáticas funciona; manuais são preservadas.
- [ ] Restore cria nova versão e restaura modelo + views + DAS.
- [ ] `model_state` sobrevive a restart do realtime e à perda do volume de
      snapshots.
- [ ] Rotas antigas continuam respondendo com o mesmo contrato.
- [ ] Backfill cobre ≥ 95% dos modelos; os demais estão documentados.
- [ ] Nenhum erro 5xx novo por 7 dias após o cutover.
- [ ] `apps/web/src/App.tsx` < 300 linhas e features separadas.
- [ ] CI roda typecheck e testes em todo PR.
- [ ] Worker não cria mais tabelas.

## 11. Riscos e mitigação

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Migração lossy de XML para modelo | Alta | Médio | XML mantido como artefato; marcar `legacy`; revisão manual dos modelos principais |
| Projetor divergir do Yjs | Média | Alto | Modo sombra, reconciliação diária, testes de idempotência |
| Perda de edição do DAS no backfill | Média | Alto | Diff por seção; backup; overrides `document` como fallback |
| Conflito restore × edição ao vivo | Média | Médio | Bloqueio curto do modelo, aviso aos editores, versão `restore` |
| Performance do `GET /model` | Média | Médio | Cache por hash, paginação de elementos, índice por modelo |
| Usuários não entenderem “view” | Média | Baixo | Manter vocabulário “Contexto/Container/Componente”; onboarding curto |
| Duas fontes durante transição | Alta | Médio | Flags, fallback, telemetria de divergência |
| Schema duplicado (worker/API) | Média | Médio | M1 centraliza; M6 remove worker |
| Aumento de latência do realtime | Baixa | Médio | Debounce, flush assíncrono, batch |
| Snapshot grande em `model_state` | Baixa | Médio | Compressão, limite de tamanho, alerta |

## 12. Rollback

### 12.1 Por fase

- **M1:** `DROP` das tabelas novas e colunas adicionadas; nenhuma leitura
  depende delas.
- **M2:** desligar `CANONICAL_MODEL=off`; backfill é aditivo, não altera legado.
- **M3:** desligar `PROJECTOR_SHADOW`, `DAS_OVERRIDES`, `VERSION_HASH`; voltar a
  `regenerateModelDAS` antigo (mantido atrás da flag). `model_state` pode ficar
  sem uso.
- **M4:** UI nova atrás de flag; voltar para `App.tsx` antigo (mantido no
  branch de release).
- **M5:** `CANONICAL_MODEL=off`, `REALTIME_PG_STATE=off`; realtime volta a ler
  do disco. Reconciliar `model_versions` se necessário.
- **M6:** não há rollback trivial; executar só após 2 semanas estáveis.

### 12.2 Critérios de rollback imediato

- Perda ou corrupção de modelo em produção.
- Divergência canvas ↔ DAS acima de 1% dos modelos ativos.
- Falha de projeção contínua por > 15 min.
- Erro 5xx acima de 2% por 10 min.
- Restore corrompendo modelo.

### 12.3 Dados

- Backup pré-M1 e pré-M5.
- Snapshots de disco preservados por 30 dias após o cutover.
- `model_versions` antigas mantidas para leitura mesmo após a migração.

## 13. Ordem de implementação sugerida

| Ordem | Item | Depende de |
|---|---|---|
| 1 | Flags, CI, `.gitignore`, remoção do snapshot do Git | — |
| 2 | DDL (M1) | 1 |
| 3 | Mapeadores e backfill (M2) | 2 |
| 4 | `model_state` + `PUT /internal/state` | 2 |
| 5 | Projetor idempotente | 3, 4 |
| 6 | DAS com overrides | 3 |
| 7 | Versões por hash + restore | 3 |
| 8 | Endpoints de views/layout/validação | 3 |
| 9 | Split do frontend | 1 |
| 10 | UI de views, DAS, versões, validação | 8, 6, 7 |
| 11 | Cutover e monitoração | todos |
| 12 | Limpeza (M6) | 11 |

## 14. Definition of Done da Onda 1

- Modelo canônico é a única fonte lógica.
- `model_state` é durável no Postgres.
- Projetor é o único escritor das tabelas canônicas.
- DAS é projeção com overrides preservados.
- Versões são por conteúdo, com retenção, autor, label e restore.
- UI separada por features, com views, badges e painel de versões.
- Rotas antigas funcionando ou descontinuadas com aviso.
- Documentação, ADRs e código contam a mesma história.
- CI verde e critérios de aceite atendidos.

## 15. Referências

- `docs/ANALISE-STRUCTURIZR.md`
- `docs/ADR/ADR-0021-modelo-canonico-fonte-unica.md`
- `docs/ADR/ADR-0022-views-projecoes-do-modelo.md`
- `docs/ADR/ADR-0023-das-projecao-overrides.md`
- `docs/ADR/ADR-0024-versionamento-restauravel.md`
- `apps/api/src/db/migrate.ts`
- `apps/api/src/controllers/models.controller.ts`
- `apps/api/src/c4/das.ts`
- `apps/api/src/c4/diagrams.ts`
- `apps/realtime/src/sync.ts`
- `apps/worker/src/index.ts`
- `apps/web/src/App.tsx`
