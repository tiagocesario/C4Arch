import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import type { Server } from 'http';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { flags } from './flags.js';

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
  /** Há alterações ainda não gravadas em `model_state`. */
  dirty: boolean;
  persistTimer: ReturnType<typeof setTimeout> | null;
  /** Histórico de undo/redo por modelo (snapshots Yjs completos, limitado). */
  undoStack: Uint8Array[];
  redoStack: Uint8Array[];
  /** Presença por conexão; cada cliente recebe a lista da sua view/sala. */
  presence: Map<WebSocket, PresenceUser>;
}

export interface PresenceUser {
  clientId: string;
  name: string;
  color: string;
  viewKey: string | null;
  cursor: { x: number; y: number } | null;
  updatedAt: number;
}

const MAX_UNDO_STACK = 50;
const PRESENCE_COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#22d3ee'];

export interface CachedModel {
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

// Persistência do estado durável: debounce curto para não gravar a cada patch,
// flush periódico para não perder alterações de sessões longas.
const PERSIST_DEBOUNCE_MS = 2_000;
const PERSIST_FLUSH_MS = 15_000;

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

function docIsEmpty(doc: Y.Doc): boolean {
  return doc.getMap('elements').size === 0 && doc.getArray('edges').length === 0;
}

/**
 * Semeia o documento com o snapshot REST. A checagem de vazio é refeita aqui,
 * imediatamente antes da escrita: o `join` espera chamadas HTTP e, nesse meio
 * tempo, um `hydrateModel` concorrente pode ter populado o CRDT. Sem a
 * revalidação, as arestas eram inseridas duas vezes (estado durável + REST).
 */
export function hydrateDocFromApiSnapshot(doc: Y.Doc, cached: CachedModel): boolean {
  if (!docIsEmpty(doc)) return false;

  const elements = doc.getMap('elements');
  const edges = doc.getArray('edges');

  for (const element of cached.elements) {
    const elementId = typeof element.id === 'string' ? element.id : '';
    if (!elementId) continue;
    elements.set(elementId, toYjsElement(element));
  }
  for (const edge of cached.edges) {
    const normalized = toYjsEdge(edge);
    if (!normalized.fromId || !normalized.toId) continue;
    edges.push([normalized] as Array<unknown>);
  }

  return elements.size > 0 || edges.length > 0;
}

/**
 * Remove cópias da mesma aresta (mesmo id). Documentos afetados pela corrida
 * antiga de hidratação ficaram com o array duplicado; como os ids são os
 * mesmos, a limpeza é segura e não afeta relações paralelas legítimas.
 */
export function dedupeEdgesById(doc: Y.Doc): number {
  const edges = doc.getArray('edges');
  const seen = new Set<string>();
  const duplicates: number[] = [];

  edges.toArray().forEach((value, index) => {
    if (value == null || typeof value !== 'object') return;
    const id = (value as Record<string, unknown>).id;
    if (typeof id !== 'string' || !id) return;
    if (seen.has(id)) {
      duplicates.push(index);
    } else {
      seen.add(id);
    }
  });

  for (let i = duplicates.length - 1; i >= 0; i -= 1) {
    edges.delete(duplicates[i], 1);
  }
  return duplicates.length;
}

const serializeModel = (doc: Y.Doc, modelId: string): Record<string, unknown> => {  const elements: Array<Record<string, unknown>> = [];
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

/** Snapshot completo usado pelo undo/redo. */
export function captureState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Substitui o conteúdo do documento pelo snapshot. Diferente de
 * `Y.applyUpdate`, remove elementos/arestas que não existiam no snapshot,
 * que é o comportamento esperado ao desfazer uma criação.
 */
export function restoreState(doc: Y.Doc, update: Uint8Array): void {
  const temp = new Y.Doc();
  Y.applyUpdate(temp, update);

  const elements = doc.getMap('elements');
  const desiredElements = temp.getMap('elements');
  for (const key of [...elements.keys()]) {
    if (!desiredElements.has(key)) elements.delete(key);
  }
  for (const [key, value] of desiredElements) {
    elements.set(key, fromYjsElement(value));
  }

  const edges = doc.getArray('edges');
  const desiredEdges = temp.getArray('edges').toArray();
  edges.delete(0, edges.length);
  if (desiredEdges.length > 0) edges.push(desiredEdges as Array<unknown>);
}

function broadcastPresence(modelId: string, entry: ModelState): void {
  for (const client of entry.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const self = entry.presence.get(client);
    const viewKey = self?.viewKey ?? null;
    const users = [...entry.presence.values()]
      .filter((user) => {
        if (!viewKey) return true;
        return !user.viewKey || user.viewKey === viewKey;
      })
      .map((user) => ({
        clientId: user.clientId,
        name: user.name,
        color: user.color,
        viewKey: user.viewKey,
        cursor: user.cursor,
      }));
    client.send(
      JSON.stringify({ type: 'presence', modelId, viewKey, users })
    );
  }
}

function createEntry(doc = new Y.Doc()): ModelState {
  return {
    doc,
    clients: new Set<WebSocket>(),
    version: 0,
    dirty: false,
    persistTimer: null,
    undoStack: [],
    redoStack: [],
    presence: new Map<WebSocket, PresenceUser>(),
  };
}

async function apiRequest(
  path: string,
  init: RequestInit,
  timeoutMs = 8000
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(apiUrl.replace(/\/$/, '') + path, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        'X-Internal-Token': apiToken,
      },
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Lê o estado Yjs durável; `null` quando a rota está desligada ou vazia. */
async function getStateFromApi(modelId: string): Promise<Uint8Array | null> {
  if (!apiToken || !isUuid(modelId)) return null;
  const response = await apiRequest(
    '/api/internal/models/' + encodeURIComponent(modelId) + '/state',
    { method: 'GET' }
  );
  if (!response?.ok) return null;
  try {
    const body = (await response.json()) as { state?: unknown };
    if (typeof body.state !== 'string') return null;
    const bytes = Buffer.from(body.state, 'base64');
    return bytes.length > 0 ? new Uint8Array(bytes) : null;
  } catch {
    return null;
  }
}

async function putStateToApi(modelId: string, update: Uint8Array): Promise<boolean> {
  if (!apiToken || !isUuid(modelId)) return false;
  const response = await apiRequest(
    '/api/internal/models/' + encodeURIComponent(modelId) + '/state',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: Buffer.from(update).toString('base64') }),
    }
  );
  return Boolean(response?.ok);
}

async function flushState(modelId: string): Promise<void> {
  const entry = models.get(modelId);
  if (!entry || !entry.dirty) return;
  if (flags.realtimePgState === 'off') {
    entry.dirty = false;
    return;
  }

  entry.dirty = false;
  const ok = await putStateToApi(modelId, Y.encodeStateAsUpdate(entry.doc));
  if (!ok) {
    entry.dirty = true;
    console.warn(`[realtime] falha ao persistir model_state ${modelId}`);
  }
}

function schedulePersist(modelId: string): void {
  if (flags.realtimePgState === 'off') return;
  const entry = models.get(modelId);
  if (!entry) return;

  entry.dirty = true;
  if (entry.persistTimer) return;
  entry.persistTimer = setTimeout(() => {
    entry.persistTimer = null;
    void flushState(modelId);
  }, PERSIST_DEBOUNCE_MS);
  entry.persistTimer.unref?.();
}

/** Flush periódico de todos os modelos com alterações pendentes. */
export async function flushAllStates(): Promise<void> {
  await Promise.all([...models.keys()].map((modelId) => flushState(modelId)));
}

export function startPeriodicFlush(): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    flushAllStates().catch((err) => {
      console.error('[realtime] falha no flush periódico', err);
    });
  }, PERSIST_FLUSH_MS);
  timer.unref?.();
  return timer;
}

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
    const clientId = randomUUID();
    let presenceName = 'Anônimo';
    let presenceColor = PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)];
    let viewKey: string | null = null;
    let cursor: { x: number; y: number } | null = null;
    // Papel por modelo, com TTL curto: uma rebaixamento de owner/editor para
    // viewer passa a bloquear escritas no WS sem exigir reconexão.
    const modelRoles = new Map<string, { role: string; checkedAt: number }>();
    const ROLE_TTL_MS = 30_000;

    let messageCount = 0;
    let windowStart = Date.now();

    async function fetchModelRole(requestedModelId: string): Promise<string | null> {
      if (!sessionToken) return allowAnonymous ? 'owner' : null;
      const access = await apiFetchWithToken(
        '/api/models/' + encodeURIComponent(requestedModelId),
        sessionToken
      );
      if (!access?.ok) return null;
      try {
        const body = (await access.json()) as { member_role?: unknown };
        return typeof body.member_role === 'string' ? body.member_role : 'viewer';
      } catch {
        return null;
      }
    }

    async function ensureModelRole(requestedModelId: string): Promise<string | null> {
      const cached = modelRoles.get(requestedModelId);
      if (cached && Date.now() - cached.checkedAt < ROLE_TTL_MS) {
        return cached.role;
      }
      const role = await fetchModelRole(requestedModelId);
      if (role) {
        modelRoles.set(requestedModelId, { role, checkedAt: Date.now() });
      } else {
        modelRoles.delete(requestedModelId);
      }
      return role;
    }

    function canWrite(role: string | null): boolean {
      return role === 'owner' || role === 'editor';
    }

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
          // modelo e guarda o papel para autorizar escritas no CRDT.
          const joinRole = await ensureModelRole(requestedModelId);
          if (!joinRole) {
            ws.send(JSON.stringify({ type: 'error', error: 'sem acesso ao modelo' }));
            return;
          }

          // Ao trocar de modelo, remove o cliente do modelo anterior para
          // evitar broadcasts e vazamento de memória.
          if (modelId && modelId !== requestedModelId) {
            const previous = models.get(modelId);
            if (previous) {
              previous.clients.delete(ws);
              previous.presence.delete(ws);
              broadcastPresence(modelId, previous);
              if (previous.clients.size === 0) {
                await flushState(modelId);
                if (flags.realtimePgState !== 'on') {
                  await saveSnapshot(modelId, storageDir);
                }
                models.delete(modelId);
              }
            }
          }

          modelId = requestedModelId;
          let entry = models.get(modelId);
          if (!entry) {
            entry = createEntry();
            models.set(modelId, entry);
          }
          entry.clients.add(ws);
          doc = entry.doc;
          viewKey =
            typeof message.viewKey === 'string' && message.viewKey.trim()
              ? message.viewKey.trim().slice(0, 120)
              : null;
          const userInfo =
            message.user && typeof message.user === 'object'
              ? (message.user as Record<string, unknown>)
              : null;
          if (userInfo && typeof userInfo.name === 'string' && userInfo.name.trim()) {
            presenceName = userInfo.name.trim().slice(0, 80);
          }
          if (userInfo && typeof userInfo.color === 'string' && /^#[0-9a-f]{6}$/i.test(userInfo.color)) {
            presenceColor = userInfo.color;
          }
          if (userInfo && userInfo.cursor && typeof userInfo.cursor === 'object') {
            const value = userInfo.cursor as Record<string, unknown>;
            if (typeof value.x === 'number' && typeof value.y === 'number') {
              cursor = { x: value.x, y: value.y };
            }
          }
          entry.presence.set(ws, {
            clientId,
            name: presenceName,
            color: presenceColor,
            viewKey,
            cursor,
            updatedAt: Date.now(),
          });


          const hydrationToken = sessionToken ?? apiToken;
          if (docIsEmpty(doc) && flags.realtimePgState !== 'off') {
            const durable = await getStateFromApi(modelId);
            // O estado durável pode ter chegado junto com um hydrate concorrente.
            if (durable && docIsEmpty(doc)) {
              Y.applyUpdate(doc, durable);
            }
          }

          // Só hidrata do legado se, após aplicar o estado durável, ainda não
          // houver nem elementos nem arestas. O helper revalida o vazio depois
          // do await para não duplicar arestas semeadas por um hydrateModel
          // concorrente.
          if (docIsEmpty(doc) && hydrationToken) {
            const cached = await getModelFromApi(modelId, hydrationToken);
            if (cached && hydrateDocFromApiSnapshot(doc, cached)) {
              // Estado novo criado a partir do legado: persiste no primeiro
              // flush para que o projetor tenha uma base durável.
              if (flags.realtimePgState !== 'off') schedulePersist(modelId);
            }
          }

          // Cura documentos já corrompidos pela corrida antiga.
          if (dedupeEdgesById(doc) > 0) {
            broadcast(modelId, entry);
            if (flags.realtimePgState !== 'off') schedulePersist(modelId);
          }

          ws.send(JSON.stringify({ type: 'state', modelId, model: serializeModel(doc, modelId) }));
          broadcastPresence(modelId, entry);
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
          // `viewer` é somente leitura também no CRDT. Sem esta checagem, a
          // UI read-only poderia ser contornada enviando patches diretamente.
          const writeRole = await ensureModelRole(modelId);
          if (!canWrite(writeRole)) {
            ws.send(JSON.stringify({ type: 'error', error: 'sem permissão de escrita' }));
            return;
          }
          const before = captureState(entry.doc);
          const changed = applyOperation(entry.doc, patch);
          if (!changed) {
            break;
          }
          // Hidratação é semeadura inicial, não uma edição do usuário; não deve
          // ocupar uma posição no histórico de undo.
          if (patch.op !== 'hydrateModel') {
            entry.undoStack.push(before);
            if (entry.undoStack.length > MAX_UNDO_STACK) entry.undoStack.shift();
            entry.redoStack = [];
          }
          entry.version += 1;
          broadcast(modelId, entry);
          schedulePersist(modelId);
          if (flags.realtimePgState !== 'on') {
            try {
              await saveSnapshot(modelId, storageDir);
            } catch (err) {
              console.error('[realtime] falha ao salvar snapshot:', err);
            }
          }
          break;
        }

        case 'undo':
        case 'redo': {
          if (!modelId) {
            ws.send(JSON.stringify({ type: 'error', error: 'modelId obrigatório' }));
            return;
          }
          const entry = models.get(modelId);
          if (!entry) {
            ws.send(JSON.stringify({ type: 'error', error: 'modelo não encontrado' }));
            return;
          }
          const writeRole = await ensureModelRole(modelId);
          if (!canWrite(writeRole)) {
            ws.send(JSON.stringify({ type: 'error', error: 'sem permissão de escrita' }));
            return;
          }
          const source = type === 'undo' ? entry.undoStack : entry.redoStack;
          if (source.length === 0) {
            ws.send(
              JSON.stringify({
                type: 'error',
                error: type === 'undo' ? 'nada para desfazer' : 'nada para refazer',
              })
            );
            return;
          }
          const current = captureState(entry.doc);
          if (type === 'undo') {
            entry.redoStack.push(current);
            if (entry.redoStack.length > MAX_UNDO_STACK) entry.redoStack.shift();
          } else {
            entry.undoStack.push(current);
            if (entry.undoStack.length > MAX_UNDO_STACK) entry.undoStack.shift();
          }
          const previous = source.pop();
          if (previous) restoreState(entry.doc, previous);
          entry.version += 1;
          broadcast(modelId, entry);
          schedulePersist(modelId);
          if (flags.realtimePgState !== 'on') {
            await saveSnapshot(modelId, storageDir).catch(() => false);
          }
          break;
        }

        case 'presence': {
          if (!modelId) break;
          const entry = models.get(modelId);
          if (!entry) break;
          const presence = entry.presence.get(ws);
          if (!presence) break;
          if (typeof message.viewKey === 'string') {
            viewKey = message.viewKey.trim().slice(0, 120) || null;
            presence.viewKey = viewKey;
          }
          const userInfo =
            message.user && typeof message.user === 'object'
              ? (message.user as Record<string, unknown>)
              : null;
          if (userInfo && typeof userInfo.name === 'string' && userInfo.name.trim()) {
            presence.name = userInfo.name.trim().slice(0, 80);
            presenceName = presence.name;
          }
          if (message.cursor && typeof message.cursor === 'object') {
            const value = message.cursor as Record<string, unknown>;
            if (typeof value.x === 'number' && typeof value.y === 'number') {
              cursor = { x: value.x, y: value.y };
              presence.cursor = cursor;
            } else if (value.x === null && value.y === null) {
              cursor = null;
              presence.cursor = null;
            }
          }
          presence.updatedAt = Date.now();
          broadcastPresence(modelId, entry);
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
      entry.presence.delete(ws);
      broadcastPresence(modelId, entry);
      if (entry.clients.size === 0) {
        await flushState(modelId);
        if (flags.realtimePgState !== 'on') {
          await saveSnapshot(modelId, storageDir);
        }
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
  const bytes = Buffer.byteLength(payload, 'utf8');

  try {
    await fs.mkdir(dir, { recursive: true });
    const file = join(dir, `${modelId}.json`);
    const temp = `${file}.tmp`;
    await fs.writeFile(temp, payload, 'utf8');
    await fs.rename(temp, file);
    if (process.env.TELEMETRY_VERBOSE === 'true') {
      console.log(`[realtime] snapshot ${modelId}: ${bytes} bytes`);
    }
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
  // Em `on`, o estado durável é a única fonte; carregar arquivos antigos
  // faria o realtime servir um snapshot desatualizado após o restart.
  if (flags.realtimePgState === 'on') return;

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

    models.set(modelId, createEntry(doc));
  }
}

export async function closeAll() {
  for (const [modelId, entry] of models) {
    await flushState(modelId);
    if (flags.realtimePgState !== 'on') {
      await saveSnapshot(modelId, storageDir);
    }
    for (const client of entry.clients) {
      client.close();
    }
  }
}
