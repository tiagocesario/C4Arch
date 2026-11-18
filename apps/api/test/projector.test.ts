import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveCanonicalDetails, preserveExistingViews } from '../src/c4/projector.js';
import type {
  CanonicalElement,
  CanonicalLayoutRow,
  CanonicalRelationship,
  CanonicalSnapshot,
  CanonicalView,
} from '../src/c4/canonical.js';

function view(key: string, title: string): CanonicalView {
  return {
    model_id: 'model-1',
    key,
    type: key === 'systemcontext' ? 'system_context' : 'container',
    scope_element_id: null,
    title,
    description: null,
    include: [],
    exclude: [],
    auto_layout: true,
  };
}

function layoutRow(viewKey: string, elementId: string, x: number): CanonicalLayoutRow {
  return {
    viewKey,
    element_id: elementId,
    object_key: null,
    x,
    y: 0,
    width: 190,
    height: 90,
    style: { source: 'autolayout' },
  };
}

function snapshot(views: CanonicalView[], layout: CanonicalLayoutRow[]): CanonicalSnapshot {
  return {
    modelId: 'model-1',
    elements: [],
    relationships: [],
    views,
    layout,
    overrides: [],
    versions: [],
    contentHash: 'hash',
    dasSourceHash: 'das',
    warnings: [],
    stats: {
      elements: 0,
      relationships: 0,
      views: views.length,
      layout: layout.length,
      overrides: 0,
      versions: 0,
      duplicateVersions: 0,
      skippedRelationships: 0,
    },
  };
}

function element(id: string, patch: Partial<CanonicalElement> = {}): CanonicalElement {
  return {
    id,
    model_id: 'model-1',
    parent_element_id: null,
    identifier: id,
    kind: 'container',
    name: id,
    description: null,
    technology: null,
    url: null,
    tags: [],
    properties: {},
    app_id: null,
    service_id: null,
    ...patch,
  };
}

function relationship(
  id: string,
  patch: Partial<CanonicalRelationship> = {}
): CanonicalRelationship {
  return {
    id,
    model_id: 'model-1',
    source_id: 'a',
    target_id: 'b',
    description: null,
    technology: null,
    tags: [],
    properties: {},
    ...patch,
  };
}

function stateSnapshot(
  elements: CanonicalElement[],
  relationships: CanonicalRelationship[]
): CanonicalSnapshot {
  const base = snapshot([], []);
  base.elements = elements;
  base.relationships = relationships;
  return base;
}

test('projetor preserva detalhes canônicos que o Yjs não transporta', () => {
  const expected = stateSnapshot(
    [
      element('pai', { identifier: 'pai' }),
      // O estado derivado perdeu identificador, URL, tags e pai.
      element('api', { identifier: 'api-slug', tags: [], url: null }),
    ],
    [relationship('rel-1', { technology: null, tags: [] })]
  );

  preserveCanonicalDetails(
    expected,
    [
      { id: 'pai', identifier: 'pai', parent_element_id: null, tags: [] },
      {
        id: 'api',
        identifier: 'api',
        parent_element_id: 'pai',
        url: 'https://api.exemplo',
        tags: ['critico'],
      },
    ],
    [{ id: 'rel-1', technology: 'HTTPS', tags: ['externo'] }]
  );

  const api = expected.elements.find((item) => item.id === 'api')!;
  assert.equal(api.identifier, 'api');
  assert.equal(api.parent_element_id, 'pai');
  assert.equal(api.url, 'https://api.exemplo');
  assert.deepEqual(api.tags, ['critico']);
  assert.equal(expected.relationships[0].technology, 'HTTPS');
  assert.deepEqual(expected.relationships[0].tags, ['externo']);
});

test('projetor não sobrescreve hierarquia nem detalhes vindos do estado', () => {
  const expected = stateSnapshot(
    [
      element('raiz'),
      element('filho', { parent_element_id: 'raiz', tags: ['novo'], url: 'https://novo' }),
    ],
    [relationship('rel-1', { technology: 'gRPC', tags: ['novo'] })]
  );

  preserveCanonicalDetails(
    expected,
    [
      { id: 'raiz', identifier: 'raiz', parent_element_id: null, tags: [] },
      { id: 'filho', identifier: 'filho', parent_element_id: 'outro', tags: ['antigo'], url: 'https://antigo' },
    ],
    [{ id: 'rel-1', technology: 'HTTPS', tags: ['antigo'] }]
  );

  const filho = expected.elements.find((item) => item.id === 'filho')!;
  assert.equal(filho.parent_element_id, 'raiz');
  assert.deepEqual(filho.tags, ['novo']);
  assert.equal(filho.url, 'https://novo');
  assert.equal(expected.relationships[0].technology, 'gRPC');
  assert.deepEqual(expected.relationships[0].tags, ['novo']);
});

test('projetor preserva views e layout importados que o Yjs não carrega', () => {
  const expected = snapshot(
    [view('container', 'Sintética do projetor')],
    [layoutRow('container', 'elem-a', 10)]
  );
  const existing = snapshot(
    [
      view('container', 'Containers importados'),
      view('systemcontext', 'Contexto importado'),
      view('container-2', 'Containers do sistema'),
    ],
    [
      layoutRow('container', 'elem-a', 99),
      layoutRow('systemcontext', 'elem-a', 20),
      layoutRow('container-2', 'elem-b', 30),
    ]
  );

  preserveExistingViews(expected, existing);

  assert.deepEqual(
    expected.views.map((item) => [item.key, item.title]),
    [
      ['container', 'Containers importados'],
      ['systemcontext', 'Contexto importado'],
      ['container-2', 'Containers do sistema'],
    ]
  );
  // A view primária continua vindo do estado colaborativo; as demais mantêm
  // o layout original em vez de serem apagadas pelo prune.
  assert.deepEqual(
    expected.layout.map((row) => [row.viewKey, row.element_id, row.x]),
    [
      ['container', 'elem-a', 10],
      ['systemcontext', 'elem-a', 20],
      ['container-2', 'elem-b', 30],
    ]
  );
  assert.equal(expected.stats.views, 3);
  assert.equal(expected.stats.layout, 3);
});

test('projetor preserva views quando o snapshot derivado não tem nenhuma', () => {
  const expected = snapshot([], []);
  const existing = snapshot(
    [view('systemcontext', 'Contexto')],
    [layoutRow('systemcontext', 'elem-a', 5)]
  );

  preserveExistingViews(expected, existing);

  assert.deepEqual(expected.views.map((item) => item.key), ['systemcontext']);
  assert.equal(expected.layout.length, 1);
});
