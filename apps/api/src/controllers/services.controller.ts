import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { getOrgResourceAccess, getOrgRole, isOrgMember, isWriterRole } from '../auth/access.js';

const MAX_PORT = 65535;

export class ServiceController {
  static async list(req: AuthenticatedRequest, res: Response) {
    const { orgId } = req.query as { orgId?: string };
    if (!orgId) return res.status(400).json({ error: 'orgId é obrigatório' });

    try {
      if (!(await isOrgMember(req.user!.id, orgId))) {
        return res.status(403).json({ error: 'Sem acesso a esta organização' });
      }
      const result = await pool.query(
        `SELECT * FROM services WHERE org_id = $1 ORDER BY name ASC`,
        [orgId]
      );
      return res.json(result.rows);
    } catch (err) {
      console.error('[services] list error', err);
      return res.status(500).json({ error: 'Erro ao listar serviços' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const { orgId, name, description, protocol, port, metadata } = req.body as {
      orgId?: string;
      name?: string;
      description?: string | null;
      protocol?: string;
      port?: number | null;
      metadata?: Record<string, unknown> | null;
    };
    const cleanName = typeof name === 'string' ? name.trim() : '';

    if (!orgId || !cleanName) {
      return res.status(400).json({ error: 'orgId e name são obrigatórios' });
    }
    if (cleanName.length > 120) {
      return res.status(400).json({ error: 'name muito longo' });
    }
    if (port !== undefined && port !== null) {
      if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
        return res.status(400).json({ error: 'port inválida' });
      }
    }

    try {
      const role = await getOrgRole(req.user!.id, orgId);
      if (!isWriterRole(role)) {
        return res.status(403).json({ error: 'Sem permissão de escrita nesta organização' });
      }
      const result = await pool.query(
        `INSERT INTO services (org_id, name, description, protocol, port, metadata)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [orgId, cleanName, description ?? null, protocol ?? 'http', port ?? null, metadata ?? null]
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('[services] create error', err);
      return res.status(500).json({ error: 'Erro ao criar serviço' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { name, description, protocol, port, metadata } = req.body as {
      name?: string;
      description?: string | null;
      protocol?: string;
      port?: number | null;
      metadata?: Record<string, unknown> | null;
    };

    if (port !== undefined && port !== null) {
      if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
        return res.status(400).json({ error: 'port inválida' });
      }
    }

    try {
      const service = await getOrgResourceAccess('services', req.user!.id, id);
      if (!service) return res.status(404).json({ error: 'Serviço não encontrado' });
      if (!isWriterRole(service.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este serviço' });
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      let index = 1;

      if (name !== undefined) {
        const cleanName = typeof name === 'string' ? name.trim() : '';
        if (!cleanName || cleanName.length > 120) {
          return res.status(400).json({ error: 'name inválido' });
        }
        sets.push(`name = $${index++}`);
        values.push(cleanName);
      }
      if (description !== undefined) {
        sets.push(`description = $${index++}`);
        values.push(description);
      }
      if (protocol !== undefined) {
        sets.push(`protocol = $${index++}`);
        values.push(protocol);
      }
      if (port !== undefined) {
        sets.push(`port = $${index++}`);
        values.push(port);
      }
      if (metadata !== undefined) {
        sets.push(`metadata = $${index++}`);
        values.push(metadata);
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      values.push(id);
      const result = await pool.query(
        `UPDATE services SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${index} RETURNING *`,
        values
      );
      const updated = result.rows[0];

      await pool.query(
        `UPDATE elements
            SET title = $1, description = $2, metadata = $3, updated_at = NOW()
          WHERE service_id = $4`,
        [updated.name, updated.description, updated.metadata, id]
      );

      return res.json(updated);
    } catch (err) {
      console.error('[services] update error', err);
      return res.status(500).json({ error: 'Erro ao atualizar serviço' });
    }
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;

    try {
      const service = await getOrgResourceAccess('services', req.user!.id, id);
      if (!service) return res.status(404).json({ error: 'Serviço não encontrado' });
      if (!isWriterRole(service.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para excluir este serviço' });
      }

      await pool.query('DELETE FROM services WHERE id = $1', [id]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[services] remove error', err);
      return res.status(500).json({ error: 'Erro ao excluir serviço' });
    }
  }
}
