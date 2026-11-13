import { pool } from '../db.js';
import { flags } from '../flags.js';
import {
  canonicalModelHasData,
  loadCanonicalEdges,
  loadCanonicalElements,
} from './canonical-access.js';

/**
 * Visão comum do modelo usada por exportação, importação, autolayout,
 * preview e MCP. Respeita `CANONICAL_MODEL` e cai no legado quando o canônico
 * está vazio, exatamente como os controllers de leitura.
 */

export interface GraphElement {
  id: string;
  model_id: string;
  type: string;
  title: string;
  description: string | null;
  metadata: unknown;
  position_x: number;
  position_y: number;
  order: number;
  app_id?: string | null;
  service_id?: string | null;
}

export interface GraphEdge {
  id: string;
  model_id: string;
  from_id: string;
  to_id: string;
  label: string;
  type: string;
  source_title?: string | null;
  target_title?: string | null;
}

export interface ModelGraph {
  model: Record<string, unknown>;
  elements: GraphElement[];
  edges: GraphEdge[];
  source: 'canonical' | 'legacy';
}

function asFinite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeElement(row: Record<string, unknown>): GraphElement {
  return {
    id: String(row.id),
    model_id: String(row.model_id),
    type: typeof row.type === 'string' ? row.type : 'system',
    title: typeof row.title === 'string' ? row.title : '',
    description: typeof row.description === 'string' ? row.description : null,
    metadata: row.metadata ?? null,
    position_x: asFinite(row.position_x ?? row.positionX),
    position_y: asFinite(row.position_y ?? row.positionY),
    order: asFinite(row.order),
    app_id: typeof row.app_id === 'string' ? row.app_id : null,
    service_id: typeof row.service_id === 'string' ? row.service_id : null,
  };
}

function normalizeEdge(row: Record<string, unknown>): GraphEdge {
  return {
    id: String(row.id),
    model_id: String(row.model_id),
    from_id: String(row.from_id ?? row.fromId ?? ''),
    to_id: String(row.to_id ?? row.toId ?? ''),
    label: typeof row.label === 'string' ? row.label : '',
    type: typeof row.type === 'string' ? row.type : 'call',
    source_title: typeof row.source_title === 'string' ? row.source_title : null,
    target_title: typeof row.target_title === 'string' ? row.target_title : null,
  };
}

export async function loadModelGraph(modelId: string): Promise<ModelGraph | null> {
  const modelResult = await pool.query('SELECT * FROM models WHERE id = $1', [modelId]);
  const model = modelResult.rows[0];
  if (!model) return null;

  if (flags.canonicalModel === 'on' && (await canonicalModelHasData(modelId))) {
    const elements = await loadCanonicalElements(modelId);
    const edges = await loadCanonicalEdges(modelId);
    return {
      model,
      elements: elements.map((element) => normalizeElement(element as unknown as Record<string, unknown>)),
      edges: edges.map((edge) => normalizeEdge(edge as unknown as Record<string, unknown>)),
      source: 'canonical',
    };
  }

  const [elements, edges] = await Promise.all([
    pool.query('SELECT * FROM elements WHERE model_id = $1 ORDER BY "order"', [modelId]),
    pool.query(
      `SELECT e.*, from_elem.title AS source_title, to_elem.title AS target_title
         FROM edges e
         JOIN elements from_elem ON from_elem.id = e.from_id
         JOIN elements to_elem ON to_elem.id = e.to_id
        WHERE e.model_id = $1
        ORDER BY e.created_at`,
      [modelId]
    ),
  ]);

  return {
    model,
    elements: elements.rows.map(normalizeElement),
    edges: edges.rows.map(normalizeEdge),
    source: 'legacy',
  };
}

export function graphSummary(graph: ModelGraph): {
  elements: number;
  relationships: number;
  byType: Record<string, number>;
} {
  const byType: Record<string, number> = {};
  for (const element of graph.elements) {
    byType[element.type] = (byType[element.type] ?? 0) + 1;
  }
  return {
    elements: graph.elements.length,
    relationships: graph.edges.length,
    byType,
  };
}
