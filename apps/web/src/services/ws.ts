import type { Element, Edge } from './types';

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let onUpdate: ((modelId: string, elements: Element[], edges: Edge[]) => void) | null = null;

export interface PresenceUser {
  clientId: string;
  name: string;
  color: string;
  viewKey: string | null;
  cursor: { x: number; y: number } | null;
}

let onPresence: ((modelId: string, viewKey: string | null, users: PresenceUser[]) => void) | null = null;
let onRealtimeError: ((message: string) => void) | null = null;

// Última presença recebida; a UI usa como estado inicial ao montar o painel.
let lastPresence: { modelId: string; viewKey: string | null; users: PresenceUser[] } | null = null;

// Identidade do usuário e view atual, reenviados a cada join/reconexão.
let presenceUser: { name: string; color?: string } | null = null;
let currentViewKey: string | null = null;
let lastCursor: { x: number; y: number } | null = null;

// Indicador de conexão para exibir "WS: online/offline".
export let connected = false;

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:4001';
const WS_PATH = import.meta.env.VITE_WS_PATH ?? '/ws';

// Modelo que o cliente quer acompanhar. Preservado entre reconexões.
let pendingModelId: string | null = null;

// Se o usuário clicou "Desconectar", não faça reconnect automático.
let closedManually = false;

// Geração da conexão: callbacks de sockets antigos são ignorados.
let generation = 0;
let reconnectAttempt = 0;

// Operações enviadas enquanto o socket ainda não estava aberto.
let pendingOps: string[] = [];

// Token de sessão usado para autenticar a conexão WebSocket.
let authToken: string | null = null;

let onConnectionChange: ((connected: boolean) => void) | null = null;

export function setOnConnectionChange(fn: (connected: boolean) => void) {
  onConnectionChange = fn;
}

export function setOnUpdate(fn: (modelId: string, elements: Element[], edges: Edge[]) => void) {
  onUpdate = fn;
}

export function setOnPresence(
  fn: ((modelId: string, viewKey: string | null, users: PresenceUser[]) => void) | null
) {
  onPresence = fn;
}

export function getLastPresence() {
  return lastPresence;
}

export function setOnRealtimeError(fn: ((message: string) => void) | null) {
  onRealtimeError = fn;
}

function notifyConnection(value: boolean) {
  connected = value;
  onConnectionChange?.(value);
}

function sendJoin() {
  if (pendingModelId && socket?.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: 'join',
        modelId: pendingModelId,
        viewKey: currentViewKey ?? undefined,
        user: presenceUser
          ? { name: presenceUser.name, color: presenceUser.color, cursor: lastCursor }
          : undefined,
      })
    );
  }
}

function scheduleReconnect() {
  if (closedManually || reconnectTimer) return;
  const delay = Math.min(800 * Math.pow(2, reconnectAttempt), 8000);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

export function setToken(token: string | null) {
  authToken = token;

  if (!token) {
    disconnect();
    return;
  }

  closedManually = false;
  reconnectAttempt = 0;

  if (socket) {
    generation += 1;
    socket.close();
    socket = null;
    notifyConnection(false);
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  connect();
}

export function connect() {
  if (!authToken) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  closedManually = false;
  const currentGeneration = ++generation;
  const ws = new WebSocket(
    `${WS_URL}${WS_PATH}?token=${encodeURIComponent(authToken)}`
  );
  socket = ws;
  ws.binaryType = 'blob';

  ws.onopen = () => {
    if (currentGeneration !== generation) return;
    reconnectAttempt = 0;
    notifyConnection(true);
    // Após uma queda, o modelo pendente continua definido e o join é reenviado.
    sendJoin();
    const queued = pendingOps;
    pendingOps = [];
    for (const payload of queued) {
      ws.send(payload);
    }
  };

  ws.onmessage = (e) => {
    if (currentGeneration !== generation) return;
    let msg: {
      type?: string;
      modelId?: string;
      model?: { elements?: unknown; edges?: unknown };
      viewKey?: string | null;
      users?: PresenceUser[];
      error?: string;
    };
    try {
      msg = JSON.parse(e.data as string);
    } catch {
      return;
    }
    if ((msg.type === 'state' || msg.type === 'update') && msg.modelId) {
      const elements = Array.isArray(msg.model?.elements) ? (msg.model?.elements as Element[]) : [];
      const edges = Array.isArray(msg.model?.edges) ? (msg.model?.edges as Edge[]) : [];
      onUpdate?.(msg.modelId, elements, edges);
      return;
    }
    if (msg.type === 'presence' && msg.modelId) {
      const users = Array.isArray(msg.users) ? msg.users : [];
      lastPresence = { modelId: msg.modelId, viewKey: msg.viewKey ?? null, users };
      onPresence?.(msg.modelId, msg.viewKey ?? null, users);
      return;
    }
    if (msg.type === 'error') {
      onRealtimeError?.(msg.error ?? 'Erro de colaboração');
    }
  };

  ws.onclose = (event) => {
    if (currentGeneration !== generation) return;
    socket = null;
    notifyConnection(false);

    // 1008 = política de autenticação. Não insiste com token inválido.
    if (event.code === 1008 || !authToken) {
      closedManually = true;
      return;
    }
    scheduleReconnect();
  };

  ws.onerror = () => {
    // O evento de erro é seguido por `close`; garante que o socket seja liberado.
    ws.close();
  };
}

export function sendOp(op: Record<string, unknown>) {
  const payload = JSON.stringify(op);
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    // Guarda patches do modelo atual para reenviar quando a conexão abrir.
    const opModelId = typeof op.modelId === 'string' ? op.modelId : null;
    if (op.type === 'patch' && opModelId && opModelId === pendingModelId) {
      pendingOps.push(payload);
      if (pendingOps.length > 100) pendingOps.shift();
    }
    return;
  }
  socket.send(payload);
}

export function join(
  modelId: string | null,
  options?: { viewKey?: string | null; user?: { name: string; color?: string } | null }
) {
  if (pendingModelId !== modelId) {
    pendingOps = [];
  }
  if (options) {
    if (options.viewKey !== undefined) currentViewKey = options.viewKey;
    if (options.user !== undefined) presenceUser = options.user;
  }
  pendingModelId = modelId;
  if (modelId) sendJoin();
}

/** Atualiza a view/sala de presença do usuário. */
export function setViewKey(viewKey: string | null) {
  currentViewKey = viewKey;
  if (pendingModelId && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'presence', modelId: pendingModelId, viewKey }));
  }
}

/** Atualiza nome/cor usados na presença. */
export function setPresenceUser(user: { name: string; color?: string } | null) {
  presenceUser = user;
}

/** Envia a posição do cursor (ou `null` para limpar) na view atual. */
export function sendPresence(cursor: { x: number; y: number } | null) {
  lastCursor = cursor;
  if (!pendingModelId || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(
    JSON.stringify({
      type: 'presence',
      modelId: pendingModelId,
      viewKey: currentViewKey,
      cursor: cursor ?? { x: null, y: null },
      user: presenceUser ?? undefined,
    })
  );
}

export function undo() {
  if (pendingModelId) sendOp({ type: 'undo', modelId: pendingModelId });
}

export function redo() {
  if (pendingModelId) sendOp({ type: 'redo', modelId: pendingModelId });
}

export function disconnect() {
  closedManually = true;
  authToken = null;
  generation += 1;
  pendingOps = [];
  pendingModelId = null;
  currentViewKey = null;
  lastCursor = null;
  lastPresence = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
  notifyConnection(false);
}
