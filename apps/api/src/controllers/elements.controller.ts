import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';

export class ElementController {
  static async list(req: AuthenticatedRequest, res: Response) {
    const { modelId } = req.params;
    const model = await pool.query('SELECT id FROM models WHERE id = $1', [modelId]);
    if (model.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    const result = await pool.query(
      'SELECT * FROM elements WHERE model_id = $1 ORDER BY "order"',
      [modelId]
    );
    res.json(result.rows);
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const { modelId } = req.params;
    const { title, type, description, metadata, positionX, positionY, order } = req.body as {
      title: string;
      type: 'actor' | 'system' | 'container' | 'component';
      description?: string;
      metadata?: Record<string, unknown>;
      positionX?: number;
      positionY?: number;
      order?: number;
    };
    const model = await pool.query('SELECT id FROM models WHERE id = $1', [modelId]);
    if (model.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    const element = await pool.query(
      `INSERT INTO elements (model_id, title, type, description, metadata, position_x, position_y, "order")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [modelId, title, type, description, metadata, positionX ?? 0, positionY ?? 0, order ?? 0]
    );
    res.status(201).json(element.rows[0]);
  }

  static async get(req: AuthenticatedRequest, res: Response) {
    const { modelId, elementId } = req.params;
    const result = await pool.query(
      `SELECT * FROM elements WHERE id = $1 AND model_id = $2`,
      [elementId, modelId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Elemento não encontrado' });
    }
    res.json(result.rows[0]);
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const { modelId, elementId } = req.params;
    const { title, type, description, metadata, positionX, positionY, order } = req.body as {
      title?: string;
      type?: 'actor' | 'system' | 'container' | 'component';
      description?: string;
      metadata?: Record<string, unknown>;
      positionX?: number;
      positionY?: number;
      order?: number;
    };
    const element = await pool.query(
      `SELECT id FROM elements WHERE id = $1 AND model_id = $2`,
      [elementId, modelId]
    );
    if (element.rows.length === 0) {
      return res.status(404).json({ error: 'Elemento não encontrado' });
    }
    const result = await pool.query(
      `UPDATE elements
       SET title = COALESCE($1, title),
           type = COALESCE($2, type),
           description = COALESCE($3, description),
           metadata = COALESCE($4, metadata),
           position_x = COALESCE($5, position_x),
           position_y = COALESCE($6, position_y),
           "order" = COALESCE($7, "order"),
           updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [title, type, description, metadata, positionX, positionY, order, elementId]
    );
    res.json(result.rows[0]);
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    const { modelId, elementId } = req.params;
    const element = await pool.query(
      `DELETE FROM elements WHERE id = $1 AND model_id = $2 RETURNING *`,
      [elementId, modelId]
    );
    if (element.rows.length === 0) {
      return res.status(404).json({ error: 'Elemento não encontrado' });
    }
    res.json({ ok: true });
  }
}
