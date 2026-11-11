import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { getOrgRole, isWriterRole } from '../auth/access.js';
import { pool } from '../db.js';

export const AuditController = {
  async list(req: AuthenticatedRequest, res: Response) {
    const orgId = (req.query.orgId as string) || null;
    if (!orgId) return res.status(400).json({ error: 'orgId obrigatório' });
    try {
      const role = await getOrgRole(req.user!.id, orgId);
      if (role !== 'owner') return res.status(403).json({ error: 'Apenas owner pode ver a auditoria' });
      const limit = Math.min(Number(req.query.limit ?? 100), 500);
      const result = await pool.query(
        `SELECT id, org_id, actor_id, actor_email, action, entity_type, entity_id, metadata, created_at
           FROM audit_log
          WHERE org_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [orgId, limit]
      );
      return res.json({ entries: result.rows });
    } catch (err) {
      console.error('[audit] list error', err);
      return res.status(500).json({ error: 'Erro ao listar auditoria' });
    }
  },
};
