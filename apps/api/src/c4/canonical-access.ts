import { pool } from '../db.js';
import type { LegacyElementRow, LegacyEdgeRow } from './canonical.js';
import { toCanonicalElement, toCanonicalRelationship, viewTypeFromC4Type } from './canonical.js';

/**
 * Leitura canônica (M5).
 *
 * Quando `CANONICAL_MODEL=on`, a API passa a servir elementos e relações a
 * partir das tabelas canônicas, projetando-as no formato legado que o frontend
 * e o realtime esperam. O fallback para o legado acontece quando o canônico
 * está vazio/inconsistente para o modelo.
 */

const LEGACY_TYPE_BY_KIND: Record<string, string> = {
  person: 'actor',
  software_system: 'system',
  container: 'container',
  component: 'component',
};

function metadataFromCanonical(row: {
  technology: string | null;
  url: string | null;
  tags: string[] | null;
  properties: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const properties = { ...(row.properties ?? {}) };
  const metadata: Record<string, unknown> = { ...properties };
  if (row.technology) metadata.technology = row.technology;
  if (row.url) metadata.url = row.url;
  if (Array.isArray(row.tags) && row.tags.length > 0) metadata.tags = row.tags;
  delete metadata.legacyType;
  return Object.keys(metadata).length > 0 ? metadata : null;
}

export async function loadCanonicalElements(modelId: string): Promise<LegacyElementRow[]> {
  const elements = await pool.query<{
    id: string;
    model_id: string;
    app_id: string | null;
    service_id: string | null;
    kind: string;
    name: string;
    description: string | null;
    technology: string | null;
    url: string | null;
    tags: string[] | null;
    properties: Record<string, unknown> | null;
  }>(
    `SELECT id, model_id, app_id, service_id, kind, name, description,
            technology, url, tags, properties
       FROM model_elements
      WHERE model_id = $1
      ORDER BY name`,
    [modelId]
  );

  if (elements.rows.length === 0) return [];

  const layout = await pool.query<{
    element_id: string | null;
    x: number | null;
    y: number | null;
  }>(
    `SELECT l.element_id, l.x, l.y
       FROM model_view_layout l
       JOIN model_views v ON v.id = l.view_id
      WHERE v.model_id = $1
        AND l.element_id IS NOT NULL
      ORDER BY v.created_at, l.element_id`,
    [modelId]
  );

  const positionById = new Map<string, { x: number; y: number }>();
  for (const row of layout.rows) {
    if (!row.element_id) continue;
    if (positionById.has(row.element_id)) continue;
    positionById.set(row.element_id, {
      x: row.x ?? 0,
      y: row.y ?? 0,
    });
  }

  return elements.rows.map((row) => {
    const position = positionById.get(row.id) ?? { x: 0, y: 0 };
    const properties = row.properties ?? {};
    const type = LEGACY_TYPE_BY_KIND[row.kind] ?? 'component';
    const orderValue = properties.order;
    return {
      id: row.id,
      model_id: row.model_id,
      app_id: row.app_id,
      service_id: row.service_id,
      type,
      title: row.name,
      description: row.description,
      metadata: metadataFromCanonical(row),
      position_x: Math.round(position.x),
      position_y: Math.round(position.y),
      order: typeof orderValue === 'number' ? orderValue : 0,
    };
  });
}

export async function canonicalModelHasData(modelId: string): Promise<boolean> {
  const result = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM model_elements WHERE model_id = $1',
    [modelId]
  );
  return Number(result.rows[0]?.count ?? 0) > 0;
}

export async function loadCanonicalEdges(modelId: string): Promise<LegacyEdgeRow[]> {
  const relationships = await pool.query<{
    id: string;
    model_id: string;
    source_id: string;
    target_id: string;
    description: string | null;
    technology: string | null;
    properties: Record<string, unknown> | null;
  }>(
    `SELECT id, model_id, source_id, target_id, description, technology, properties
       FROM model_relationships
      WHERE model_id = $1
      ORDER BY created_at`,
    [modelId]
  );

  if (relationships.rows.length === 0) return [];

  const elements = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM model_elements WHERE model_id = $1',
    [modelId]
  );
  const nameById = new Map(elements.rows.map((row) => [row.id, row.name]));

  return relationships.rows.map((row) => {
    const properties = row.properties ?? {};
    const legacyType = properties.legacyType;
    const type =
      typeof legacyType === 'string' && ['call', 'http', 'message', 'depends'].includes(legacyType)
        ? legacyType
        : 'call';
    return {
      id: row.id,
      model_id: row.model_id,
      from_id: row.source_id,
      to_id: row.target_id,
      label: row.description ?? '',
      type,
    };
  }).filter((edge) => nameById.has(edge.from_id) && nameById.has(edge.to_id));
}

export async function syncCanonicalElement(element: LegacyElementRow): Promise<void> {
  const canonical = toCanonicalElement(element);
  await pool.query(
    `INSERT INTO model_elements
       (id, model_id, parent_element_id, identifier, kind, name, description,
        technology, url, tags, properties, app_id, service_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
     ON CONFLICT (id) DO UPDATE SET
       parent_element_id = EXCLUDED.parent_element_id,
       identifier = EXCLUDED.identifier,
       kind = EXCLUDED.kind,
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       technology = EXCLUDED.technology,
       url = EXCLUDED.url,
       tags = EXCLUDED.tags,
       properties = EXCLUDED.properties,
       app_id = EXCLUDED.app_id,
       service_id = EXCLUDED.service_id,
       updated_at = NOW()`,
    [
      canonical.id,
      canonical.model_id,
      canonical.parent_element_id,
      canonical.identifier,
      canonical.kind,
      canonical.name,
      canonical.description,
      canonical.technology,
      canonical.url,
      canonical.tags,
      JSON.stringify(canonical.properties),
      canonical.app_id,
      canonical.service_id,
    ]
  );

  const viewKey = await ensureCanonicalView(element.model_id);
  const view = await pool.query<{ id: string }>(
    'SELECT id FROM model_views WHERE model_id = $1 AND key = $2',
    [element.model_id, viewKey]
  );
  const viewId = view.rows[0]?.id;
  if (!viewId) return;

  await pool.query(
    'DELETE FROM model_view_layout WHERE view_id = $1 AND element_id = $2',
    [viewId, element.id]
  );
  await pool.query(
    `INSERT INTO model_view_layout (view_id, element_id, object_key, x, y, width, height, style)
     VALUES ($1, $2, NULL, $3, $4, NULL, NULL, $5::jsonb)`,
    [viewId, element.id, element.position_x, element.position_y, JSON.stringify({ source: 'legacy' })]
  );
}

export async function removeCanonicalElement(elementId: string): Promise<void> {
  await pool.query('DELETE FROM model_elements WHERE id = $1', [elementId]);
}

export async function syncCanonicalEdge(edge: LegacyEdgeRow): Promise<void> {
  const canonical = toCanonicalRelationship(edge);
  await pool.query(
    `INSERT INTO model_relationships
       (id, model_id, source_id, target_id, description, technology, tags, properties)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       source_id = EXCLUDED.source_id,
       target_id = EXCLUDED.target_id,
       description = EXCLUDED.description,
       technology = EXCLUDED.technology,
       tags = EXCLUDED.tags,
       properties = EXCLUDED.properties,
       updated_at = NOW()`,
    [
      canonical.id,
      canonical.model_id,
      canonical.source_id,
      canonical.target_id,
      canonical.description,
      canonical.technology,
      canonical.tags,
      JSON.stringify(canonical.properties),
    ]
  );
}

export async function removeCanonicalEdge(edgeId: string): Promise<void> {
  await pool.query('DELETE FROM model_relationships WHERE id = $1', [edgeId]);
}

async function ensureCanonicalView(modelId: string): Promise<string> {
  const existing = await pool.query<{ key: string }>(
    'SELECT key FROM model_views WHERE model_id = $1 ORDER BY created_at LIMIT 1',
    [modelId]
  );
  if (existing.rows.length > 0) return existing.rows[0].key;

  const model = await pool.query<{ c4_type: string | null; title: string | null }>(
    'SELECT c4_type, title FROM models WHERE id = $1',
    [modelId]
  );
  const c4Type = model.rows[0]?.c4_type ?? 'container';
  const title = model.rows[0]?.title ?? null;
  const type = viewTypeFromC4Type(c4Type);

  await pool.query(
    `INSERT INTO model_views (model_id, key, type, title)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (model_id, key) DO NOTHING`,
    [modelId, c4Type, type, title]
  );
  return c4Type;
}
