import type { Element, Edge } from './types';

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let onUpdate: ((modelId: string, elements: Element[], edges: Edge[]) => void) | null = null;

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

function notifyConnection(value: boolean) {
  connected = value;
  onConnectionChange?.(value);
}

function sendJoin() {
  if (pendingModelId && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'join', modelId: pendingModelId }));
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

export function join(modelId: string | null) {
  if (pendingModelId !== modelId) {
    pendingOps = [];
  }
  pendingModelId = modelId;
  if (modelId) sendJoin();
}

export function disconnect() {
  closedManually = true;
  authToken = null;
  generation += 1;
  pendingOps = [];
  pendingModelId = null;
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
