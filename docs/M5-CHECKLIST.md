# C4Arch — Checklist do M5 (cutover)

- **Status:** M5 backend concluído em 11/11/2026 (cutover operacional assistido)
- **Plano:** `docs/PLANO-MIGRACAO-ONDA-1.md`
- **Pré-requisito:** `docs/M4` não implementado; `docs/M3-CHECKLIST.md` aplicado
- **Próxima fase:** M6 (limpeza), não iniciada

## 1. Escopo executado

O M5 torna o caminho canônico a fonte de leitura quando as flags são ligadas,
mantendo fallback legado quando o canônico está vazio/inconsistente.

- `CANONICAL_MODEL=on`: `ModelController.get`, `ElementController.list` e
  `EdgeController.list` passam a servir a partir de
  `model_elements`/`model_relationships`, projetando para o formato legado.
- Dual-write: criação/edição/exclusão de elementos e arestas também atualizam o
  canônico (elementos, relações e layout da view primária).
- `canonicalModelHasData` garante fallback para o legado quando o canônico
  estiver vazio.
- Reconciliação diária via `npm run reconcile:canonical`, comparando
  legado × canônico (e a projeção do estado durável quando ativa).
- Métricas existentes do M2/M3 cobrem divergências e falhas de projeção.

## 2. Flags do cutover

| Flag | Valor no cutover | Efeito |
|---|---|---|
| `CANONICAL_MODEL` | `on` | leitura/gravação canônica com fallback legado |
| `CANONICAL_VIEWS` | `on` (opcional, gradual) | views canônicas |
| `PROJECTOR_SHADOW` | `off` | projetor deixa de comparar; o canônico já é a fonte |
| `REALTIME_PG_STATE` | `on` | `model_state` como fonte durável |
| `DAS_OVERRIDES` | `on` | DAS canônico + overrides |
| `VERSION_HASH` | `on` | versões por hash |

## 3. Arquivos

**Novos**

- `apps/api/src/c4/canonical-access.ts` — leitura e dual-write canônicos.
- `apps/api/src/scripts/reconcile-canonical.ts` — reconciliação diária.
- `docs/M5-CHECKLIST.md` (este arquivo)

**Alterados**

- `apps/api/src/controllers/models.controller.ts` — leitura canônica em `get`.
- `apps/api/src/controllers/elements.controller.ts` — leitura e dual-write.
- `apps/api/src/controllers/edges.controller.ts` — leitura e dual-write.
- `apps/api/package.json` — script `reconcile:canonical`.

## 4. Comandos

```text
npm run typecheck --workspace=@c4arch/api
npm test --workspace=@c4arch/api
npm run reconcile:canonical --workspace=@c4arch/api
```

A reconciliação retorna código 1 quando há divergências ou falhas, para uso em
cron/CI.

## 5. Procedimento de cutover

1. Garantir backfill aplicado (`backfill:canonical`) e sem divergências
   (`shadow:canonical` / `reconcile:canonical`).
2. Ligar `REALTIME_PG_STATE=on` e `VERSION_HASH=on` para o beta.
3. Ligar `CANONICAL_MODEL=on` (e `DAS_OVERRIDES=on`) para o beta.
4. Monitorar por 1 semana: divergência canvas ↔ DAS, falhas de projeção,
   versões/dia, erros 5xx, tempo de geração do DAS.
5. Rodar `reconcile:canonical` diariamente durante 2 semanas.
6. Desligar `PROJECTOR_SHADOW`.

## 6. Evidências locais (11/11/2026)

```text
npm run typecheck --workspace=@c4arch/api  → OK
npm test --workspace=@c4arch/api          → 75 testes aprovados
```

## 7. Rollback

Voltar as flags para `off` (ou `shadow`) e reiniciar os serviços. O legado
permanece intacto e a leitura retorna ao caminho anterior. Use
`scripts/rollback-m3.sql` para limpar metadados derivados, se necessário.

## 8. Limitações conhecidas

- A UI do M4 (abas por view, DAS por seção, painel de versões) não foi
  implementada; este M5 cobre apenas o backend.
- `CANONICAL_VIEWS=on` depende de views canônicas populadas; o frontend ainda
  pode usar `models.diagrams` para desenho.
- O dual-write é best-effort; a reconciliação diária detecta e corrige
  divergências.
- A monitoração de 1 semana é operacional e não automatizada neste repositório.
