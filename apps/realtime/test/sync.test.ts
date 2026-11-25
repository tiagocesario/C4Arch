import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { flags } from '../src/flags.js';
import {
  applyOperation,
  dedupeEdgesById,
  flushState,
  getModels,
  hydrateDocFromApiSnapshot,
  loadStorageModels,
  setApiBase,
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

test('replaceModel substitui o estado existente e adiciona o novo snapshot', () => {
  const doc = newDoc();
  applyOperation(doc, { op: 'createElement', modelId: 'm1', data: { id: 'antigo', title: 'Antigo' } });
  applyOperation(doc, {
    op: 'createEdge',
    modelId: 'm1',
    data: { id: EDGE_A, fromId: 'antigo', toId: 'antigo', label: 'loop' },
  });

  assert.equal(
    applyOperation(doc, {
      op: 'replaceModel',
      modelId: 'm1',
      data: {
        elements: [
          { id: 'novo-a', type: 'actor', title: 'Usuário' },
          { id: 'novo-b', type: 'system', title: 'Sistema' },
        ],
        edges: [{ id: EDGE_B, fromId: 'novo-a', toId: 'novo-b', label: 'Acessa' }],
      },
    }),
    true
  );

  assert.equal(doc.getMap('elements').has('antigo'), false);
  assert.deepEqual(
    Array.from(doc.getMap('elements').keys()).sort(),
    ['novo-a', 'novo-b']
  );
  assert.equal(doc.getArray('edges').length, 1);
  const edge = doc.getArray('edges').get(0) as Record<string, unknown>;
  assert.equal(edge.id, EDGE_B);
  assert.equal(edge.fromId, 'novo-a');
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

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  flags.realtimePgState = 'off';
  setApiBase('http://api:4000', '');
});

async function loadModelEntry(modelId: string, title: string) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'c4arch-realtime-cas-'));
  const oldElementId = `old-${modelId}`;
  await fs.writeFile(
    join(dir, `${modelId}.json`),
    JSON.stringify({
      modelId,
      elements: [{ id: oldElementId, type: 'system', title }],
      edges: [],
    }),
    'utf8'
  );

  const previousFlag = flags.realtimePgState;
  flags.realtimePgState = 'off';
  try {
    await loadStorageModels(dir);
  } finally {
    flags.realtimePgState = previousFlag;
    await fs.rm(dir, { recursive: true, force: true });
  }

  const entry = getModels().find((candidate) => candidate.doc.getMap('elements').has(oldElementId));
  assert.ok(entry, 'modelo de teste não foi carregado');
  return entry;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('flush envia expectedRevision e avança a revisão-base após sucesso', async () => {
  const modelId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  flags.realtimePgState = 'on';
  setApiBase('http://api.test', 'internal-token');
  const entry = await loadModelEntry(modelId, 'Estado local');
  entry.revisionBase = 7;
  entry.dirty = true;

  let putBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, 'PUT');
    putBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({ revision: 8 });
  }) as typeof fetch;

  await flushState(modelId);

  assert.equal(putBody?.expectedRevision, 7);
  assert.equal(entry.revisionBase, 8);
  assert.equal(entry.dirty, false);
});

test('conflito recarrega o estado durável e descarta o snapshot local antigo', async () => {
  const modelId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  flags.realtimePgState = 'on';
  setApiBase('http://api.test', 'internal-token');
  const entry = await loadModelEntry(modelId, 'Estado antigo');
  entry.revisionBase = 7;
  entry.dirty = true;
  entry.undoStack = [Y.encodeStateAsUpdate(entry.doc)];
  entry.redoStack = [Y.encodeStateAsUpdate(entry.doc)];

  const sent: string[] = [];
  entry.clients.add({
    readyState: WebSocket.OPEN,
    send: (payload: string) => sent.push(payload),
  } as unknown as WebSocket);

  const authoritative = new Y.Doc();
  applyOperation(authoritative, {
    op: 'createElement',
    modelId,
    data: { id: 'authoritative-element', type: 'system', title: 'Estado durável' },
  });
  const authoritativeState = Buffer.from(Y.encodeStateAsUpdate(authoritative)).toString('base64');

  let putCount = 0;
  let getCount = 0;
  let putBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      putCount += 1;
      putBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ error: 'conflito', currentRevision: 9 }, 409);
    }
    assert.match(String(input), /\/api\/internal\/models\/.+\/state$/);
    getCount += 1;
    return jsonResponse({ state: authoritativeState, revision: 9 });
  }) as typeof fetch;

  await flushState(modelId);

  assert.equal(putCount, 1, 'o snapshot antigo não pode ser persistido novamente');
  assert.equal(getCount, 1);
  assert.equal(putBody?.expectedRevision, 7);
  assert.equal(entry.revisionBase, 9);
  assert.equal(entry.dirty, false);
  assert.equal(entry.undoStack.length, 0);
  assert.equal(entry.redoStack.length, 0);
  assert.equal(entry.doc.getMap('elements').has(`old-${modelId}`), false);
  const authoritativeElement = entry.doc.getMap('elements').get('authoritative-element') as {
    title: string;
  };
  assert.equal(authoritativeElement.title, 'Estado durável');

  assert.equal(sent.length, 1);
  const broadcast = JSON.parse(sent[0]) as {
    type: string;
    model: { elements: Array<{ title: string }> };
  };
  assert.equal(broadcast.type, 'update');
  assert.deepEqual(
    broadcast.model.elements.map((element) => element.title),
    ['Estado durável']
  );
});

test('falha ao recarregar após conflito preserva a edição local para retry', async () => {
  const modelId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  flags.realtimePgState = 'on';
  setApiBase('http://api.test', 'internal-token');
  const entry = await loadModelEntry(modelId, 'Estado local');
  entry.revisionBase = 7;
  entry.dirty = true;
  entry.undoStack = [Y.encodeStateAsUpdate(entry.doc)];

  let getCount = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      return jsonResponse({ error: 'conflito', currentRevision: 9 }, 409);
    }
    assert.match(String(input), /\/api\/internal\/models\/.+\/state$/);
    getCount += 1;
    return jsonResponse({ error: 'indisponível' }, 503);
  }) as typeof fetch;

  await flushState(modelId);

  assert.equal(getCount, 1);
  assert.equal(entry.dirty, true);
  assert.equal(entry.revisionBase, 7);
  assert.equal(entry.undoStack.length, 1);
  assert.equal(entry.doc.getMap('elements').has(`old-${modelId}`), true);
});
