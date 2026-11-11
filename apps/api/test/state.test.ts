import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  computeStateContentHash,
  decodeModelState,
  encodeModelState,
  hashModelState,
  stateVectorOf,
} from '../src/c4/state.js';

function sampleState() {
  return {
    elements: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        type: 'system',
        title: 'Sistema',
        description: 'Sistema principal',
        metadata: { technology: 'Node.js' },
        position_x: 10,
        position_y: 20,
        order: 1,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        type: 'container',
        title: 'API',
        description: null,
        metadata: null,
        position_x: 30,
        position_y: 40,
        order: 2,
      },
    ],
    edges: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        from_id: '11111111-1111-4111-8111-111111111111',
        to_id: '22222222-2222-4222-8222-222222222222',
        label: 'Usa [HTTPS]',
        type: 'call',
      },
    ],
  };
}

test('encodeModelState e decodeModelState fazem round-trip do snapshot lógico', () => {
  const original = sampleState();
  const decoded = decodeModelState(encodeModelState(original));
  assert.deepEqual(decoded, original);
});

test('hash do estado é estável e independe da ordem de inserção no Yjs', () => {
  const original = sampleState();

  const docA = new Y.Doc();
  const docB = new Y.Doc();
  // Ordem inversa de elementos e arestas.
  for (const element of [...original.elements].reverse()) {
    docA.getMap('elements').set(element.id, {
      type: element.type,
      title: element.title,
      description: element.description,
      metadata: element.metadata,
      positionX: element.position_x,
      positionY: element.position_y,
      order: element.order,
    });
  }
  for (const element of original.elements) {
    docB.getMap('elements').set(element.id, {
      type: element.type,
      title: element.title,
      description: element.description,
      metadata: element.metadata,
      positionX: element.position_x,
      positionY: element.position_y,
      order: element.order,
    });
  }
  for (const edge of original.edges) {
    docA.getArray('edges').push([{ ...edge, fromId: edge.from_id, toId: edge.to_id }]);
    docB.getArray('edges').push([{ ...edge, fromId: edge.from_id, toId: edge.to_id }]);
  }

  const updateA = Y.encodeStateAsUpdate(docA);
  const updateB = Y.encodeStateAsUpdate(docB);
  assert.notDeepEqual(Buffer.from(updateA), Buffer.from(updateB));
  assert.equal(hashModelState(updateA), hashModelState(updateB));
});

test('hash muda quando um campo relevante muda', () => {
  const first = sampleState();
  const second = sampleState();
  second.elements[0].title = 'Sistema renomeado';

  assert.notEqual(
    computeStateContentHash(first),
    computeStateContentHash(second)
  );
});

test('state vector é gerado a partir do update', () => {
  const state = encodeModelState(sampleState());
  const vector = stateVectorOf(state);
  assert.ok(vector.length > 0);
});
