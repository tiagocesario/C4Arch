import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';

export class EdgeController {
  static async list(req: AuthenticatedRequest, res: Response) {
    const { modelId } = req.params;
    const model = await pool.query('SELECT id FROM models WHERE id = $1', [modelId]);
    if (model.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    const result = await pool.query(
      `SELECT e.*, from_elem.title AS source_title, to_elem.title AS target_title
       FROM edges e
       JOIN elements from_elem ON from_elem.id = e.from_id
       JOIN elements to_elem ON to_elem.id = e.to_id
       WHERE e.model_id = $1
       ORDER BY e.created_at`,
      [modelId]
    );
    res.json(result.rows);
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const { modelId } = req.params;
    const { fromId, toId, label, type } = req.body as {
      fromId: string;
      toId: string;
      label?: string;
      type: 'call' | 'http' | 'message' | 'depends';
    };
    const model = await pool.query('SELECT id FROM models WHERE id = $1', [modelId]);
    if (model.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    const from = await pool.query(
      'SELECT id FROM elements WHERE id = $1 AND model_id = $2',
      [fromId, modelId]
    );
    const to = await pool.query(
      'SELECT id FROM elements WHERE id = $1 AND model_id = $2',
      [toId, modelId]
    );
    if (from.rows.length === 0 || to.rows.length === 0) {
      return res.status(400).json({ error: 'Elementos não pertencem a este modelo' });
    }
    const edge = await pool.query(
      `INSERT INTO edges (model_id, from_id, to_id, label, type)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [modelId, fromId, toId, label, type]
    );
    res.status(201).json(edge.rows[0]);
  }

  static async get(req: AuthenticatedRequest, res: Response) {
    const { modelId, edgeId } = req.params;
    const result = await pool.query(
      `SELECT e.*, from_elem.title AS source_title, to_elem.title AS target_title
       FROM edges e
       JOIN elements from_elem ON from_elem.id = e.from_id
       JOIN elements to_elem ON to_elem.id = e.to_id
       WHERE e.id = $1 AND e.model_id = $2`,
      [edgeId, modelId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }
    res.json(result.rows[0]);
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const { modelId, edgeId } = req.params;
    const { fromId, toId, label, type } = req.body as {
      fromId?: string;
      toId?: string;
      label?: string;
      type?: 'call' | 'http' | 'message' | 'depends';
    };
    const edge = await pool.query(
      `SELECT id FROM edges WHERE id = $1 AND model_id = $2`,
      [edgeId, modelId]
    );
    if (edge.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }
    const result = await pool.query(
      `UPDATE edges
       SET from_id = COALESCE($1, from_id),
           to_id = COALESCE($2, to_id),
           label = COALESCE($3, label),
           type = COALESCE($4, type)
       WHERE id = $5 RETURNING *`,
      [fromId, toId, label, type, edgeId]
    );
    res.json(result.rows[0]);
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    const { modelId, edgeId } = req.params;
    const edge = await pool.query(
      `DELETE FROM edges WHERE id = $1 AND model_id = $2 RETURNING *`,
      [edgeId, modelId]
    );
    if (edge.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }
    res.json({ ok: true });
  }
}
