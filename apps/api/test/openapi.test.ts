import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenApiDocument, renderDocsHtml } from '../src/openapi.js';
import { ApiError, errorBody } from '../src/errors.js';

const doc = buildOpenApiDocument();

test('OpenAPI é 3.1 e tem metadados', () => {
  assert.equal(doc.openapi, '3.1.0');
  assert.equal(doc.info.title, 'C4Arch API');
  assert.ok(doc.info.version.length > 0);
  assert.ok(Array.isArray(doc.servers) && doc.servers.length > 0);
  assert.ok(doc.components.securitySchemes.bearerAuth);
});

test('OpenAPI documenta exportação, importação, views e comentários', () => {
  const required = [
    '/api/openapi.json',
    '/api/models/import/structurizr',
    '/api/models/{id}/import/structurizr',
    '/api/models/{id}/exports',
    '/api/models/{id}/export/{format}',
    '/api/models/{id}/preview',
    '/api/models/{id}/views',
    '/api/models/{id}/views/{key}/layout',
    '/api/models/{id}/views/{key}/autolayout',
    '/api/models/{id}/comments',
    '/api/models/{id}/comments/{commentId}',
    '/api/models/{id}/inspections',
  ];
  for (const path of required) {
    assert.ok(path in doc.paths, `path ausente: ${path}`);
  }
});

test('toda operação tem tags e summary', () => {
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
      assert.ok(Array.isArray(operation.tags) && operation.tags.length > 0, `${method} ${path} sem tag`);
      assert.ok(
        typeof operation.summary === 'string' && operation.summary.length > 0,
        `${method} ${path} sem summary`
      );
      assert.ok(operation.responses, `${method} ${path} sem responses`);
    }
  }
});

test('exportação aceita todos os formatos implementados', () => {
  const operation = doc.paths['/api/models/{id}/export/{format}'].get;
  const format = operation.parameters.find((parameter: { name: string }) => parameter.name === 'format');
  assert.deepEqual(
    [...format.schema.enum].sort(),
    ['drawio', 'html', 'mermaid', 'plantuml', 'png', 'structurizr-dsl', 'structurizr-json', 'svg']
  );
});

test('renderDocsHtml referencia o JSON e o Swagger UI', () => {
  const html = renderDocsHtml();
  assert.match(html, /SwaggerUIBundle/);
  assert.match(html, /\/api\/openapi\.json/);
});

test('ApiError e errorBody preservam o contrato error/code', () => {
  const error = new ApiError(409, 'CONFLICT', 'já existe', { field: 'title' });
  assert.equal(error.status, 409);
  assert.equal(error.code, 'CONFLICT');
  assert.deepEqual(errorBody('CONFLICT', 'já existe', { field: 'title' }), {
    error: 'já existe',
    code: 'CONFLICT',
    details: { field: 'title' },
  });
  assert.deepEqual(errorBody('X', 'y'), { error: 'y', code: 'X' });
});
