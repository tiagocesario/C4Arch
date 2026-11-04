import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';

export class FolderController {
  static async list(req: AuthenticatedRequest, res: Response) {
    try {
      const { orgId } = req.query as { orgId?: string };
      if (!orgId) return res.status(400).json({ error: 'orgId é obrigatório' });
      const result = await pool.query(
        `SELECT * FROM folders WHERE org_id = $1 ORDER BY name ASC`,
        [orgId]
      );
      res.json(result.rows);
    } catch (err) {
      console.error('[folders] list error', err);
      res.status(500).json({ error: 'Erro ao listar pastas' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    try {
      const { orgId, name, parentId } = req.body as { orgId: string; name: string; parentId?: string };
      if (!orgId || !name) return res.status(400).json({ error: 'orgId e name são obrigatórios' });
      const result = await pool.query(
        `INSERT INTO folders (org_id, name, parent_id) VALUES ($1, $2, $3) RETURNING *`,
        [orgId, name, parentId ?? null]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('[folders] create error', err);
      res.status(500).json({ error: 'Erro ao criar pasta' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { name, parentId } = req.body as { name?: string; parentId?: string | null };
      const result = await pool.query(
        `UPDATE folders SET name = COALESCE($1, name), parent_id = COALESCE($2, parent_id), updated_at = NOW() WHERE id = $3 RETURNING *`,
        [name, parentId, id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Pasta não encontrada' });
      res.json(result.rows[0]);
    } catch (err) {
      console.error('[folders] update error', err);
      res.status(500).json({ error: 'Erro ao atualizar pasta' });
    }
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const result = await pool.query('DELETE FROM folders WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Pasta não encontrada' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[folders] remove error', err);
      res.status(500).json({ error: 'Erro ao excluir pasta' });
    }
  }
}
