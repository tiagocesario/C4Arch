# C4Arch — Checklist do M2 (backfill e leitura em sombra)

- **Status:** M2 concluído em 11/11/2026
- **Plano:** `docs/PLANO-MIGRACAO-ONDA-1.md`
- **Pré-requisito:** `docs/M1-CHECKLIST.md` (schema canônico aplicado)
- **Próxima fase:** M3 (escrita canônica, DAS e versões), não iniciada

## 1. Escopo executado

O M2 é **evolutivo e aditivo**:

- copia o legado (`elements`, `edges`, `models`, XMLs draw.io, versões e
  `das_content`) para as tabelas canônicas criadas no M1;
- mantém o legado como fonte de leitura e **não altera nenhuma resposta da API**;
- compara legado × canônico em modo sombra (`CANONICAL_MODEL=shadow`) e registra
  divergências sem trocar o payload;
- não liga escrita canônica, projetor, overrides em runtime nem versionamento por
  hash — isso é escopo do M3.

Nenhuma flag foi ligada. O padrão continua `off` para `CANONICAL_MODEL`,
`CANONICAL_VIEWS`, `DAS_OVERRIDES`, `VERSION_HASH`, `REALTIME_PG_STATE` e
`PROJECTOR_SHADOW`.

## 2. Mapeamento aplicado

### 2.1 Elementos

| Legado | Canônico | Regra |
|---|---|---|
| `elements.id` | `model_elements.id` | UUID preservado |
| `elements.type = actor` | `kind = person` | mapeamento |
| `elements.type = system` | `kind = software_system` | mapeamento |
| `elements.type = container/component` | `kind` igual | direto |
| `elements.title` | `name` | `trim` |
| `elements.description` | `description` | vazio vira `NULL` |
| `metadata.technology`/`tech` | `technology` | extraído |
| `metadata.url` | `url` | extraído |
| `metadata.tags` | `tags` | array ou CSV |
| restante de `metadata` | `properties` | preservado + `legacyType` |
| `app_id`, `service_id` | iguais | direto |
| `position_x`/`position_y` | `model_view_layout` | view primária, quando o XML não posiciona |
| — | `identifier` | slug do nome + 8 primeiros caracteres do UUID |
| — | `parent_element_id` | inferido por contenção geométrica no XML primário |

A hierarquia é inferida de forma conservadora: o menor shape que contém
geometricamente o filho e tem nível C4 imediatamente superior vira pai. Sem
contenção válida, `parent_element_id` fica `NULL`.

### 2.2 Relações

| Legado | Canônico | Regra |
|---|---|---|
| `edges.id` | `model_relationships.id` | UUID preservado |
| `edges.from_id`/`to_id` | `source_id`/`target_id` | direto |
| `edges.label` | `description` | direto |
| `[Tecnologia]` no rótulo | `technology` | última ocorrência entre colchetes |
| `edges.type` | `properties.legacyType` | preservado |

Relações com `from_id = to_id` ou com extremidade inexistente são ignoradas com
warning (`RELATIONSHIP_SELF` / `RELATIONSHIP_DANGLING`), pois violam as restrições
canônicas. O legado permanece intacto.

### 2.3 Views e layout

- Uma view por tipo em `models.c4_type` + `models.diagrams`, com chave estável
  igual ao `c4Type` legado.
- Tipos: `system-context` → `system_context`; `system-landscape` → `filtered`;
  `code` → `component` (preservando a chave `code`); demais diretos.
- `scope_element_id` é inferido por nome/identifier de `c4_scope` (ou do modelo
  pai), considerando o tipo da view. Ambiguidade ou incompatibilidade gera
  warning e mantém `NULL`.
- Layout extraído do XML draw.io (inclusive diagramas comprimidos): posição,
  tamanho e estilo. Formas sem elemento relacional correspondente viram
  `model_view_layout.object_key`, preservando anotações visuais.
- A view primária também recebe `position_x`/`position_y` do editor relacional
  quando o XML não trouxe posição para o elemento.

### 2.4 DAS

- O DAS legado é comparado com o DAS regenerado pelo template atual.
- Apenas seções folha realmente editadas viram `model_das_overrides` com
  `mode = replace`.
- Seções voláteis (`1` e `10`) são ignoradas.
- Sem seções reconhecíveis, o documento inteiro vira override `document`
  (fallback previsto na ADR-0023).
- Overrides são inseridos com `ON CONFLICT DO NOTHING`; o backfill nunca
  sobrescreve edição existente.
- `models.das_source_hash` e `models.das_override_count` são recalculados a
  partir do conteúdo canônico efetivamente gravado.

### 2.5 Versões

- `content_hash` é calculado a partir de `model_versions.snapshot`.
- Versões com snapshot repetido ficam com `content_hash NULL` e são marcadas
  como duplicadas no relatório.
- `author_id` é preenchido a partir de `created_by`.
- Hashes já existentes são respeitados (`COALESCE`), assim como
  `author_id` e `kind`.

## 3. Arquivos criados/alterados

**Novos**

- `apps/api/src/c4/canonical.ts` — mapeadores puros, identifiers, metadata,
  views, hashes estáveis e seções/diff de DAS.
- `apps/api/src/c4/diagram-layout.ts` — extração de geometria/estilo do XML
  draw.io.
- `apps/api/src/c4/backfill.ts` — snapshot puro, carga do legado e aplicação
  transacional.
- `apps/api/src/c4/shadow.ts` — comparação legado × canônico, relatório e
  `runShadowCheck`.
- `apps/api/src/scripts/backfill-canonical.ts` — CLI de backfill.
- `apps/api/src/scripts/shadow-canonical.ts` — CLI de sombra.
- `apps/api/test/canonical.test.ts`
- `apps/api/test/diagram-layout.test.ts`
- `apps/api/test/backfill.test.ts`
- `apps/api/test/shadow.test.ts`
- `apps/api/test/m2.integration.test.ts`
- `apps/api/test/fixtures/m2.ts`
- `scripts/rollback-m2.sql`
- `docs/M2-CHECKLIST.md` (este arquivo)

**Alterados**

- `apps/api/src/c4/das.ts` — extração de `loadDasAssets`, reutilizada pelo
  backfill.
- `apps/api/src/controllers/models.controller.ts` — `ModelController.get` chama
  `runShadowCheck` **depois** de `res.json`, apenas quando
  `CANONICAL_MODEL=shadow`.
- `apps/api/src/observability/metrics.ts` — métricas de sombra.
- `apps/api/package.json` — `test:m2`, `backfill:canonical`, `shadow:canonical`.
- `.github/workflows/ci.yml` — etapa de backfill/sombra no Postgres efêmero.
- `docs/PLANO-MIGRACAO-ONDA-1.md` — status do M2.
- `docs/M1-CHECKLIST.md` — critérios de entrada no M2 atendidos.
- `README.md` — lista de documentos.

## 4. Comandos

### 4.1 Backfill

```text
npm run backfill:canonical --workspace=@c4arch/api -- --dry-run
npm run backfill:canonical --workspace=@c4arch/api -- --model <uuid>
npm run backfill:canonical --workspace=@c4arch/api -- --report <arquivo.json>
```

O script aplica as migrações antes de rodar, trabalha em transação por modelo e
faz `prune` das linhas canônicas fora do snapshot atual. O legado nunca é
alterado.

### 4.2 Leitura em sombra

```text
npm run shadow:canonical --workspace=@c4arch/api
npm run shadow:canonical --workspace=@c4arch/api -- --model <uuid>
npm run shadow:canonical --workspace=@c4arch/api -- --fail-on-divergence
```

Na API em execução, basta definir `CANONICAL_MODEL=shadow`. A resposta continua
vindo do legado; a comparação roda em background e alimenta logs e métricas.

### 4.3 Testes

```text
npm test --workspace=@c4arch/api
RUN_M2_TESTS=true npm run test:m2 --workspace=@c4arch/api
npm run typecheck --workspace=@c4arch/api
```

O teste de integração exige `RUN_M2_TESTS=true` e um Postgres descartável
(`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`).

## 5. Evidências locais (11/11/2026)

### 5.1 Testes

```text
npm test --workspace=@c4arch/api                         → 66 testes aprovados
RUN_M2_TESTS=true npm run test:m2 --workspace=@c4arch/api → 30 testes aprovados
npm run typecheck --workspace=@c4arch/api                 → OK
```

O job `test:m2` rodou contra Postgres 16 efêmero na porta 55432, cobrindo
backfill idempotente, hashes de versão, overrides de DAS, hierarquia, layout e
comparação em sombra sem divergências.

### 5.2 Backfill no banco local

Relatórios: `backups/m2-dry-run.json`, `backups/m2-backfill.json` e
`backups/m2-shadow.json` (ignorados pelo Git).

```text
3 modelos, 3 aplicados, 0 falhas
C4 Model Janis: 1 view, 590 posições de layout
Gold:           2 views, 6 posições de layout
teste:          1 view, 0 posições de layout
```

Totais após a aplicação:

```text
model_views           4
model_view_layout     596
model_elements        0
model_relationships   0
model_das_overrides   0
model_state           0
```

Uma segunda execução manteve exatamente os mesmos totais (idempotência).
`das_source_hash` foi preenchido nos 3 modelos e `das_override_count = 0`.

O banco local tem 0 `elements`, 0 `edges` e 0 `model_versions`; por isso o
backfill local só populou views e layout. O caminho de elementos, relações,
versões e overrides foi validado pelo teste de integração com dados
representativos.

### 5.3 Leitura em sombra

```text
[shadow] modelo fe3447d9-…: ok (elementos=0, relações=0, views=1, layout=590)
[shadow] modelo 0ba79140-…: ok (elementos=0, relações=0, views=2, layout=6)
[shadow] modelo e4fdc8c8-…: ok (elementos=0, relações=0, views=1, layout=0)
```

3/3 modelos sem divergências.

## 6. Limitações conhecidas

- **Formas sem elemento relacional** permanecem apenas como layout
  (`object_key`) até o projetor do M3. `model_elements` não é inventado a partir
  do XML.
- **Hierarquia** depende de contenção geométrica no XML primário. Diagramas sem
  containers desenhados ou com sobreposição podem ficar sem pai; o warning não é
  emitido para esse caso.
- **Escopo** é heurístico (nome/identifier + tipo da view). Nomes duplicados ou
  escopos que não são elementos geram warning e `scope_element_id NULL`.
- **DAS** só vira override quando difere do template atual. Textos antigos
  gerados por versões anteriores do template podem produzir overrides amplos;
  o fallback `document` preserva o conteúdo, mas não é granular.
- **Versões duplicadas** ficam com `content_hash NULL` por decisão de schema;
  não são deduplicadas nem apagadas.
- **Layout** é best-effort: estilos são guardados como string draw.io em
  `style.drawio`; o projetor do M3 decide como servi-los.
- **Performance**: o backfill é sequencial por modelo e por linha. Para volumes
  grandes, o M3/M5 deve avaliar batch e índices adicionais.
- O `ModelController.get` dispara a comparação em background; em modelos muito
  grandes isso adiciona carga ao Postgres após a resposta.

## 7. Rollback

- **Desligar a sombra:** `CANONICAL_MODEL=off` (ou remover a variável) e
  reiniciar a API. Nenhuma resposta muda.
- **Remover os dados canônicos de um modelo:** `scripts/rollback-m2.sql`,
  informando o `model_id`. O script apaga apenas linhas de `model_elements`,
  `model_relationships`, `model_views`, `model_view_layout` e
  `model_das_overrides` do modelo, e zera `das_source_hash`/
  `das_override_count`/`das_generated_at`. `models`, `elements`, `edges` e
  `model_versions` não são apagados.
- **Remover o schema inteiro:** `scripts/rollback-m1.sql` (somente antes do M3).
- **Backup pré-M2:** `backups/2026-11-11T13-48-39-633Z/` (`db.dump` 113.744
  bytes e `storage.tar.gz` 264 bytes), com `gitCommit`
  `8b4412ef7d51d1bd67821895f79a05240e39a05a`.

## 8. Critérios de entrada no M3

- [x] Backfill idempotente e transacional por modelo.
- [x] Leitura em sombra sem alterar a resposta legada.
- [x] Relatório de divergências por modelo.
- [x] Mapeamento de elementos, relações, views, layout, DAS e versões.
- [x] Testes unitários e de integração do M2.
- [x] CI com Postgres efêmero para schema e M2.
- [x] Rollback documentado.
- [ ] `PUT /api/internal/models/:id/state` e gravação de `model_state`.
- [ ] Projetor idempotente (`PROJECTOR_SHADOW=on`).
- [ ] DAS lendo do canônico e aplicando overrides em runtime.
- [ ] Versões por hash no worker e endpoints de restore.
