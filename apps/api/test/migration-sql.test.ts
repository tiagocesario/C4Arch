import test from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations, schemaAlters, schemaQueries } from '../src/db/migrate.js';

const requiredTables = [
  'model_elements',
  'model_relationships',
  'model_views',
  'model_view_layout',
  'model_state',
  'model_das_overrides',
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
  'idx_model_elements_model',
  'idx_model_elements_parent',
  'idx_model_elements_kind',
  'idx_model_relationships_model',
  'idx_model_relationships_source',
  'idx_model_relationships_target',
  'idx_model_views_model',
  'idx_model_views_scope',
  'idx_model_view_layout_element',
  'idx_model_view_layout_object',
  'idx_model_das_overrides_model',
  'idx_model_versions_hash',
  'idx_model_versions_model_created',
];

const allSql = [...schemaQueries, ...schemaAlters].join('\n');

test('migração exporta as tabelas canônicas do M1', () => {
  for (const table of requiredTables) {
    assert.match(
      allSql,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`),
      `tabela ${table} ausente na migração`
    );
  }
});

test('migração adiciona as colunas de DAS e versionamento do M1', () => {
  for (const [table, column] of requiredColumns) {
    assert.match(
      allSql,
      new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column}\\b`),
      `coluna ${table}.${column} ausente na migração`
    );
  }
});

test('migração cria os índices canônicos do M1', () => {
  for (const index of requiredIndexes) {
    assert.match(
      allSql,
      new RegExp(`CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ${index}\\b`),
      `índice ${index} ausente na migração`
    );
  }
});

test('todas as instruções da migração são idempotentes', () => {
  for (const [index, sql] of [...schemaQueries, ...schemaAlters].entries()) {
    assert.match(
      sql,
      /IF NOT EXISTS/i,
      `instrução ${index + 1} não usa IF NOT EXISTS: ${sql.slice(0, 80)}`
    );
  }
});

test('runMigrations é exportada para o executor e para os testes', () => {
  assert.equal(typeof runMigrations, 'function');
});
