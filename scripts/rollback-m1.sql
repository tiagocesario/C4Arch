-- C4Arch — rollback do M1 (schema canônico)
--
-- ATENÇÃO: destrutivo. Use apenas enquanto o M1 não tiver dados reais nas
-- tabelas novas ou em uma janela de manutenção com backup validado.
--
-- Uso:
--   docker compose exec -T db psql -U c4arch -d c4arch -f /caminho/rollback-m1.sql
--
-- O M1 é aditivo; o rollback remove apenas o que foi criado no M1 e não toca
-- em elements, edges, models (exceto as colunas novas) nem em model_versions
-- existentes.

BEGIN;

-- Views e layout dependem de model_elements; remover na ordem.
DROP TABLE IF EXISTS model_view_layout;
DROP TABLE IF EXISTS model_views;
DROP TABLE IF EXISTS model_relationships;
DROP TABLE IF EXISTS model_elements;
DROP TABLE IF EXISTS model_das_overrides;
DROP TABLE IF EXISTS model_state;

DROP INDEX IF EXISTS idx_model_versions_hash;
DROP INDEX IF EXISTS idx_model_versions_model_created;

ALTER TABLE model_versions DROP COLUMN IF EXISTS kind;
ALTER TABLE model_versions DROP COLUMN IF EXISTS description;
ALTER TABLE model_versions DROP COLUMN IF EXISTS label;
ALTER TABLE model_versions DROP COLUMN IF EXISTS author_id;
ALTER TABLE model_versions DROP COLUMN IF EXISTS content_hash;

ALTER TABLE models DROP COLUMN IF EXISTS das_override_count;
ALTER TABLE models DROP COLUMN IF EXISTS das_source_hash;
ALTER TABLE models DROP COLUMN IF EXISTS das_generated_at;

COMMIT;
