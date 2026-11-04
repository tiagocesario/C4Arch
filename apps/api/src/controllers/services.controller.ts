import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';

export class ServiceController {
  static async list(req: AuthenticatedRequest, res: Response) {
    try {
      const { orgId } = req.query as { orgId?: string };
      if (!orgId) return res.status(400).json({ error: 'orgId é obrigatório' });
      const result = await pool.query(
        `SELECT * FROM services WHERE org_id = $1 ORDER BY name ASC`,
        [orgId]
      );
      res.json(result.rows);
    } catch (err) {
      console.error('[services] list error', err);
      res.status(500).json({ error: 'Erro ao listar serviços' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    try {
      const { orgId, name, description, protocol, port, metadata } = req.body as {
        orgId: string;
        name: string;
        description?: string;
        protocol?: string;
        port?: number;
        metadata?: Record<string, unknown>;
      };
      if (!orgId || !name) return res.status(400).json({ error: 'orgId e name são obrigatórios' });
      const result = await pool.query(
        `INSERT INTO services (org_id, name, description, protocol, port, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [orgId, name, description ?? null, protocol ?? 'http', port ?? null, metadata ?? null]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('[services] create error', err);
      res.status(500).json({ error: 'Erro ao criar serviço' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { name, description, protocol, port, metadata } = req.body as {
        name?: string;
        description?: string;
        protocol?: string;
        port?: number;
        metadata?: Record<string, unknown>;
      };
      const result = await pool.query(
        `UPDATE services SET name = COALESCE($1, name), description = COALESCE($2, description), protocol = COALESCE($3, protocol), port = COALESCE($4, port), metadata = COALESCE($5, metadata), updated_at = NOW() WHERE id = $6 RETURNING *`,
        [name, description, protocol, port, metadata, id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Serviço não encontrado' });
      const updated = result.rows[0];

      await pool.query(
        `UPDATE elements SET title = $1, description = $2, metadata = $3, updated_at = NOW() WHERE service_id = $4`,
        [updated.name, updated.description, updated.metadata, id]
      );

      res.json(updated);
    } catch (err) {
      console.error('[services] update error', err);
      res.status(500).json({ error: 'Erro ao atualizar serviço' });
    }
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const result = await pool.query('DELETE FROM services WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Serviço não encontrado' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[services] remove error', err);
      res.status(500).json({ error: 'Erro ao excluir serviço' });
    }
  }
}
