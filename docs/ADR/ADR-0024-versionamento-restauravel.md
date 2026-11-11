# ADR-0024 — Versionamento restaurável e persistência do estado colaborativo

- **Status:** Adotada (aprovada em 11/11/2026; implementação na Onda 1)
- **Data:** 11/11/2026 — time C4Arch
- **Relaciona-se com:** ADR-0001 (Yjs), ADR-0002 (storage adapter), ADR-0010
  (merge parcial), ADR-0021 (modelo canônico), ADR-0023 (DAS com overrides)
- **Substitui:** o comportamento atual do worker de criar uma versão a cada 30s
  sem deduplicação, retenção ou restauração

## Contexto

Hoje o versionamento do C4Arch é um efeito colateral do worker:

```text
Canvas ──► Yjs (memória) ──► snapshot JSON em disco
                                      │
                                      ▼
                            worker, a cada 30s
                                      │
                                      ▼
                         INSERT INTO model_versions
                         (model_id, version, snapshot)
```

Problemas observados:

1. **Versão a cada 30 segundos, mesmo sem mudança.** `syncSnapshots`
   (`apps/worker/src/index.ts`) percorre todos os arquivos de snapshot e insere
   uma linha nova. Um modelo parado gera 2.880 versões por dia.
2. **Sem hash de conteúdo.** Não há como saber se duas versões são iguais nem
   pular gravações.
3. **Sem retenção.** O Structurizr mantém 30 versões por padrão; o C4Arch
   mantém todas, para sempre.
4. **Sem autor.** `created_by` existe na tabela, mas o worker não sabe quem
   editou — ele copia um arquivo.
5. **Sem label ou descrição.** Não há “marco” significativo (“entrega da
   sprint”, “baseline aprovada”).
6. **Sem API nem UI de restauração.** O histórico existe, mas é inútil para o
   usuário.
7. **Estado colaborativo não é durável no Postgres.** O snapshot vive em disco
   (`apps/realtime/src/sync.ts`, `saveSnapshot`/`loadStorageModels`). Um volume
   perdido ou um deploy sem o volume certo apaga o estado ativo.
8. **Dois donos do schema.** O worker cria `model_versions`,
   `model_version_counters` e `integrations` por conta própria, diferentes das
   migrações da API (`apps/api/src/db/migrate.ts`).
9. **Snapshot de runtime no Git.** `apps/api/storage/34d6c940-....json` está
   versionado, o que mistura dado de execução com código.

Sem versionamento confiável, o modelo “vivo” não tem rede de proteção: um erro
de edição, uma regeneração de DAS ou um merge ruim não têm volta.

## Decisão

### 1. Estado colaborativo durável em `model_state`

O documento Yjs deixa de depender exclusivamente de disco:

```text
model_state
  model_id     UUID PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE
  state        BYTEA NOT NULL          -- update Yjs codificado (Y.encodeStateAsUpdate)
  state_vector BYTEA                   -- para sync incremental
  content_hash TEXT NOT NULL           -- sha256 do estado canônico serializado
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL
  revision     BIGINT NOT NULL DEFAULT 0
```

- O realtime grava `model_state` em **intervalos com debounce** (padrão: 2s
  após a última operação, e no máximo a cada 15s durante edição contínua).
- O snapshot em disco continua existindo como cache local/backup, mas **não é
  mais a fonte de verdade**.
- Ao subir, o realtime carrega de `model_state`; se não existir, cai para o
  snapshot em disco e faz backfill.
- `PUT /api/internal/models/:id/state` recebe o estado do realtime, protegido
  por token interno. A API é a única dona do schema e do projetor.

### 2. Projetor idempotente

Um único componente escreve nas tabelas canônicas (ADR-0021):

```text
realtime ──► model_state ──► projetor ──► model_elements / model_relationships / model_views
```

- O projetor lê o estado Yjs, calcula o modelo canônico e faz upsert por ID
  estável.
- É **idempotente**: aplicar o mesmo estado duas vezes não muda nada.
- É **incremental quando possível**: usa `state_vector` para diff, mas faz
  reconciliação completa em caso de dúvida.
- É acionado por debounce (padrão: 3s) e por um job periódico de segurança.
- Registra `projected_revision` e `projected_hash` para evitar reprocessamento.

### 3. Versões por conteúdo, não por tempo

`model_versions` evolui para:

```text
model_versions
  id            UUID PK
  model_id      UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE
  version       INTEGER NOT NULL
  snapshot      JSONB NOT NULL          -- modelo canônico + views + layout + overrides
  content_hash  TEXT NOT NULL           -- sha256 do snapshot normalizado
  author_id     UUID REFERENCES users(id) ON DELETE SET NULL
  label         TEXT                    -- 'baseline', 'entrega-sprint-12', ...
  description   TEXT
  kind          TEXT NOT NULL DEFAULT 'auto'
                CHECK (kind IN ('auto','manual','restore','import'))
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  UNIQUE (model_id, version)
  -- índice único parcial em (model_id, content_hash)
  -- WHERE content_hash IS NOT NULL (permite versões legadas sem hash)
```

Regras:

- **Só cria versão quando o `content_hash` muda.**
- **Versões automáticas** são criadas no máximo a cada 5 minutos por modelo
  (debounce + hash), não a cada 30s.
- **Versões manuais** (`kind = 'manual'`) podem ter label e descrição e nunca
  são removidas pela retenção.
- **Versões de restauração** (`kind = 'restore'`) registram de qual versão
  vieram, em `description`.
- **Retenção padrão: 30 versões automáticas por modelo**, configurável por
  organização (`org_settings.version_retention`). Manuais e a última versão de
  cada dia ficam preservadas.
- O snapshot passa a ser o **modelo canônico serializado** (elementos, relações,
  views, layout, overrides de DAS), não o arquivo Yjs bruto. Isso torna a
  restauração independente do formato colaborativo.

### 4. Restauração de primeira classe

```text
GET  /api/models/:id/versions                 → lista paginada (sem snapshot)
GET  /api/models/:id/versions/:version        → metadados + snapshot
POST /api/models/:id/versions/:version/restore → cria nova versão 'restore'
POST /api/models/:id/versions                 → cria versão manual com label
PATCH /api/models/:id/versions/:version       → edita label/descrição
```

- Restaurar **não apaga** o histórico: cria uma nova versão com o conteúdo da
  versão escolhida.
- A restauração atualiza `model_state`, o modelo canônico e o DAS renderizado
  na mesma transação lógica, e notifica o realtime para recarregar o documento.
- A UI mostra diff resumido (elementos/relações/views adicionados, removidos e
  alterados) antes de confirmar.
- Permissão: `editor` pode criar versão manual e restaurar; `viewer` só lê.

### 5. Um único dono do schema

- Todas as tabelas passam a ser criadas por `apps/api/src/db/migrate.ts` (ou por
  migrações versionadas, na Onda 3).
- O worker **não cria tabelas**. Ele apenas executa jobs: sincronização de
  integrações e criação de versões automáticas.
- `model_version_counters` é substituído por `MAX(version) + 1` dentro de
  transação com `SELECT ... FOR UPDATE` no modelo, ou por uma sequence por
  modelo. A tabela pode ser mantida temporariamente por compatibilidade.
- `integrations` migra para as migrações da API.

### 6. Higiene operacional

- Remover `apps/api/storage/*.json` do Git e ignorar `storage/`.
- Definir política de backup para `model_state` e `model_versions`.
- Métricas: versões criadas por modelo/dia, tamanho médio de snapshot, tempo de
  projeção, restaurações, falhas de projeção.
- Alertas: projeção atrasada > 60s, `model_state` sem atualização com realtime
  ativo, crescimento anormal de versões.

## Consequências

### Positivas

- Histórico passa a ter significado: muda quando o modelo muda.
- Banco para de crescer sem controle.
- Restauração vira um recurso real, com autor, label e diff.
- Estado colaborativo sobrevive a restart, deploy e perda de volume.
- Um único dono do schema elimina divergências entre API e worker.
- DAS e overrides entram no snapshot versionado, então restaurar o modelo
  restaura o documento também.

### Negativas e riscos

- **Projetor é novo e crítico.** Precisa de testes de idempotência,
  reconciliação e concorrência com edições em tempo real.
- **Latência de persistência:** com debounce, o Postgres fica alguns segundos
  atrás do canvas. Aceitável para durabilidade; o realtime continua sendo a
  fonte em tempo real.
- **Migração de snapshots existentes:** snapshots Yjs antigos precisam ser
  convertidos para o formato canônico. Mitigação: script de migração
  best-effort e manutenção das versões antigas apenas para leitura.
- **Mudança de contrato:** `GET /versions` deixa de devolver snapshots
  completos na lista. A UI precisa buscar o snapshot sob demanda.
- **Retenção pode surpreender:** 30 versões automáticas podem parecer pouco.
  Mitigação: configurável, com manuais preservadas e retenção diária.
- **Concorrência:** restaurar enquanto alguém edita pode gerar conflito. A
  restauração deve bloquear o modelo por alguns segundos e avisar os editores.

### Alternativas descartadas

- **Versionar por tempo (status quo):** gera lixo e não permite saber o que
  mudou.
- **Versionar apenas manualmente:** simples, mas perde proteção contra erros
  entre marcos.
- **Usar Git como backend de versão:** bom para exportação/espelho (Onda 2),
  ruim como fonte transacional e para restore em tempo real.
- **Manter snapshots Yjs como formato de versão:** acopla o histórico ao
  formato colaborativo e dificulta diff, restore e exportação.
- **Deixar o worker como dono do schema:** mantém a divergência atual.

## Plano de adoção

Detalhado em `docs/PLANO-MIGRACAO-ONDA-1.md`:

1. Criar `model_state`, colunas novas em `model_versions` e migrar o schema para
   a API (M1).
2. Realtime grava `model_state` com debounce e fallback para disco (M2).
3. Projetor idempotente em modo sombra, comparando com o estado atual (M3).
4. Worker passa a criar versões por hash e aplica retenção (M3).
5. Endpoints e UI de versões/restore (M4).
6. Projetor vira o caminho oficial; modo sombra é removido (M5).
7. Limpeza: remover tabelas duplicadas do worker, snapshot do Git e
   `model_version_counters` (M6).

## Referências

- `apps/realtime/src/sync.ts` (`applyOperation`, `saveSnapshot`,
  `loadStorageModels`)
- `apps/worker/src/index.ts` (`syncSnapshots`)
- `apps/api/src/db/migrate.ts` (`model_versions`)
- `docs/ADR/ADR-0001-yjs-realtime.md`
- `docs/ADR/ADR-0002-storage-adapter.md`
- `docs/ADR/ADR-0010-realtime-merge-parcial.md`
- `docs/ADR/ADR-0021-modelo-canonico-fonte-unica.md`
- `docs/PLANO-MIGRACAO-ONDA-1.md`
- Structurizr — workspace versions:
  <https://docs.structurizr.com/server/workspace-versions>
