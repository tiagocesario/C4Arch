# C4Arch — Checklist do M3 (escrita canônica, DAS e versões)

- **Status:** M3 concluído em 11/11/2026
- **Plano:** `docs/PLANO-MIGRACAO-ONDA-1.md`
- **Pré-requisito:** `docs/M2-CHECKLIST.md` (backfill e leitura em sombra)
- **Próxima fase:** M4 (UI), não iniciada

## 1. Escopo executado

O M3 prepara a escrita canônica sem trocar a leitura servida ao usuário. A
virada de leitura continua no M5.

- Estado colaborativo durável em `model_state`, gravado pelo realtime com
  debounce de 2s e flush periódico de 15s.
- Projetor idempotente `model_state` → tabelas canônicas, em `shadow` (compara)
  ou `on` (aplica).
- DAS gerado a partir do canônico, com overrides por seção e
  `das_source_hash`.
- `PUT /das` converte a edição em overrides quando `DAS_OVERRIDES` está ligado.
- Worker cria versões por hash, no máximo a cada 5 minutos, com retenção de 30
  versões automáticas.
- Endpoints de listagem, detalhe e restauração de versões.
- Restore grava `model_state`, legado e (com flag canônica) o canônico, além de
  uma versão `kind='restore'`.

Todas as flags continuam com padrão `off`; nenhum comportamento legado muda
quando elas estão desligadas.

## 2. Flags do M3

| Flag | `off` | `shadow` | `on` |
|---|---|---|---|
| `PROJECTOR_SHADOW` | não projeta | compara `model_state` × canônico | aplica o snapshot no canônico |
| `DAS_OVERRIDES` | `das_content` legado | grava overrides e compara a geração | DAS canônico + overrides |
| `VERSION_HASH` | versão a cada 30s (arquivo) | calcula/loga hash, mantém escrita legada | versão por hash (máx. 5 min) |
| `REALTIME_PG_STATE` | snapshot em disco | grava disco + `model_state` | `model_state` |

`CANONICAL_MODEL` continua controlando a leitura em sombra do M2 e é consultado
pelo restore para decidir se o canônico também é reescrito.

## 3. Arquitetura aplicada

### 3.1 Estado durável (`model_state`)

- O realtime envia o update Yjs em base64 para
  `PUT /api/internal/models/:id/state`.
- A API valida o update, calcula `content_hash` a partir da visão lógica
  (`elements` + `edges`), grava `state`, `state_vector` e incrementa `revision`.
- Na hidratação, o realtime tenta primeiro `GET /api/internal/models/:id/state`;
  se não houver estado, cai para o endpoint legado do modelo.
- O flush periódico (`flushAllStates`) e o shutdown cobrem sessões longas e
  quedas de conexão.
- As rotas internas só são montadas quando `API_TOKEN_REALTIME` está definido;
  sem token, respondem 404. A comparação usa `timingSafeEqual`.

### 3.2 Projetor

`apps/api/src/c4/projector.ts`:

1. lê `model_state` e decodifica o Yjs;
2. monta o snapshot canônico esperado com `layoutFromXml: false` (o layout vem
   do Yjs, não do XML draw.io);
3. preserva `parent_element_id` existente quando o Yjs não trouxe hierarquia;
4. em `shadow`, compara com `loadCanonicalSnapshot` e registra divergências;
5. em `on`, aplica o snapshot em transação e confere o resultado.

O legado (`elements`/`edges`) não é escrito pelo projetor.

### 3.3 DAS canônico

`apps/api/src/c4/das-canonical.ts`:

- usa o mesmo template de `das.ts`, mas elementos/relações vêm de
  `model_elements`/`model_relationships`;
- o XML draw.io permanece apenas nas seções visuais de diagramas
  (`aggregateXml: false`);
- aplica overrides por seção (`replace`, `append`, `hide`, `document`);
- calcula `das_source_hash` com o hash do modelo + overrides;
- evita regravar quando o hash não mudou (`writeCanonicalDas`).

`apps/api/src/c4/das-service.ts` faz o dispatch por flag. Controllers e startup
importam de `das-service.ts`, mantendo a API estável.

### 3.4 Versões e restore

`apps/api/src/c4/versions.ts`:

- `GET /api/models/:id/versions` lista as versões (com autor e tamanho);
- `GET /api/models/:id/versions/:versionId` devolve o snapshot completo;
- `POST /api/models/:id/versions/:versionId/restore` restaura o snapshot;
- o restore normaliza elementos/arestas para o legado, reescreve
  `model_state` e grava uma versão `restore` (idempotente por hash);
- a restauração do canônico acontece quando `CANONICAL_MODEL` ou
  `PROJECTOR_SHADOW` não estão `off`.

### 3.5 Worker

- `VERSION_HASH=off`: caminho anterior, snapshot em disco a cada 30s.
- `VERSION_HASH=shadow`: calcula o hash do snapshot e loga; não muda a escrita.
- `VERSION_HASH=on`: lê `model_state`, cria versão só quando o hash muda e
  respeita o intervalo mínimo de 5 minutos; retém as 30 versões `auto` mais
  recentes.

## 4. Endpoints

| Método | Rota | Autenticação |
|---|---|---|
| `PUT` | `/api/internal/models/:id/state` | token interno (`API_TOKEN_REALTIME`) |
| `GET` | `/api/internal/models/:id/state` | token interno |
| `GET` | `/api/models/:id/versions` | sessão |
| `GET` | `/api/models/:id/versions/:versionId` | sessão |
| `POST` | `/api/models/:id/versions/:versionId/restore` | sessão + owner/editor |

O `PUT /api/models/:id/das` continua aceitando `{ "content": "..." }`; com
`DAS_OVERRIDES` ligado ele responde também `changedKeys`, `sourceHash` e
`overrideCount`.

## 5. Arquivos

**Novos**

- `apps/api/src/c4/state.ts`
- `apps/api/src/c4/projector.ts`
- `apps/api/src/c4/das-canonical.ts`
- `apps/api/src/c4/das-service.ts`
- `apps/api/src/c4/versions.ts`
- `apps/api/src/controllers/internal.controller.ts`
- `apps/api/src/routes/internal.routes.ts`
- `apps/api/test/state.test.ts`
- `apps/api/test/das-overrides.test.ts`
- `apps/api/test/m3.integration.test.ts`
- `scripts/rollback-m3.sql`
- `docs/M3-CHECKLIST.md` (este arquivo)

**Alterados**

- `apps/api/src/c4/canonical.ts` — limites de linha em `parseDasSections` e
  `applyDasOverrides`.
- `apps/api/src/c4/backfill.ts` — `layoutFromXml` no snapshot.
- `apps/api/src/c4/das.ts` — opção `aggregateXml`.
- `apps/api/src/controllers/models.controller.ts` — overrides no `PUT /das` e
  endpoints de versões.
- `apps/api/src/routes/models.routes.ts` — rotas de versões.
- `apps/api/src/server.ts` — parser maior para o estado e mount das rotas
  internas.
- `apps/api/src/config.ts` — `internalToken`.
- `apps/api/src/index.ts` — projetor no startup.
- `apps/api/src/observability/metrics.ts` — métricas do projetor.
- `apps/api/src/db/migrate.ts` — `model_version_counters`.
- `apps/api/package.json` — `yjs`, `test:m3`.
- `apps/realtime/src/sync.ts` — persistência, hidratação e flush do estado.
- `apps/realtime/src/index.ts` — flush periódico.
- `apps/worker/src/index.ts` — versionamento por hash e retenção.
- `docker-compose.yaml` e `compose.production.yaml` — token no serviço API.
- `.github/workflows/ci.yml` — etapa `test:m3`.
- `docs/PLANO-MIGRACAO-ONDA-1.md` — status do M3.

## 6. Comandos

```text
npm test --workspace=@c4arch/api
RUN_M3_TESTS=true npm run test:m3 --workspace=@c4arch/api
npm run typecheck
npm run build
```

O teste de integração exige `RUN_M3_TESTS=true` e um Postgres descartável
(`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`).

## 7. Evidências locais (11/11/2026)

```text
npm test --workspace=@c4arch/api                          → 75 testes aprovados
npm test --workspace=@c4arch/realtime                     → 6 testes aprovados
RUN_M3_TESTS=true npm run test:m3 --workspace=@c4arch/api → 10 testes aprovados
npm run typecheck                                         → OK
npm run build                                             → OK
```

O `test:m3` rodou contra Postgres 16 efêmero (porta 55433), cobrindo:

- round-trip e hash estável do estado Yjs;
- overrides `replace`/`append`/`hide` e diff por seção;
- projetor em sombra sem divergências após o backfill;
- divergência detectada sem escrita e aplicação em `on`;
- DAS canônico e gravação de overrides;
- restore do legado, de `model_state` e criação da versão `restore`.

## 8. Rollback

Desligue as flags no ambiente e reinicie os serviços. O script
`scripts/rollback-m3.sql` limpa apenas metadados derivados
(`das_source_hash`, `das_generated_at`, `das_override_count`) e mantém
`das_content`, `model_state`, overrides e versões. Blocos destrutivos estão
comentados e exigem decisão explícita.

## 9. Limitações conhecidas

- O Yjs atual não carrega geometria de contenção nem `parentId`; o projetor
  preserva a hierarquia já existente por ID.
- O restore do canônico só roda com `CANONICAL_MODEL` ou `PROJECTOR_SHADOW`
  diferentes de `off`; com tudo desligado ele restaura `model_state` e o legado.
- O worker em `VERSION_HASH=on` depende da rota interna da API; se ela estiver
  indisponível, o ciclo é ignorado e tentado novamente no próximo intervalo.
- A UI de DAS por seção, painel de versões e diff ficam para o M4; o M3 entrega
  apenas a API e a persistência.
