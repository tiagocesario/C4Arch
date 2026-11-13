import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveExistingViews } from '../src/c4/projector.js';
import type {
  CanonicalLayoutRow,
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
