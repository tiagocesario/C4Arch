import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';

export class AppController {
  static async list(req: AuthenticatedRequest, res: Response) {
    try {
      const { orgId } = req.query as { orgId?: string };
      if (!orgId) return res.status(400).json({ error: 'orgId é obrigatório' });
      const result = await pool.query(
        `SELECT * FROM apps WHERE org_id = $1 ORDER BY name ASC`,
        [orgId]
      );
      res.json(result.rows);
    } catch (err) {
      console.error('[apps] list error', err);
      res.status(500).json({ error: 'Erro ao listar aplicações' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    try {
      const { orgId, name, description, kind, metadata } = req.body as {
        orgId: string;
        name: string;
        description?: string;
        kind?: 'app' | 'service';
        metadata?: Record<string, unknown>;
      };
      if (!orgId || !name) return res.status(400).json({ error: 'orgId e name são obrigatórios' });
      const result = await pool.query(
        `INSERT INTO apps (org_id, name, description, kind, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [orgId, name, description ?? null, kind ?? 'app', metadata ?? null]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('[apps] create error', err);
      res.status(500).json({ error: 'Erro ao criar aplicação' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { name, description, kind, metadata } = req.body as {
        name?: string;
        description?: string;
        kind?: 'app' | 'service';
        metadata?: Record<string, unknown>;
      };
      const result = await pool.query(
        `UPDATE apps SET name = COALESCE($1, name), description = COALESCE($2, description), kind = COALESCE($3, kind), metadata = COALESCE($4, metadata), updated_at = NOW() WHERE id = $5 RETURNING *`,
        [name, description, kind, metadata, id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Aplicação não encontrada' });
      const updated = result.rows[0];

      await pool.query(
        `UPDATE elements SET title = $1, description = $2, metadata = $3, updated_at = NOW() WHERE app_id = $4`,
        [updated.name, updated.description, updated.metadata, id]
      );

      res.json(updated);
    } catch (err) {
      console.error('[apps] update error', err);
      res.status(500).json({ error: 'Erro ao atualizar aplicação' });
    }
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const result = await pool.query('DELETE FROM apps WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Aplicação não encontrada' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[apps] remove error', err);
      res.status(500).json({ error: 'Erro ao excluir aplicação' });
    }
  }
}
