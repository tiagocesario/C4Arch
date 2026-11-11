import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { stableStringify } from './canonical.js';

/**
 * Serialização canônica do estado colaborativo (Yjs) usada pelo M3.
 *
 * O `model_state` guarda o update binário do Yjs. Para hash, versões e
 * projeção precisamos da mesma visão lógica que o realtime envia ao cliente:
 * um mapa de elementos e uma lista de arestas, com campos normalizados.
 */

export interface StateElement {
  id: string;
  type: string;
  title: string;
  description: string | null;
  metadata: unknown;
  position_x: number;
  position_y: number;
  order: number;
}

export interface StateEdge {
  id: string;
  from_id: string;
  to_id: string;
  label: string;
  type: string;
}

export interface DecodedState {
  elements: StateElement[];
  edges: StateEdge[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeElement(id: string, value: unknown): StateElement {
  const record = asRecord(value);
  return {
    id,
    type: asText(record.type, 'system'),
    title: asText(record.title),
    description: typeof record.description === 'string' ? record.description : null,
    metadata: record.metadata ?? null,
    position_x: asNumber(record.positionX ?? record.position_x),
    position_y: asNumber(record.positionY ?? record.position_y),
    order: asNumber(record.order),
  };
}

function normalizeEdge(value: unknown, index: number): StateEdge {
  const record = asRecord(value);
  const fromId = asText(record.fromId ?? record.from_id);
  const toId = asText(record.toId ?? record.to_id);
  return {
    id: asText(record.id, `${fromId}->${toId}:${index}`),
    from_id: fromId,
    to_id: toId,
    label: asText(record.label),
    type: asText(record.type, 'call'),
  };
}

/** Decodifica o update Yjs em elementos/arestas normalizados e ordenados. */
export function decodeModelState(state: Uint8Array): DecodedState {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
  } catch (err) {
    throw new Error(`Estado Yjs inválido: ${err instanceof Error ? err.message : String(err)}`);
  }

  const elements: StateElement[] = [];
  for (const [id, value] of doc.getMap('elements')) {
    if (!id) continue;
    elements.push(normalizeElement(id, value));
  }
  elements.sort((a, b) => a.id.localeCompare(b.id));

  const edges = (doc.getArray('edges').toArray() as unknown[]).map(normalizeEdge);
  edges.sort(
    (a, b) =>
      a.from_id.localeCompare(b.from_id) ||
      a.to_id.localeCompare(b.to_id) ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id)
  );

  return { elements, edges };
}

/** Cria o update Yjs a partir de um snapshot lógico (usado no restore). */
export function encodeModelState(decoded: DecodedState): Uint8Array {
  const doc = new Y.Doc();
  for (const element of decoded.elements) {
    doc.getMap('elements').set(element.id, {
      type: element.type,
      title: element.title,
      description: element.description,
      metadata: element.metadata,
      positionX: element.position_x,
      positionY: element.position_y,
      order: element.order,
    });
  }
  for (const edge of decoded.edges) {
    doc.getArray('edges').push([
      {
        id: edge.id,
        fromId: edge.from_id,
        toId: edge.to_id,
        label: edge.label,
        type: edge.type,
      },
    ] as Array<unknown>);
  }
  return Y.encodeStateAsUpdate(doc);
}

export function stateVectorOf(state: Uint8Array): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return Y.encodeStateVector(doc);
}

/** Hash estável do conteúdo lógico (independente da ordem/origem do update). */
export function computeStateContentHash(decoded: DecodedState): string {
  return `sha256:${createHash('sha256').update(stableStringify(decoded)).digest('hex')}`;
}

export function hashModelState(state: Uint8Array): string {
  return computeStateContentHash(decodeModelState(state));
}
