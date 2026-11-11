-- Rollback do M3 (escrita canônica, DAS e versões)
--
-- O M3 é evolutivo: desligar as flags já devolve o comportamento legado sem
-- apagar dados. Este script apenas remove metadados derivados do caminho novo.
-- Nada destrutivo roda por padrão; os blocos opcionais estão comentados.
--
-- Flags a voltar para `off` no ambiente:
--   PROJECTOR_SHADOW=off
--   DAS_OVERRIDES=off
--   VERSION_HASH=off
--   REALTIME_PG_STATE=off
--   CANONICAL_MODEL=off   (já era o padrão no M3)
--
-- Requisitos: parar API, realtime e worker antes de rodar (evita flush
-- concorrente do realtime durante a limpeza).

BEGIN;

-- Metadados do DAS canônico. O `das_content` é preservado para que o modo
-- legado continue servindo o último documento.
UPDATE models
   SET das_source_hash = NULL,
       das_generated_at = NULL,
       das_override_count = 0
 WHERE das_source_hash IS NOT NULL;

-- Os overrides podem permanecer: com DAS_OVERRIDES=off eles são ignorados e
-- voltam a valer se o M3 for religado.
-- DELETE FROM model_das_overrides;

COMMIT;

-- ── Opcional: descartar o estado Yjs durável ─────────────────────────────────
-- Só execute se quiser voltar a usar exclusivamente os snapshots em disco do
-- realtime. O realtime recria `model_state` no próximo flush.
--
-- BEGIN;
-- DELETE FROM model_state;
-- COMMIT;

-- ── Opcional: remover versões criadas por hash/restore ───────────────────────
-- Preserva versões `manual` e `import`. Revise antes de executar.
--
-- BEGIN;
-- DELETE FROM model_versions WHERE kind IN ('auto', 'restore');
-- COMMIT;
