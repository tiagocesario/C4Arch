# C4Arch — Checklist do M1 (schema canônico)

- **Status:** M1 concluído em 11/11/2026
- **Plano:** `docs/PLANO-MIGRACAO-ONDA-1.md`
- **Pré-requisito:** `docs/M0-CHECKLIST.md` (backup validado)
- **Próxima fase:** M2 (backfill e leitura em sombra), não iniciada

## 1. Escopo executado

O M1 é **aditivo**: cria o schema canônico e as colunas de versionamento/DAS,
sem alterar o comportamento da API, sem backfill e sem ligar nenhuma flag.

### 1.1 Tabelas criadas

| Tabela | Papel |
|---|---|
| `model_elements` | Elementos canônicos (pessoa, sistema, container, componente, deployment) |
| `model_relationships` | Relações canônicas entre elementos |
| `model_views` | Views como projeções do modelo |
| `model_view_layout` | Layout por view, separado do modelo |
| `model_state` | Estado Yjs durável no Postgres |
| `model_das_overrides` | Overrides manuais do DAS por seção |

### 1.2 Colunas adicionadas

| Tabela | Colunas |
|---|---|
| `models` | `das_generated_at`, `das_source_hash`, `das_override_count` |
| `model_versions` | `content_hash`, `author_id`, `label`, `description`, `kind` |

### 1.3 Índices e restrições

- Índices por `model_id`, `parent_element_id`, `kind`, `source_id`, `target_id`,
  `scope_element_id` e `section_key`.
- Unicidade de `model_elements(model_id, identifier)`.
- Unicidade de `model_views(model_id, key)`.
- Unicidade de `model_das_overrides(model_id, section_key)`.
- Unicidade parcial de layout por `(view_id, element_id)` e
  `(view_id, object_key)`.
- Unicidade parcial de versão por `(model_id, content_hash)`.
- Checks de `kind`, `type`, `mode` e `source_id <> target_id`.

## 2. Aplicação

O schema foi aplicado com a imagem da API reconstruída:

```text
docker compose build api
docker compose run --rm --no-deps api node dist/db/migrate.js
```

Executado **duas vezes** para validar idempotência. Nas duas execuções:

```text
[db] ✓ Migrations aplicadas
```

O CI também ganhou o job `Schema canônico (M1)`, que sobe um Postgres 16
efêmero, aplica as migrações duas vezes e verifica a existência das seis
tabelas novas.

Validação local do job de CI:

```text
actionlint .github/workflows/ci.yml  → OK
Postgres 16 efêmero + imagem c4arch-api:
  node dist/db/migrate.js (1ª vez)   → [db] ✓ Migrations aplicadas
  node dist/db/migrate.js (2ª vez)   → [db] ✓ Migrations aplicadas
  verificação das 6 tabelas          → OK
```

A API em execução **não foi reiniciada**; ela continua no código anterior. O
schema novo é inerte até o M2/M3.

## 3. Verificação no banco

Tabelas encontradas:

```text
model_das_overrides
model_elements
model_relationships
model_state
model_version_counters
model_versions
model_view_layout
model_views
models
```

Colunas novas encontradas:

```text
model_versions.author_id
model_versions.content_hash
model_versions.description
model_versions.kind
model_versions.label
models.das_generated_at
models.das_override_count
models.das_source_hash
```

Índices novos encontrados:

```text
idx_model_das_overrides_model
idx_model_elements_kind
idx_model_elements_model
idx_model_elements_parent
idx_model_relationships_model
idx_model_relationships_source
idx_model_relationships_target
idx_model_versions_hash
idx_model_versions_model_created
idx_model_view_layout_element
idx_model_view_layout_object
idx_model_views_model
idx_model_views_scope
```

## 4. Comportamento e flags

- Nenhuma flag foi ligada: `CANONICAL_MODEL`, `CANONICAL_VIEWS`,
  `DAS_OVERRIDES`, `VERSION_HASH`, `REALTIME_PG_STATE` e `PROJECTOR_SHADOW`
  continuam `off`.
- Nenhum endpoint novo foi exposto.
- Nenhum dado foi migrado ou copiado.
- A API antiga ignora as tabelas e colunas novas.

## 5. Rollback

Script: `scripts/rollback-m1.sql`.

- Remove as seis tabelas novas, os índices e as colunas adicionadas.
- Não toca em `models`, `elements`, `edges` ou `model_versions` existentes,
  exceto pelas colunas novas.
- Deve ser usado apenas antes do M2 ou em janela com backup validado.
- Backup pré-M1: `backups/2026-11-11T13-02-56-584Z/`.

## 6. Arquivos alterados

- `apps/api/src/db/migrate.ts` (DDL do M1)
- `scripts/rollback-m1.sql` (rollback)
- `.github/workflows/ci.yml` (job de schema no Postgres efêmero)
- `docs/M1-CHECKLIST.md` (este arquivo)
- `docs/PLANO-MIGRACAO-ONDA-1.md` (status)
- `docs/M0-CHECKLIST.md` (critérios de entrada)
- `docs/ANALISE-STRUCTURIZR.md` (status)
- `README.md` (lista de documentos)

## 7. Critérios de entrada no M2

- [x] Schema canônico criado.
- [x] Migração idempotente (duas execuções).
- [x] Estrutura verificada no banco.
- [x] Rollback documentado e testável.
- [x] Backup pré-M1 validado.
- [ ] Estratégia de backfill revisada (mapeamento da seção 4 do plano).
- [ ] Feature flag `CANONICAL_MODEL=shadow` pronta para ser ligada.

## 8. Observações

- O worker ainda cria `model_versions`, `model_version_counters` e
  `integrations` por conta própria. A centralização é escopo do M6.
- `model_versions` agora tem `author_id` além de `created_by`; o backfill do M2
  decide como preencher os dois.
- `model_state.state` é `BYTEA`; o endpoint interno e o projetor entram no M3.
- `model_views.key` é o identificador estável da view (`context`, `containers`,
  `components`, ...).
