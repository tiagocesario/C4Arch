import { pool } from '../db.js';

export interface AuditEntry {
  orgId: string | null;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Registra uma ação de auditoria. Falhas são silenciosas para não derrubar a
 * requisição principal.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (org_id, actor_id, actor_email, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        entry.orgId,
        entry.actorId,
        entry.actorEmail,
        entry.action,
        entry.entityType,
        entry.entityId,
        JSON.stringify(entry.metadata ?? {}),
      ]
    );
  } catch (err) {
    console.error('[audit] falha ao registrar', err);
  }
}
