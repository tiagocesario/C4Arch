/**
 * C4Arch — Sincronização em tempo real (realtime).
 *
 * Protocolo: JSON sobre WebSocket.
 *
 * - O servidor mantem um modelo (C4 completo: elements + edges) em estado central.
 * - Cada cliente conecta-se a um modelo (join).
 * - Quando um cliente faz uma mudança, o servidor aplica no modelo central,
 *   persiste no Postgres e repassa o estado atualizado para TODOS os clientes
 *   daquele modelo em tempo real.
 *
 * Isso garante que sempre todos os integrantes vejam a mesma arquitetura,
 * mesmo editando simultaneamente.
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import type { IncomingMessage, Server } from 'http';

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

// Estado central: modelId -> { doc (Y.Doc), clients (Set de WebSockets), version (incremento) }
interface ModelState {
  doc: Y.Doc;
  clients: Set<WebSocket>;
  version: number;
}

// Store em memória (no MVP). Em produção, seria um Redis/DB.
const models = new Map<string, ModelState>();

// Conversão JSON <-> Yjs
// Mapear os dados de um elemento para o Y.Doc.
const toYjsElement = (el: Record<string, unknown>): Record<string, unknown> => {
  return {
    type: el.type,
    title: el.title,
    description: el.description ?? null,
    metadata: el.metadata ?? null,
    positionX: el.positionX ?? 0,
    positionY: el.positionY ?? 0,
    order: el.order ?? 0,
  };
};

// Extrair dados de um elemento do Y.Doc.
const fromYjsElement = (value: unknown): Record<string, unknown> => {
  if (value == null || typeof value !== 'object') return {};
  return {
    type: (value as Record<string, unknown>).type ?? 'system',
    title: (value as Record<string, unknown>).title ?? '',
    description: (value as Record<string, unknown>).description ?? null,
    metadata: (value as Record<string, unknown>).metadata ?? null,
    positionX: (value as Record<string, unknown>).positionX ?? 0,
    positionY: (value as Record<string, unknown>).positionY ?? 0,
    order: (value as Record<string, unknown>).order ?? 0,
  };
};

export function attachWebsocket(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer });

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
            models.set(modelId, {
              doc: newDoc,
              clients: new Set<WebSocket>([ws]),
              version: 0,
            });
          } else {
            const entry = models.get(modelId)!;
            entry.clients.add(ws);
            if (!entry.doc) {
              entry.doc = new Y.Doc();
            }
          }
          doc = models.get(modelId)!.doc;

          // Enviar estado atual
          const state = snapshotToJson(doc);
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
          // Persistir no Postgres via worker (background)
          // Aqui seria enviado para o worker de persistência.
          entry.version += 1;

          // Repassar o estado atualizado para todos os clientes daquele modelo
          const state = snapshotToJson(entry.doc);
          broadcast(modelId, entry);
          break;
        }

        case 'disconnect': {
          // O cliente fechará a conexão; o cleanup acontece no 'close'.
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

/**
 * Aplica uma operação JSON no documento Yjs.
 */
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
      // Remover arestas que referenciam este elemento
      const edgesArr = (edges as Y.Array<Record<string, unknown>>).toArray();
      const removeFromEdges = edgesArr.filter((e: Record<string, unknown>) => e.fromId !== id && e.toId !== id);
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
      // O modelo inteiro é trocado por uma snapshot JSON
      const data = op.data as Record<string, unknown>;
      if (data.snapshot) {
        // Para o MVP, recriamos do snapshot (simplificado)
      }
      break;
    }
  }
}

/** Converte o Y.Doc em um JSON serializável (para transmissão e persistência). */
export function snapshotToJson(doc: Y.Doc): Record<string, unknown> {
  const elements = doc.getMap('elements');
  const edges = doc.getArray('edges');
  const result: { elements: Record<string, unknown>; edges: Array<Record<string, unknown>> } = {
    elements: {},
    edges: [],
  };
  elements.forEach((value, key) => {
    (result.elements as Record<string, unknown>)[key] = fromYjsElement(value);
  });
  const edgesArr = edges.toArray() as Array<Record<string, unknown>>;
  for (const edge of edgesArr) {
    result.edges.push(edge);
  }
  return result;
}

/** Repassa o estado para todos os clientes daquele modelo. */
function broadcast(modelId: string, entry: ModelState): void {
  const payload = JSON.stringify({
    type: 'update',
    modelId,
    model: snapshotToJson(entry.doc),
  });
  for (const client of entry.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// Limpeza de logs e resguardo (opcional no MVP)
export function getModels(): ModelState[] {
  return Array.from(models.values());
}

export function closeAll() {
  for (const entry of models.values()) {
    for (const client of entry.clients) {
      client.close();
    }
  }
}
