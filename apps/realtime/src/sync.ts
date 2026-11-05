import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import type { Server } from 'http';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

export type OperationType =
  | 'createElement'
  | 'updateElement'
  | 'deleteElement'
  | 'createEdge'
  | 'updateEdge'
  | 'deleteEdge'
  | 'updateModel'
  | 'hydrateModel';

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

interface CachedModel {
  elements: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

const models = new Map<string, ModelState>();
let storageDir = process.env.STORAGE_DIR ?? join(process.cwd(), 'storage');
let apiUrl = process.env.API_URL ?? 'http://api:4000';
let apiToken = process.env.API_TOKEN ?? '';
const allowAnonymous = process.env.WS_ALLOW_ANONYMOUS === 'true';

const MAX_MESSAGES_PER_WINDOW = 300;
const MESSAGE_WINDOW_MS = 10_000;
const MAX_PAYLOAD_BYTES = 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function setStorageDir(dir: string) {
  storageDir = dir;
}

export function getStorageDir() {
  return storageDir;
}

/** Configuração opcional para hidratar o modelo a partir da API (Postgres). */
export function setApiBase(url: string, token: string) {
  apiUrl = url;
  apiToken = token;
}

const toYjsElement = (el: Record<string, unknown>): Record<string, unknown> => ({
  type: el.type,
  title: el.title,
  description: el.description ?? null,
  metadata: el.metadata ?? null,
  positionX: el.positionX ?? el.position_x ?? 0,
  positionY: el.positionY ?? el.position_y ?? 0,
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
    positionX: v.positionX ?? v.position_x ?? 0,
    positionY: v.positionY ?? v.position_y ?? 0,
    order: v.order ?? 0,
  };
};

const toYjsEdge = (edge: Record<string, unknown>): Record<string, unknown> => {
  const fromId = edge.fromId ?? edge.from_id;
  const toId = edge.toId ?? edge.to_id;
  return {
    id: isUuid(edge.id) ? edge.id : randomUUID(),
    fromId: typeof fromId === 'string' ? fromId : '',
    toId: typeof toId === 'string' ? toId : '',
    label: edge.label ?? '',
    type: edge.type ?? 'call',
  };
};

const serializeModel = (doc: Y.Doc, modelId: string): Record<string, unknown> => {
  const elements: Array<Record<string, unknown>> = [];
  const elementsMap = doc.getMap('elements');
  for (const [id, el] of elementsMap) {
    const obj = fromYjsElement(el);
    obj.id = id;
    obj.modelId = modelId;
    elements.push(obj);
  }
  const edges = doc.getArray('edges');
  const serializedEdges = edges.toArray().map((edge) => ({
    ...(edge as Record<string, unknown>),
    modelId,
  }));
  return { modelId, elements, edges: serializedEdges };
};

export function attachWebsocket(httpServer: Server) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: MAX_PAYLOAD_BYTES,
  });

  wss.on('connection', (ws, req) => {
    let modelId: string | null = null;
    let doc: Y.Doc | null = null;
    let sessionToken: string | null = null;
    const authorizedModels = new Set<string>();

    let messageCount = 0;
    let windowStart = Date.now();

    // Valida o token de sessão contra a API. Mensagens que chegam durante a
    // validação ficam aguardando a mesma promise, sem serem perdidas.
    const authReady: Promise<boolean> = (async () => {
      if (allowAnonymous) return true;

      let token: string | null = null;
      try {
        const url = new URL(req.url ?? '/ws', 'http://localhost');
        token = url.searchParams.get('token');
      } catch {
        return false;
      }
      if (!token) return false;

      const response = await apiFetchWithToken('/api/auth/me', token);
      if (!response?.ok) return false;

      sessionToken = token;
      return true;
    })();

    void authReady.then((authenticated) => {
      if (!authenticated && ws.readyState === WebSocket.OPEN) {
        ws.close(1008, 'unauthorized');
      }
    });

    ws.on('message', async (raw: Buffer) => {
      if (!(await authReady)) {
        ws.close(1008, 'unauthorized');
        return;
      }

      const now = Date.now();
      if (now - windowStart > MESSAGE_WINDOW_MS) {
        windowStart = now;
        messageCount = 0;
      }
      messageCount += 1;
      if (messageCount > MAX_MESSAGES_PER_WINDOW) {
        ws.close(1008, 'rate limit');
        return;
      }

      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }

      const type = message.type as string;
      const requestedModelId = message.modelId;
      const patch = message.patch as Operation | undefined;

      switch (type) {
        case 'join': {
          if (!isUuid(requestedModelId)) {
            ws.send(JSON.stringify({ type: 'error', error: 'modelId inválido' }));
            return;
          }

          // Verifica se o usuário autenticado pertence à organização do
          // modelo. A checagem é feita uma vez por modelo/conexão.
          if (sessionToken && !authorizedModels.has(requestedModelId)) {
            const access = await apiFetchWithToken(
              '/api/models/' + encodeURIComponent(requestedModelId),
              sessionToken
            );
            if (!access?.ok) {
              ws.send(JSON.stringify({ type: 'error', error: 'sem acesso ao modelo' }));
              return;
            }
            authorizedModels.add(requestedModelId);
          }

          // Ao trocar de modelo, remove o cliente do modelo anterior para
          // evitar broadcasts e vazamento de memória.
          if (modelId && modelId !== requestedModelId) {
            const previous = models.get(modelId);
            if (previous) {
              previous.clients.delete(ws);
              if (previous.clients.size === 0) {
                await saveSnapshot(modelId, storageDir);
                models.delete(modelId);
              }
            }
          }

          modelId = requestedModelId;
          let entry = models.get(modelId);
          if (!entry) {
            entry = { doc: new Y.Doc(), clients: new Set<WebSocket>(), version: 0 };
            models.set(modelId, entry);
          }
          entry.clients.add(ws);
          doc = entry.doc;

          const docEmpty = doc.getMap('elements').size === 0 && doc.getArray('edges').length === 0;
          const hydrationToken = sessionToken ?? apiToken;
          if (docEmpty && hydrationToken) {
            const cached = await getModelFromApi(modelId, hydrationToken);
            if (cached) {
              for (const element of cached.elements) {
                const elementId = typeof element.id === 'string' ? element.id : '';
                if (!elementId) continue;
                doc.getMap('elements').set(elementId, toYjsElement(element));
              }
              for (const edge of cached.edges) {
                const normalized = toYjsEdge(edge);
                if (!normalized.fromId || !normalized.toId) continue;
                doc.getArray('edges').push([normalized] as Array<unknown>);
              }
            }
          }

          ws.send(JSON.stringify({ type: 'state', modelId, model: serializeModel(doc, modelId) }));
          break;
        }

        case 'patch': {
          if (!modelId || !patch) {
            ws.send(JSON.stringify({ type: 'error', error: 'modelId e patch obrigatórios' }));
            return;
          }
          const entry = models.get(modelId);
          if (!entry) {
            ws.send(JSON.stringify({ type: 'error', error: 'modelo não encontrado' }));
            return;
          }
          const changed = applyOperation(entry.doc, patch);
          if (!changed) {
            break;
          }
          entry.version += 1;
          broadcast(modelId, entry);
          try {
            await saveSnapshot(modelId, storageDir);
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

    ws.on('close', async () => {
      if (!modelId) return;
      const entry = models.get(modelId);
      if (!entry) return;
      entry.clients.delete(ws);
      if (entry.clients.size === 0) {
        await saveSnapshot(modelId, storageDir);
        models.delete(modelId);
      }
    });
  });
}

async function apiFetchWithToken(
  path: string,
  token: string,
  timeoutMs = 5000
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(apiUrl.replace(/\/$/, '') + path, {
      headers: { Authorization: 'Bearer ' + token },
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Aplica uma operação JSON no documento Yjs.
 *
 * Importante: `updateElement` faz merge parcial. Campos ausentes na mensagem
 * não podem sobrescrever os valores atuais (era isso que apagava título e tipo
 * quando o usuário apenas arrastava um nó).
 */
export function applyOperation(doc: Y.Doc, op: Operation): boolean {
  const elements = doc.getMap('elements');
  const edges = doc.getArray('edges');

  switch (op.op) {
    case 'createElement': {
      const data = op.data ?? {};
      const id = typeof data.id === 'string' && data.id ? data.id : randomUUID();
      elements.set(id, toYjsElement(data));
      return true;
    }

    case 'updateElement': {
      const data = op.data ?? {};
      const id = typeof data.id === 'string' ? data.id : '';
      if (!id) return false;

      const current = elements.get(id);
      // Um update em elemento inexistente não pode criar um registro vazio
      // (isso aconteceria se o documento Yjs ainda não tivesse sido hidratado).
      if (current === undefined) return false;

      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (key === 'id' || key === 'modelId' || key === 'model_id' || value === undefined) continue;
        if (key === 'position_x') {
          patch.positionX = value;
        } else if (key === 'position_y') {
          patch.positionY = value;
        } else {
          patch[key] = value;
        }
      }
      elements.set(id, { ...fromYjsElement(current), ...patch });
      return true;
    }

    case 'deleteElement': {
      const data = op.data;
      const id = typeof data === 'string' ? data : (data as Record<string, unknown> | undefined)?.id;
      if (typeof id !== 'string' || !id) return false;
      const existed = elements.has(id);
      elements.delete(id);

      let removedEdges = 0;
      const edgeList = edges.toArray() as Array<Record<string, unknown>>;
      for (let i = edgeList.length - 1; i >= 0; i--) {
        const edge = edgeList[i];
        if (edge.fromId === id || edge.toId === id) {
          edges.delete(i, 1);
          removedEdges += 1;
        }
      }
      return existed || removedEdges > 0;
    }

    case 'createEdge': {
      const edge = toYjsEdge(op.data ?? {});
      if (!edge.fromId || !edge.toId) return false;
      edges.push([edge] as Array<unknown>);
      return true;
    }

    case 'updateEdge': {
      const data = op.data ?? {};
      const edgeId = typeof data.id === 'string' ? data.id : '';
      const fromId = typeof data.fromId === 'string' ? data.fromId : undefined;
      const toId = typeof data.toId === 'string' ? data.toId : undefined;
      const arr = edges.toArray() as Array<Record<string, unknown>>;

      for (let i = 0; i < arr.length; i++) {
        const current = arr[i];
        const matches = edgeId
          ? current.id === edgeId
          : Boolean(fromId && toId && current.fromId === fromId && current.toId === toId);
        if (!matches) continue;

        edges.delete(i, 1);
        edges.insert(i, [{
          ...current,
          fromId: fromId ?? current.fromId,
          toId: toId ?? current.toId,
          label: data.label !== undefined ? data.label : current.label,
          type: data.type !== undefined ? data.type : current.type,
        }] as Array<unknown>);
        return true;
      }
      return false;
    }

    case 'deleteEdge': {
      const data = op.data;
      const edgeId = typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).id
        : undefined;
      const fromId = typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).fromId
        : undefined;
      const toId = typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).toId
        : undefined;
      const arr = edges.toArray() as Array<Record<string, unknown>>;

      for (let i = arr.length - 1; i >= 0; i--) {
        const current = arr[i];
        const matches = typeof edgeId === 'string'
          ? current.id === edgeId
          : Boolean(fromId && toId && current.fromId === fromId && current.toId === toId);
        if (matches) {
          edges.delete(i, 1);
          return true;
        }
      }
      return false;
    }

    case 'hydrateModel': {
      // Hidratação inicial vinda do REST. Só ocorre quando o documento está
      // vazio, para nunca sobrescrever edições já feitas no CRDT.
      if (elements.size > 0 || edges.length > 0) return false;

      const data = op.data ?? {};
      const rawElements = Array.isArray(data.elements) ? data.elements : [];
      const rawEdges = Array.isArray(data.edges) ? data.edges : [];
      let seeded = false;

      for (const raw of rawElements) {
        if (raw == null || typeof raw !== 'object') continue;
        const element = raw as Record<string, unknown>;
        const id = typeof element.id === 'string' ? element.id : '';
        if (!id) continue;
        elements.set(id, toYjsElement(element));
        seeded = true;
      }

      for (const raw of rawEdges) {
        if (raw == null || typeof raw !== 'object') continue;
        const edge = toYjsEdge(raw as Record<string, unknown>);
        if (!edge.fromId || !edge.toId) continue;
        edges.push([edge] as Array<unknown>);
        seeded = true;
      }

      return seeded;
    }

    case 'updateModel': {
      // Reservado para uma futura substituição atômica de snapshot.
      return false;
    }
  }

  return false;
}

export async function saveSnapshot(modelId: string, dir: string): Promise<boolean> {
  if (!isUuid(modelId)) return false;
  const entry = models.get(modelId);
  if (!entry) return false;

  const snapshot = serializeModel(entry.doc, modelId);
  const payload = JSON.stringify(snapshot, null, 2);

  try {
    await fs.mkdir(dir, { recursive: true });
    const file = join(dir, `${modelId}.json`);
    const temp = `${file}.tmp`;
    await fs.writeFile(temp, payload, 'utf8');
    await fs.rename(temp, file);
    return true;
  } catch (err) {
    console.error('[realtime] erro ao salvar snapshot:', err);
    return false;
  }
}

export function broadcast(modelId: string, entry: ModelState): void {
  const payload = JSON.stringify({
    type: 'update',
    modelId,
    model: serializeModel(entry.doc, modelId),
  });
  for (const client of entry.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

export async function getModelFromApi(
  modelId: string,
  token = apiToken,
  timeoutMs = 8000
): Promise<CachedModel | null> {
  if (!token || !isUuid(modelId)) return null;

  try {
    const res = await apiFetchWithToken(
      '/api/models/' + encodeURIComponent(modelId),
      token,
      timeoutMs
    );
    if (!res?.ok) return null;

    const body = (await res.json()) as { elements?: unknown; edges?: unknown };
    return {
      elements: Array.isArray(body.elements)
        ? (body.elements as Array<Record<string, unknown>>)
        : [],
      edges: Array.isArray(body.edges)
        ? (body.edges as Array<Record<string, unknown>>)
        : [],
    };
  } catch {
    return null;
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
    if (!modelId || !isUuid(modelId) || models.has(modelId)) continue;

    const doc = new Y.Doc();
    const rawElements = data.elements;
    const elementList = Array.isArray(rawElements)
      ? rawElements as Array<Record<string, unknown>>
      : Object.entries((rawElements ?? {}) as Record<string, Record<string, unknown>>)
        .map(([id, element]) => ({ ...element, id }));

    for (const element of elementList) {
      const id = typeof element.id === 'string' ? element.id : '';
      if (!id) continue;
      doc.getMap('elements').set(id, fromYjsElement(element));
    }

    const rawEdges = data.edges;
    const edgeList = Array.isArray(rawEdges) ? rawEdges as Array<Record<string, unknown>> : [];
    for (const rawEdge of edgeList) {
      const edge = toYjsEdge(rawEdge);
      if (!edge.fromId || !edge.toId) continue;
      doc.getArray('edges').push([edge] as Array<unknown>);
    }

    models.set(modelId, { doc, clients: new Set<WebSocket>(), version: 0 });
  }
}

export async function closeAll() {
  for (const [modelId, entry] of models) {
    await saveSnapshot(modelId, storageDir);
    for (const client of entry.clients) {
      client.close();
    }
  }
}
