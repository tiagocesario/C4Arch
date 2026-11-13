import type { Response } from 'express';
import { pool } from '../db.js';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import { getModelAccess, isWriterRole } from '../auth/access.js';
import { loadModelGraph } from '../c4/model-graph.js';
import { computeAutoLayout } from '../c4/autolayout.js';
import { viewTypeFromC4Type } from '../c4/canonical.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

interface ViewRow {
  id: string;
  model_id: string;
  key: string;
  type: string;
  scope_element_id: string | null;
  title: string | null;
  description: string | null;
  auto_layout: boolean;
}

async function ensureView(
  modelId: string,
  key: string,
  fallbackType: string,
  title: string | null
): Promise<ViewRow> {
  const existing = await pool.query<ViewRow>(
    'SELECT * FROM model_views WHERE model_id = $1 AND key = $2',
    [modelId, key]
  );
  if (existing.rows[0]) return existing.rows[0];

  const type = viewTypeFromC4Type(key === fallbackType ? fallbackType : key);
  const inserted = await pool.query<ViewRow>(
    `INSERT INTO model_views (model_id, key, type, title, include, exclude, auto_layout)
     VALUES ($1, $2, $3, $4, '[]'::jsonb, '[]'::jsonb, FALSE)
     ON CONFLICT (model_id, key) DO UPDATE SET title = COALESCE(model_views.title, EXCLUDED.title)
     RETURNING *`,
    [modelId, key, type, title]
  );
  return inserted.rows[0];
}

interface LayoutItem {
  elementId?: string | null;
  objectKey?: string | null;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  style?: Record<string, unknown> | null;
}

function parseLayoutItem(value: unknown): LayoutItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const elementId = typeof record.elementId === 'string' && isUuid(record.elementId) ? record.elementId : null;
  const objectKey = typeof record.objectKey === 'string' && record.objectKey.trim() ? record.objectKey.trim() : null;
  if (!elementId && !objectKey) return null;
  return {
    elementId,
    objectKey,
    x,
    y,
    width: typeof record.width === 'number' && Number.isFinite(record.width) ? record.width : null,
    height: typeof record.height === 'number' && Number.isFinite(record.height) ? record.height : null,
    style:
      record.style && typeof record.style === 'object' && !Array.isArray(record.style)
        ? (record.style as Record<string, unknown>)
        : null,
  };
}

export class ViewsController {
  /** Lista as views canônicas (ou a view derivada do tipo do modelo). */
  static async list(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const views = await pool.query<ViewRow & { element_count: string }>(
        `SELECT v.*, count(l.id)::text AS element_count
           FROM model_views v
           LEFT JOIN model_view_layout l ON l.view_id = v.id
          WHERE v.model_id = $1
          GROUP BY v.id
          ORDER BY v.created_at`,
        [id]
      );

      if (views.rows.length > 0) {
        return res.json({
          modelId: id,
          source: 'canonical',
          views: views.rows.map((view) => ({
            id: view.id,
            key: view.key,
            type: view.type,
            title: view.title,
            description: view.description,
            scopeElementId: view.scope_element_id,
            autoLayout: view.auto_layout,
            elementCount: Number(view.element_count ?? 0),
          })),
        });
      }

      const graph = await loadModelGraph(id);
      const c4Type = String(model.c4_type ?? 'container');
      return res.json({
        modelId: id,
        source: graph?.source ?? 'legacy',
        views: [
          {
            id: null,
            key: c4Type,
            type: viewTypeFromC4Type(c4Type),
            title: String(model.title ?? 'Visão principal'),
            description: null,
            scopeElementId: null,
            autoLayout: true,
            elementCount: graph?.elements.length ?? 0,
          },
        ],
      });
    } catch (err) {
      console.error('[views] list error', err);
      return res.status(500).json({ error: 'Erro ao listar views' });
    }
  }

  /** Layout persistido de uma view; cai para as posições legadas quando vazio. */
  static async layout(req: AuthenticatedRequest, res: Response) {
    const { id, key } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const view = await pool.query<ViewRow>(
        'SELECT * FROM model_views WHERE model_id = $1 AND key = $2',
        [id, key]
      );
      if (view.rows[0]) {
        const items = await pool.query(
          `SELECT element_id, object_key, x, y, width, height, style
             FROM model_view_layout
            WHERE view_id = $1
            ORDER BY x, y`,
          [view.rows[0].id]
        );
        if (items.rows.length > 0) {
          return res.json({
            modelId: id,
            viewKey: key,
            source: 'canonical',
            items: items.rows.map((row) => ({
              elementId: row.element_id,
              objectKey: row.object_key,
              x: row.x ?? 0,
              y: row.y ?? 0,
              width: row.width,
              height: row.height,
              style: row.style ?? {},
            })),
          });
        }
      }

      const graph = await loadModelGraph(id);
      return res.json({
        modelId: id,
        viewKey: key,
        source: graph?.source ?? 'legacy',
        items: (graph?.elements ?? []).map((element) => ({
          elementId: element.id,
          objectKey: null,
          x: element.position_x,
          y: element.position_y,
          width: 190,
          height: 90,
          style: {},
        })),
      });
    } catch (err) {
      console.error('[views] layout error', err);
      return res.status(500).json({ error: 'Erro ao carregar layout' });
    }
  }

  /** Salva posições manuais (drag & drop) para uma view. */
  static async saveLayout(req: AuthenticatedRequest, res: Response) {
    const { id, key } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    const body = (req.body ?? {}) as { items?: unknown };
    if (!Array.isArray(body.items)) {
      return res.status(400).json({ error: 'items deve ser um array' });
    }
    const items = body.items.map(parseLayoutItem).filter((item): item is LayoutItem => item !== null);
    if (items.length !== body.items.length) {
      return res.status(400).json({ error: 'Item de layout inválido (x/y e elementId/objectKey são obrigatórios)' });
    }

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const view = await ensureView(id, key, String(model.c4_type ?? 'container'), String(model.title ?? ''));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const item of items) {
          const style = JSON.stringify(item.style ?? { source: 'manual' });
          if (item.elementId) {
            await client.query(
              `INSERT INTO model_view_layout (view_id, element_id, object_key, x, y, width, height, style)
               VALUES ($1, $2, NULL, $3, $4, $5, $6, $7::jsonb)
               ON CONFLICT (view_id, element_id) WHERE element_id IS NOT NULL
               DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y,
                             width = COALESCE(EXCLUDED.width, model_view_layout.width),
                             height = COALESCE(EXCLUDED.height, model_view_layout.height),
                             style = EXCLUDED.style`,
              [view.id, item.elementId, item.x, item.y, item.width, item.height, style]
            );
            await client.query(
              'UPDATE elements SET position_x = $1, position_y = $2 WHERE id = $3 AND model_id = $4',
              [Math.round(item.x), Math.round(item.y), item.elementId, id]
            );
          } else if (item.objectKey) {
            await client.query(
              `INSERT INTO model_view_layout (view_id, element_id, object_key, x, y, width, height, style)
               VALUES ($1, NULL, $2, $3, $4, $5, $6, $7::jsonb)
               ON CONFLICT (view_id, object_key) WHERE object_key IS NOT NULL
               DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y,
                             width = COALESCE(EXCLUDED.width, model_view_layout.width),
                             height = COALESCE(EXCLUDED.height, model_view_layout.height),
                             style = EXCLUDED.style`,
              [view.id, item.objectKey, item.x, item.y, item.width, item.height, style]
            );
          }
        }
        await client.query('UPDATE model_views SET updated_at = NOW() WHERE id = $1', [view.id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      return res.json({ ok: true, viewKey: key, items: items.length });
    } catch (err) {
      console.error('[views] saveLayout error', err);
      return res.status(500).json({ error: 'Erro ao salvar layout' });
    }
  }

  /** Recalcula o layout e persiste o resultado (legado e canônico). */
  static async autoLayout(req: AuthenticatedRequest, res: Response) {
    const { id, key } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const graph = await loadModelGraph(id);
      if (!graph) return res.status(404).json({ error: 'Modelo não encontrado' });

      const direction = req.body?.direction === 'TB' ? 'TB' : 'LR';
      const positions = computeAutoLayout(
        graph.elements.map((element) => ({
          id: element.id,
          type: element.type,
          title: element.title,
        })),
        graph.edges.map((edge) => ({ from: edge.from_id, to: edge.to_id })),
        { direction }
      );

      const view = await ensureView(id, key, String(model.c4_type ?? 'container'), String(model.title ?? ''));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const position of positions) {
          await client.query(
            'UPDATE elements SET position_x = $1, position_y = $2 WHERE id = $3 AND model_id = $4',
            [Math.round(position.x), Math.round(position.y), position.id, id]
          );
          await client.query(
            `INSERT INTO model_view_layout (view_id, element_id, object_key, x, y, width, height, style)
             VALUES ($1, $2, NULL, $3, $4, 190, 90, '{"source":"autolayout"}'::jsonb)
             ON CONFLICT (view_id, element_id) WHERE element_id IS NOT NULL
             DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, style = EXCLUDED.style`,
            [view.id, position.id, position.x, position.y]
          );
        }
        await client.query('UPDATE model_views SET auto_layout = TRUE, updated_at = NOW() WHERE id = $1', [
          view.id,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      return res.json({ ok: true, viewKey: key, positions, source: graph.source });
    } catch (err) {
      console.error('[views] autoLayout error', err);
      return res.status(500).json({ error: 'Erro ao recalcular layout' });
    }
  }
}
