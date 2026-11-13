import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  applyOperation,
  dedupeEdgesById,
  hydrateDocFromApiSnapshot,
  type Operation,
} from '../src/sync.js';

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

const EDGE_A = '11111111-1111-4111-8111-111111111111';
const EDGE_B = '22222222-2222-4222-8222-222222222222';

test('hidratação REST revalida o vazio e não duplica arestas semeadas', () => {
  const doc = newDoc();
  const cached = {
    elements: [
      { id: 'a', type: 'actor', title: 'Usuário' },
      { id: 'b', type: 'system', title: 'Sistema' },
    ],
    edges: [
      { id: EDGE_A, fromId: 'a', toId: 'b', label: 'Acessa' },
      { id: EDGE_B, fromId: 'b', toId: 'a', label: 'Responde' },
    ],
  };

  // Simula um hydrate concorrente que chegou enquanto o join aguardava a API.
  assert.equal(
    applyOperation(doc, {
      op: 'hydrateModel',
      modelId: 'm1',
      data: cached,
    }),
    true
  );
  assert.equal(doc.getArray('edges').length, 2);

  // A chamada REST que retorna depois não deve semear uma segunda vez.
  assert.equal(hydrateDocFromApiSnapshot(doc, cached), false);
  assert.equal(doc.getMap('elements').size, 2);
  assert.equal(doc.getArray('edges').length, 2);
});

test('dedupeEdgesById remove cópias da mesma aresta e preserva paralelas distintas', () => {
  const doc = newDoc();
  applyOperation(doc, { op: 'createElement', modelId: 'm1', data: { id: 'a' } });
  applyOperation(doc, { op: 'createElement', modelId: 'm1', data: { id: 'b' } });
  applyOperation(doc, {
    op: 'createEdge',
    modelId: 'm1',
    data: { id: EDGE_A, fromId: 'a', toId: 'b', label: 'Acessa' },
  });
  applyOperation(doc, {
    op: 'createEdge',
    modelId: 'm1',
    data: { id: EDGE_B, fromId: 'a', toId: 'b', label: 'Outra relação' },
  });
  // Duplica a mesma aresta (mesmo id), como na corrida antiga.
  doc.getArray('edges').push([doc.getArray('edges').get(0)]);

  assert.equal(doc.getArray('edges').length, 3);
  assert.equal(dedupeEdgesById(doc), 1);
  assert.equal(doc.getArray('edges').length, 2);
  assert.deepEqual(
    doc.getArray('edges').toArray().map((edge) => (edge as Record<string, unknown>).id),
    [EDGE_A, EDGE_B]
  );
});
