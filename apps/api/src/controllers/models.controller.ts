import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';

export class ModelController {
  static async list(req: AuthenticatedRequest, res: Response) {
    const userId = req.user!.id;
    const result = await pool.query(
      `SELECT m.*, o.name AS org_name
       FROM models m
       JOIN organizations o ON o.id = m.org_id
       JOIN memberships mem ON mem.org_id = o.id
       WHERE mem.user_id = $1
       ORDER BY m.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const { orgId, title, status } = req.body as {
      orgId: string;
      title: string;
      status?: 'draft' | 'final';
    };
    if (!orgId || !title) {
      return res.status(400).json({ error: 'orgId e title são obrigatórios' });
    }
    const org = await pool.query('SELECT id FROM organizations WHERE id = $1', [orgId]);
    if (org.rows.length === 0) {
      return res.status(404).json({ error: 'Organização não encontrada' });
    }
    const member = await pool.query(
      'SELECT id FROM memberships WHERE org_id = $1 AND user_id = $2',
      [orgId, req.user!.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Não pertence a esta organização' });
    }
    const model = await pool.query(
      `INSERT INTO models (org_id, title, status)
       VALUES ($1, $2, COALESCE($3, 'draft')) RETURNING *`,
      [orgId, title, status]
    );
    res.status(201).json(model.rows[0]);
  }

  static async get(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    console.log('[DEBUG]', req.path, 'params=', JSON.stringify(req.params));
    console.log('[DEBUG]', req.path, 'id=', JSON.stringify(id));
    const model = await pool.query('SELECT * FROM models WHERE id = $1', [id]);
    if (model.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    const modelData = model.rows[0];
    const elements = await pool.query(
      'SELECT * FROM elements WHERE model_id = $1 ORDER BY "order"',
      [id]
    );
    const edges = await pool.query(
      `SELECT e.*, from_elem.title AS source_title, to_elem.title AS target_title
       FROM edges e
       JOIN elements from_elem ON from_elem.id = e.from_id
       JOIN elements to_elem ON to_elem.id = e.to_id
       WHERE e.model_id = $1`,
      [id]
    );
    res.json({ ...modelData, elements: elements.rows, edges: edges.rows });
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { title, status } = req.body as { title?: string; status?: 'draft' | 'final' };
    const model = await pool.query('SELECT id FROM models WHERE id = $1', [id]);
    if (model.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    const result = await pool.query(
      `UPDATE models
       SET title = COALESCE($1, title),
           status = COALESCE($2, status),
           updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [title, status, id]
    );
    res.json(result.rows[0]);
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const model = await pool.query('SELECT id FROM models WHERE id = $1', [id]);
    if (model.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    await pool.query('DELETE FROM models WHERE id = $1', [id]);
    res.json({ ok: true });
  }

  // ===== Elementos =====
  static async createElement(req: AuthenticatedRequest, res: Response) {
    const { modelId } = req.params;
    const { title, type, description, metadata, position_x, position_y, order } = req.body as {
      title: string;
      type: string;
      description?: string;
      metadata?: Record<string, unknown>;
      position_x?: number;
      position_y?: number;
      order?: number;
    };
    const model = await pool.query('SELECT id FROM models WHERE id = $1', [modelId]);
    if (model.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    const el = await pool.query(
      `INSERT INTO elements (model_id, title, type, description, metadata, position_x, position_y, "order", updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), COALESCE($7, 0), COALESCE($8, 0), NOW())
       RETURNING *`,
      [modelId, title, type, description, metadata, position_x, position_y, order]
    );
    res.status(201).json(el.rows[0]);
  }

  static async updateElement(req: AuthenticatedRequest, res: Response) {
    const { modelId, id } = req.params;
    const { title, type, description, metadata, position_x, position_y, order } = req.body as {
      title?: string;
      type?: string;
      description?: string;
      metadata?: Record<string, unknown>;
      position_x?: number;
      position_y?: number;
      order?: number;
    };
    const model = await pool.query('SELECT id FROM models WHERE id = $1', [modelId]);
    if (model.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    const el = await pool.query(
      `UPDATE elements
       SET title = COALESCE($1, title),
           type = COALESCE($2, type),
           description = COALESCE($3, description),
           metadata = COALESCE($4, metadata),
           position_x = COALESCE($5, position_x),
           position_y = COALESCE($6, position_y),
           "order" = COALESCE($7, "order"),
           updated_at = NOW()
       WHERE id = $8 AND model_id = $9
       RETURNING *`,
      [title, type, description, metadata, position_x, position_y, order, id, modelId]
    );
    if (el.rows.length === 0) {
      return res.status(404).json({ error: 'Elemento não encontrado' });
    }
    res.json(el.rows[0]);
  }

  static async deleteElement(req: AuthenticatedRequest, res: Response) {
    const { modelId, id } = req.params;
    const model = await pool.query('SELECT id FROM models WHERE id = $1', [modelId]);
    if (model.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    const el = await pool.query('DELETE FROM elements WHERE id = $1 AND model_id = $2 RETURNING *', [id, modelId]);
    if (el.rows.length === 0) {
      return res.status(404).json({ error: 'Elemento não encontrado' });
    }
    res.json({ ok: true });
  }

  // ===== Edges =====
  static async createEdge(req: AuthenticatedRequest, res: Response) {
    const { modelId } = req.params;
    const { fromId, toId, label, type } = req.body as { fromId: string; toId: string; label?: string; type?: string };
    const model = await pool.query('SELECT id FROM models WHERE id = $1', [modelId]);
    if (model.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    const from = await pool.query('SELECT id FROM elements WHERE id = $1 AND model_id = $2', [fromId, modelId]);
    if (from.rows.length === 0) {
      return res.status(404).json({ error: 'Elemento de origem não encontrado' });
    }
    const to = await pool.query('SELECT id FROM elements WHERE id = $1 AND model_id = $2', [toId, modelId]);
    if (to.rows.length === 0) {
      return res.status(404).json({ error: 'Elemento de destino não encontrado' });
    }
    const edge = await pool.query(
      `INSERT INTO edges (model_id, from_id, to_id, label, type, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [modelId, fromId, toId, label, type]
    );
    res.status(201).json(edge.rows[0]);
  }

  static async updateEdge(req: AuthenticatedRequest, res: Response) {
    const { modelId, id } = req.params;
    const { fromId, toId, label, type } = req.body as { fromId?: string; toId?: string; label?: string; type?: string };
    const model = await pool.query('SELECT id FROM models WHERE id = $1', [modelId]);
    if (model.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    const edge = await pool.query(
      `UPDATE edges
       SET from_id = COALESCE($1, from_id),
           to_id = COALESCE($2, to_id),
           label = COALESCE($3, label),
           type = COALESCE($4, type)
       WHERE id = $5 AND model_id = $1
       RETURNING *`,
      [fromId, toId, label, type, id]
    );
    if (edge.rows.length === 0) {
      return res.status(404).json({ error: 'Edge não encontrada' });
    }
    res.json(edge.rows[0]);
  }

  static async deleteEdge(req: AuthenticatedRequest, res: Response) {
    const { modelId, id } = req.params;
    const model = await pool.query('SELECT id FROM models WHERE id = $1', [modelId]);
    if (model.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    const edge = await pool.query('DELETE FROM edges WHERE id = $1 AND model_id = $2 RETURNING *', [id, modelId]);
    if (edge.rows.length === 0) {
      return res.status(404).json({ error: 'Edge não encontrada' });
    }
    res.json({ ok: true });
  }
}
