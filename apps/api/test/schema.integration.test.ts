import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db.js';
import { runMigrations } from '../src/db/migrate.js';

const enabled = process.env.RUN_SCHEMA_TESTS === 'true';

const requiredTables = [
  'model_das_overrides',
  'model_elements',
  'model_relationships',
  'model_state',
  'model_view_layout',
  'model_views',
];

const requiredColumns: Array<[table: string, column: string]> = [
  ['models', 'das_generated_at'],
  ['models', 'das_source_hash'],
  ['models', 'das_override_count'],
  ['model_versions', 'content_hash'],
  ['model_versions', 'author_id'],
  ['model_versions', 'label'],
  ['model_versions', 'description'],
  ['model_versions', 'kind'],
];

const requiredIndexes = [
  'idx_model_das_overrides_model',
  'idx_model_elements_kind',
  'idx_model_elements_model',
  'idx_model_elements_parent',
  'idx_model_relationships_model',
  'idx_model_relationships_source',
  'idx_model_relationships_target',
  'idx_model_versions_hash',
  'idx_model_versions_model_created',
  'idx_model_view_layout_element',
  'idx_model_view_layout_object',
  'idx_model_views_model',
  'idx_model_views_scope',
];

after(async () => {
  await pool.end();
});

test(
  'schema canônico do M1 é criado e a migração é idempotente',
  { skip: enabled ? false : 'defina RUN_SCHEMA_TESTS=true e um Postgres descartável' },
  async () => {
    await runMigrations();
    await runMigrations();

    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename
         FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename = ANY($1::text[])
        ORDER BY tablename`,
      [requiredTables]
    );
    assert.deepEqual(
      tables.rows.map((row) => row.tablename),
      [...requiredTables].sort()
    );

    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [[...new Set(requiredColumns.map(([table]) => table))]]
    );
    const expectedColumnNames = new Set(
      requiredColumns.map(([table, column]) => `${table}.${column}`)
    );
    assert.deepEqual(
      columns.rows
        .map((row) => `${row.table_name}.${row.column_name}`)
        .filter((name) => expectedColumnNames.has(name))
        .sort(),
      [...expectedColumnNames].sort()
    );

    const indexes = await pool.query<{ indexname: string }>(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = ANY($1::text[])
        ORDER BY indexname`,
      [requiredIndexes]
    );
    assert.deepEqual(
      indexes.rows.map((row) => row.indexname),
      [...requiredIndexes].sort()
    );

    const stateColumn = await pool.query<{ data_type: string }>(
      `SELECT data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'model_state'
          AND column_name = 'state'`
    );
    assert.equal(stateColumn.rows[0]?.data_type, 'bytea');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const suffix = randomUUID();
      const org = await client.query<{ id: string }>(
        `INSERT INTO organizations (slug, name)
         VALUES ($1, $2)
         RETURNING id`,
        [`schema-test-${suffix}`, 'Schema test']
      );
      const model = await client.query<{ id: string }>(
        `INSERT INTO models (org_id, title)
         VALUES ($1, $2)
         RETURNING id`,
        [org.rows[0].id, 'Schema test']
      );
      const modelId = model.rows[0].id;
      const element = await client.query<{ id: string }>(
        `INSERT INTO model_elements (model_id, identifier, kind, name)
         VALUES ($1, $2, 'container', 'Elemento')
         RETURNING id`,
        [modelId, `element-${suffix}`]
      );
      const elementId = element.rows[0].id;

      await client.query('SAVEPOINT duplicate_identifier');
      await assert.rejects(
        client.query(
          `INSERT INTO model_elements (model_id, identifier, kind, name)
           VALUES ($1, $2, 'container', 'Duplicado')`,
          [modelId, `element-${suffix}`]
        ),
        /duplicate key|unique constraint/i
      );
      await client.query('ROLLBACK TO SAVEPOINT duplicate_identifier');

      await client.query('SAVEPOINT self_relationship');
      await assert.rejects(
        client.query(
          `INSERT INTO model_relationships (model_id, source_id, target_id)
           VALUES ($1, $2, $2)`,
          [modelId, elementId]
        ),
        /check constraint|source_id|target_id/i
      );
      await client.query('ROLLBACK TO SAVEPOINT self_relationship');

      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
);
