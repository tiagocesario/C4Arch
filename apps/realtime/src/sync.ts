import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import type { Server } from 'http';
import { promises as fs } from 'fs';
import { join } from 'path';

export type OperationType =
  | 'createElement'
  | 'updateElement'
  | 'deleteElement'
  | 'createEdge'
  | 'updateEdge'
  | 'deleteEdge'
  | 'updateModel';

export interface Operation {
  op: OperationType;
  modelId: string;
  data?: Record<string, unknown>;
}

interface ModelState {
  doc: Y.Doc;
  clients: Set<WebSocket>;
  version: number;
}

const models = new Map<string, ModelState>();
let storageDir = process.env.STORAGE_DIR ?? join(process.cwd(), 'storage');

export function setStorageDir(dir: string) {
  storageDir = dir;
}

export function getStorageDir() {
  return storageDir;
}

const toYjsElement = (el: Record<string, unknown>) => ({
  type: el.type,
  title: el.title,
  description: el.description ?? null,
  metadata: el.metadata ?? null,
  positionX: el.positionX ?? 0,
  positionY: el.positionY ?? 0,
  order: el.order ?? 0,
});

const fromYjsElement = (value: unknown): Record<string, unknown> => {
  if (value == null || typeof value !== 'object') return {};
  const v = value as Record<string, unknown>;
  return {
    type: v.type ?? 'system',
    title: v.title ?? '',
    description: v.description ?? null,
    metadata: v.metadata ?? null,
    positionX: v.positionX ?? 0,
    positionY: v.positionY ?? 0,
    order: v.order ?? 0,
  };
};

const serializeModel = (doc: Y.Doc): Record<string, unknown> => {
  const elements: Record<string, unknown>[] = [];
  const elementsMap = doc.getMap('elements');
  for (const [id, el] of elementsMap) {
    const obj = fromYjsElement(el);
    obj.id = id;
    elements.push(obj);
  }
  const edges = doc.getArray('edges');
  const result: { elements: Record<string, unknown>[]; edges: Array<Record<string, unknown>> } = {
    elements,
    edges: edges.toArray().map((e) => (e as Record<string, unknown>)),
  };
  return result;
};

export function attachWebsocket(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    let modelId: string | null = null;
    let doc: Y.Doc | null = null;

    ws.on('message', (raw: Buffer) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }

      const type = message.type as string;
      const modelIdMsg = message.modelId as string | undefined;
      const patch = message.patch as Operation | undefined;

      switch (type) {
        case 'join': {
          modelId = modelIdMsg as string;
          if (!modelId) {
            ws.send(JSON.stringify({ type: 'error', error: 'modelId obrigatório' }));
            return;
          }
          if (!models.has(modelId)) {
            const newDoc = new Y.Doc();
            models.set(modelId, { doc: newDoc, clients: new Set<WebSocket>([ws]), version: 0 });
          } else {
            const entry = models.get(modelId)!;
            entry.clients.add(ws);
            if (!entry.doc) {
              entry.doc = new Y.Doc();
            }
          }
          doc = models.get(modelId)!.doc;
          const state = serializeModel(doc);
          ws.send(JSON.stringify({ type: 'state', modelId, model: state }));
          break;
        }

        case 'patch': {
          if (!modelId || !patch) {
            ws.send(JSON.stringify({ type: 'error', error: 'modelId e patch obrigatórios' }));
            return;
          }
          const entry = models.get(modelId);
          if (!entry || !entry.doc) {
            ws.send(JSON.stringify({ type: 'error', error: 'modelo não encontrado' }));
            return;
          }
          applyOperation(entry.doc, patch);
          entry.version += 1;
          broadcast(modelId, entry);
          try {
            saveSnapshot(modelId, storageDir);
          } catch (err) {
            console.error('[realtime] falha ao salvar snapshot:', err);
          }
          break;
        }

        case 'disconnect': {
          break;
        }

        default:
          ws.send(JSON.stringify({ type: 'error', error: 'tipo de mensagem desconhecido' }));
      }
    });

    ws.on('close', () => {
      if (modelId && models.has(modelId)) {
        const entry = models.get(modelId)!;
        entry.clients.delete(ws);
        if (entry.clients.size === 0) {
          models.delete(modelId);
        }
      }
    });
  });
}

export function applyOperation(doc: Y.Doc, op: Operation): void {
  const elements = doc.getMap('elements');
  const edges = doc.getArray('edges');

  switch (op.op) {
    case 'createElement': {
      const data = op.data as Record<string, unknown>;
      const id = data.id as string;
      elements.set(id, toYjsElement(data));
      break;
    }
    case 'updateElement': {
      const data = op.data as Record<string, unknown>;
      const id = data.id as string;
      const current = elements.get(id);
      elements.set(id, { ...fromYjsElement(current), ...toYjsElement(data) });
      break;
    }
    case 'deleteElement': {
      const data = op.data as Record<string, unknown> | string;
      const id = typeof data === 'string' ? data : (data as Record<string, unknown>).id;
      elements.delete(id as string);
      const edgesArr = (edges as Y.Array<Record<string, unknown>>).toArray();
      const removeFromEdges = edgesArr.filter((e) => e.fromId !== id && e.toId !== id);
      edges.delete(0, edges.length);
      for (const edge of removeFromEdges) {
        edges.push([edge] as Array<unknown>);
      }
      break;
    }
    case 'createEdge': {
      const data = op.data as Record<string, unknown>;
      const fromId = data.fromId as string;
      const toId = data.toId as string;
      edges.push([{ fromId, toId, label: data.label ?? '', type: data.type ?? 'call' }] as Array<unknown>);
      break;
    }
    case 'updateEdge': {
      const data = op.data as Record<string, unknown>;
      const fromId = data.fromId as string;
      const toId = data.toId as string;
      const arr = edges.toArray() as Array<Record<string, unknown>>;
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        if (e.fromId === fromId && e.toId === toId) {
          edges.delete(i, 1);
          edges.push([{ fromId, toId, label: data.label ?? '', type: data.type ?? 'call' }] as Array<unknown>);
        }
      }
      break;
    }
    case 'deleteEdge': {
      const data = op.data as Record<string, unknown> | string;
      const fromId = typeof data === 'string' ? data : (data as Record<string, unknown>).fromId;
      const toId = typeof data === 'string' ? data : (data as Record<string, unknown>).toId;
      const arr = edges.toArray() as Array<Record<string, unknown>>;
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        if (e.fromId === fromId && e.toId === toId) {
          edges.delete(i, 1);
          break;
        }
      }
      break;
    }
    case 'updateModel': {
      const data = op.data as Record<string, unknown>;
      if (data.snapshot) {
        // para o MVP, recriamos do snapshot (simplificado)
      }
      break;
    }
  }
}

export async function saveSnapshot(modelId: string, dir: string): Promise<boolean> {
  const entry = models.get(modelId);
  if (!entry || !entry.doc) return false;
  const snapshot = serializeModel(entry.doc);
  const payload = JSON.stringify({ modelId, ...snapshot }, null, 2);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, modelId + '.json'), payload, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function broadcast(modelId: string, entry: ModelState): void {
  const payload = JSON.stringify({
    type: 'update',
    modelId,
    model: serializeModel(entry.doc),
  });
  for (const client of entry.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

export function getModels(): ModelState[] {
  return Array.from(models.values());
}

export async function loadStorageModels(dir: string) {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(await fs.readFile(join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    const modelId = typeof data.modelId === 'string' ? data.modelId : undefined;
    if (!modelId) continue;
    const elements = data.elements as Record<string, unknown> | undefined;
    const edges = data.edges as Array<Record<string, unknown>> | undefined;
    if (models.has(modelId)) continue;
    const doc = new Y.Doc();
    const elementsMap = doc.getMap('elements');
    for (const [id, el] of Object.entries(elements ?? {})) {
      elementsMap.set(id, fromYjsElement(el));
    }
    const edgesArray = doc.getArray('edges');
    for (const e of Array.isArray(edges) ? edges : []) {
      edgesArray.push([
        { fromId: String((e as Record<string, unknown>).from_id ?? ''), toId: String((e as Record<string, unknown>).to_id ?? ''), label: e.label ?? '', type: e.type ?? 'call' },
      ] as Array<unknown>);
    }
    models.set(modelId, { doc, clients: new Set<WebSocket>(), version: 0 });
  }
}

export function closeAll() {
  for (const entry of models.values()) {
    for (const client of entry.clients) {
      client.close();
    }
  }
}
