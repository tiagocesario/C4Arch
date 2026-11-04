let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let onUpdate: ((modelId: string, elements: Element[], edges: Edge[]) => void) | null = null;
let subscribers = 0;
export let connected = false;

import type { Element, Edge } from './types';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:4001';
const WS_PATH = import.meta.env.VITE_WS_PATH ?? '/ws';
let pendingModelId = '';

export function setOnUpdate(fn: (modelId: string, elements: Element[], edges: Edge[]) => void) {
  onUpdate = fn;
}

function joinPending() {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'join', modelId: pendingModelId }));
  }
}

export function connect() {
  if (socket) return;
  socket = new WebSocket(`${WS_URL}${WS_PATH}`);
  socket.binaryType = 'blob';
  socket.onopen = () => {
    connected = true;
    joinPending();
  };
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data) as {
      type: string;
      modelId: string;
      model?: { elements: unknown[]; edges: unknown[] };
    };
    if (msg.type === 'state' || msg.type === 'update') {
      connected = true;
      onUpdate?.(msg.modelId, msg.model?.elements as Element[] ?? [], msg.model?.edges as Edge[] ?? []);
    }
  };
  socket.onclose = () => {
    connected = false;
    if (subscribers === 0) return;
    reconnectTimer = setTimeout(() => connect(), 800);
  };
}

export function sendPatch(modelId: string, patch: Record<string, unknown>) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'patch', modelId, patch }));
}

export function sendOp(op: Record<string, unknown>) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(op));
}

export function join(modelId: string) {
  pendingModelId = modelId;
  joinPending();
}

export function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
  connected = false;
}
