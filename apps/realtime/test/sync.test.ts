import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { applyOperation, type Operation } from '../src/sync.js';

function newDoc(): Y.Doc {
  return new Y.Doc();
}

test('updateElement faz merge parcial e preserva campos ausentes', () => {
  const doc = newDoc();
  assert.equal(
    applyOperation(doc, {
      op: 'createElement',
      modelId: 'm1',
      data: { id: 'el-1', type: 'container', title: 'API', description: 'Backend' },
    }),
    true
  );

  assert.equal(
    applyOperation(doc, {
      op: 'updateElement',
      modelId: 'm1',
      data: { id: 'el-1', position_x: 42, position_y: 24 },
    }),
    true
  );

  assert.deepEqual(doc.getMap('elements').get('el-1'), {
    type: 'container',
    title: 'API',
    description: 'Backend',
    metadata: null,
    positionX: 42,
    positionY: 24,
    order: 0,
  });
});

test('updateElement em elemento inexistente não cria registro vazio', () => {
  const doc = newDoc();
  assert.equal(
    applyOperation(doc, {
      op: 'updateElement',
      modelId: 'm1',
      data: { id: 'inexistente', title: 'Fantasma' },
    }),
    false
  );
  assert.equal(doc.getMap('elements').has('inexistente'), false);
});

test('deleteElement remove o elemento e as arestas conectadas', () => {
  const doc = newDoc();
  applyOperation(doc, { op: 'createElement', modelId: 'm1', data: { id: 'a', title: 'A' } });
  applyOperation(doc, { op: 'createElement', modelId: 'm1', data: { id: 'b', title: 'B' } });
  applyOperation(doc, {
    op: 'createEdge',
    modelId: 'm1',
    data: { id: 'e1', fromId: 'a', toId: 'b', label: 'chama' },
  });
  applyOperation(doc, {
    op: 'createEdge',
    modelId: 'm1',
    data: { id: 'e2', fromId: 'b', toId: 'a', label: 'responde' },
  });

  assert.equal(
    applyOperation(doc, { op: 'deleteElement', modelId: 'm1', data: { id: 'a' } }),
    true
  );
  assert.equal(doc.getMap('elements').has('a'), false);
  assert.equal(doc.getArray('edges').length, 0);
});

const EDGE_ID = '44444444-4444-4444-8444-444444444444';

test('updateEdge altera label e mantém as pontas não informadas', () => {
  const doc = newDoc();
  applyOperation(doc, {
    op: 'createEdge',
    modelId: 'm1',
    data: { id: EDGE_ID, fromId: 'a', toId: 'b', label: 'antes', type: 'call' },
  });

  assert.equal(
    applyOperation(doc, {
      op: 'updateEdge',
      modelId: 'm1',
      data: { id: EDGE_ID, label: 'depois' },
    }),
    true
  );

  const edge = doc.getArray('edges').toArray()[0] as Record<string, unknown>;
  assert.equal(edge.label, 'depois');
  assert.equal(edge.type, 'call');
  assert.equal(edge.fromId, 'a');
  assert.equal(edge.toId, 'b');
});

test('deleteEdge remove pela origem/destino quando não há id', () => {
  const doc = newDoc();
  applyOperation(doc, {
    op: 'createEdge',
    modelId: 'm1',
    data: { id: 'e1', fromId: 'a', toId: 'b' },
  });

  assert.equal(
    applyOperation(doc, { op: 'deleteEdge', modelId: 'm1', data: { fromId: 'a', toId: 'b' } }),
    true
  );
  assert.equal(doc.getArray('edges').length, 0);
});

test('hydrateModel só popula um documento vazio', () => {
  const doc = newDoc();
  const hydrate: Operation = {
    op: 'hydrateModel',
    modelId: 'm1',
    data: {
      elements: [{ id: 'a', type: 'system', title: 'Sistema' }],
      edges: [{ fromId: 'a', toId: 'b', label: 'x' }],
    },
  };

  assert.equal(applyOperation(doc, hydrate), true);
  assert.equal(doc.getMap('elements').size, 1);
  assert.equal(doc.getArray('edges').length, 1);

  // Segundo hydrate não sobrescreve o estado já existente.
  assert.equal(applyOperation(doc, hydrate), false);
  assert.equal(doc.getMap('elements').size, 1);
});
