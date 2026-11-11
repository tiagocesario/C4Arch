# C4Arch — Checklist do M0 (preparação da Onda 1)

- **Status:** M0 concluído em 11/11/2026
- **Plano:** `docs/PLANO-MIGRACAO-ONDA-1.md`
- **ADRs:** `docs/ADR/ADR-0021` a `docs/ADR/ADR-0024` (Adotadas)
- **Próxima fase:** M2 (backfill), após o M1 concluído em `docs/M1-CHECKLIST.md`

## 1. Decisões aprovadas

| # | Decisão | Resposta |
|---|---|---|
| 1 | draw.io | **Adaptador**, não editor canônico; lê/escreve via IDs estáveis |
| 2 | Git/Drive | **Integração opcional** (espelho/histórico), nunca fonte de verdade |
| 3 | Rigor C4 | **Hierarquia completa + inspections**, UX simples; dynamic/deployment na Onda 2 |
| 4 | Modelo de produto | **Self-host**; não é SaaS multi-tenant nesta fase |

## 2. Tarefas do M0

| # | Tarefa | Status | Evidência |
|---|---|---|---|
| 1 | Criar feature flags | **Concluído** | `apps/api/src/flags.ts`, `apps/realtime/src/flags.ts`, `apps/worker/src/flags.ts`, `apps/web/src/flags.ts` |
| 2 | Documentar flags no ambiente | **Concluído** | `.env.example`, `docker-compose.yaml`, `compose.production.yaml`, `charts/c4arch` |
| 3 | Backup completo do banco | **Concluído** | `backups/2026-11-11T13-02-56-584Z/db.dump` (92.635 bytes) |
| 4 | Backup dos snapshots | **Concluído** | `backups/2026-11-11T13-02-56-584Z/storage.tar.gz` (264 bytes) |
| 5 | Validar backup | **Concluído** | Cabeçalho `PGDMP`; `pg_restore --list` lista 96 entradas; `tar -tzf` lista os snapshots |
| 6 | Remover snapshot de runtime do Git | **Concluído** | `git rm --cached apps/api/storage/34d6c940-....json`; arquivo local preservado |
| 7 | Ignorar storage e backups | **Concluído** | `.gitignore` com `apps/*/storage/`, `storage/`, `backups/` |
| 8 | CI mínimo | **Concluído** | `.github/workflows/ci.yml` (Node 20, `npm ci`, typecheck, testes) |
| 9 | Telemetria de requests | **Concluído** | `apps/api/src/observability/metrics.ts` + `GET /metrics` |
| 10 | Telemetria de contagem de modelos | **Concluído** | Gauge `c4arch_models_total` preenchido no startup |
| 11 | Telemetria de tamanho de snapshot | **Concluído** | Log do worker com bytes e duração; realtime com `TELEMETRY_VERBOSE=true` |
| 12 | Telemetria de erros de projeção | **Preparado** | Contador `c4arch_projection_errors_total` e `recordProjectionError()`; será chamado pelo projetor no M3 |
| 13 | Remover script de lint quebrado da web | **Concluído** | `apps/web/package.json` não declara mais `eslint .` sem configuração |
| 14 | Congelar mudanças de schema conflitantes | **Em vigor** | Nenhuma alteração de schema no M0; mudanças de schema só no M1 |

## 3. Flags disponíveis

Todas aceitam `off`, `shadow` ou `on`, com padrão `off`.

| Flag | Serviço | Uso |
|---|---|---|
| `CANONICAL_MODEL` | API | Modelo canônico como fonte de leitura/escrita |
| `CANONICAL_VIEWS` | API / web | Views como projeções |
| `DAS_OVERRIDES` | API / web | DAS com overrides por seção |
| `VERSION_HASH` | API / worker | Versionamento por hash |
| `REALTIME_PG_STATE` | API / realtime | Persistência do Yjs em `model_state` |
| `PROJECTOR_SHADOW` | API / worker | Projetor em modo sombra |

No frontend, as flags são `VITE_CANONICAL_VIEWS`, `VITE_DAS_OVERRIDES` e
`VITE_VERSION_HASH`, resolvidas no build do Vite.

## 4. Telemetria

- `GET /metrics` (Prometheus) na API.
- Em produção o endpoint fica **desabilitado por padrão**; ligue com
  `METRICS_ENABLED=true` e exponha apenas na rede interna.
- Métricas disponíveis:
  - `c4arch_http_requests_total`
  - `c4arch_http_request_duration_ms_{count,sum,max}`
  - `c4arch_http_errors_total`
  - `c4arch_models_total`
  - `c4arch_projection_errors_total`
  - `c4arch_uptime_seconds`
- O worker loga `snapshot=<bytes> duração=<ms>` por modelo sincronizado.
- O realtime loga tamanho de snapshot quando `TELEMETRY_VERBOSE=true`.

## 5. Verificação local

Executado em 11/11/2026:

```text
npm run typecheck   → api, web, realtime e worker sem erros
npm test            → 38 testes aprovados (32 API + 6 realtime)
```

O CI reproduz exatamente esses dois comandos em Node.js 20.

## 6. Arquivos alterados/criados no M0

**Flags e telemetria**

- `apps/api/src/flags.ts`
- `apps/api/src/observability/metrics.ts`
- `apps/api/test/flags.test.ts`
- `apps/realtime/src/flags.ts`
- `apps/worker/src/flags.ts`
- `apps/web/src/flags.ts`

**Configuração**

- `.env.example`
- `docker-compose.yaml`
- `compose.production.yaml`
- `charts/c4arch/values.yaml`
- `charts/c4arch/templates/configmap.yaml`
- `apps/web/Dockerfile`
- `.gitignore`
- `.github/workflows/ci.yml`

**Scripts**

- `scripts/backup-onda1.mjs`

**Documentação**

- `docs/M0-CHECKLIST.md` (este arquivo)
- `docs/ANALISE-STRUCTURIZR.md` (decisões aprovadas)
- `docs/PLANO-MIGRACAO-ONDA-1.md` (status)
- `docs/ADR/ADR-0021` a `ADR-0024` (status Adotada)

## 7. Observações operacionais

- As imagens Docker precisam ser reconstruídas para a web receber as flags
  `VITE_*` (`docker compose build web`).
- O chart Helm entrega as flags de backend via ConfigMap. As flags `VITE_*` da
  web são de build e exigem rebuild da imagem.
- O worker ainda mantém as migrações próprias de `model_versions`,
  `model_version_counters` e `integrations`. A remoção é escopo do M6.
- O snapshot local `apps/api/storage/34d6c940-....json` continua no disco, mas
  não é mais versionado.
- O backup pré-M1 está em `backups/` (ignorado pelo Git). Guarde-o fora da
  máquina antes de executar o M1.

## 8. Critérios de entrada no M1

- [x] Backup do banco validado.
- [x] Backup dos snapshots validado.
- [x] Flags disponíveis e documentadas.
- [x] CI mínimo definido.
- [x] Telemetria básica disponível.
- [x] Snapshot de runtime fora do Git.
- [x] Decisões pendentes registradas.
- [x] Janela de manutenção acordada para aplicar o schema (M1). Aplicação
  aditiva em 11/11/2026, sem downtime; ver `docs/M1-CHECKLIST.md`.
- [x] Responsável pelo rollback definido para a janela do M1: time C4Arch;
  script em `scripts/rollback-m1.sql`.

## 9. Rollback do M0

O M0 não altera schema nem comportamento padrão. Para reverter:

1. Reverter os arquivos de flags/configuração deste checklist.
2. Restaurar o snapshot versionado, se necessário:
   `git checkout HEAD -- apps/api/storage/34d6c940-....json`.
3. Reverter o `.gitignore` e o workflow de CI.
4. Nenhum dado de produção precisa ser restaurado, pois o M0 não escreve no
   banco.
