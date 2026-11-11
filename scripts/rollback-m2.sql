-- C4Arch — rollback do M2 (dados canônicos de um modelo)
--
-- Remove APENAS o que o backfill do M2 gravou para o modelo informado. O legado
-- (`models`, `elements`, `edges` e `model_versions`) não é apagado.
--
-- Uso:
--   docker compose exec -T db psql -U c4arch -d c4arch \
--     -v model_id=00000000-0000-4000-8000-000000000000 \
--     -f /caminho/rollback-m2.sql
--
-- Sem `-v model_id=...` o script falha antes do BEGIN e não apaga nada.
-- Use apenas antes do M3: a partir do M3 essas tabelas passam a ser escritas
-- pelo projetor e o rollback precisa considerar o estado colaborativo.
--
-- Para desligar a leitura em sombra, basta CANONICAL_MODEL=off.

\set ON_ERROR_STOP on

-- Valida o parâmetro e falha com uuid inválido/ausente antes de abrir transação.
SELECT :'model_id'::uuid AS rollback_model_id \gset

BEGIN;

-- Layout primeiro (a FK de view e de elemento também tem ON DELETE CASCADE,
-- mas a ordem explícita deixa o efeito claro).
DELETE FROM model_view_layout l
 USING model_views v
 WHERE l.view_id = v.id
   AND v.model_id = :'model_id'::uuid;

DELETE FROM model_views          WHERE model_id = :'model_id'::uuid;
DELETE FROM model_das_overrides  WHERE model_id = :'model_id'::uuid;
DELETE FROM model_relationships  WHERE model_id = :'model_id'::uuid;
DELETE FROM model_elements       WHERE model_id = :'model_id'::uuid;

-- Metadados do DAS recalculados pelo M2.
UPDATE models
   SET das_source_hash    = NULL,
       das_override_count = 0,
       das_generated_at   = NULL
 WHERE id = :'model_id'::uuid;

-- Opcional: o M2 também preencheu `content_hash`, `author_id` e `kind` em
-- `model_versions`. Descomente apenas se quiser desfazer isso por completo.
-- Como o backfill usa COALESCE, valores que já existiam antes do M2 precisam
-- ser preservados manualmente.
--
-- UPDATE model_versions
--    SET content_hash = NULL,
--        author_id    = NULL,
--        kind         = NULL
--  WHERE model_id = :'model_id'::uuid;

COMMIT;
