import { pool } from '../db.js';

export interface OrgMembership {
  role: string;
}

export async function getOrgRole(userId: string, orgId: string): Promise<string | null> {
  const result = await pool.query<{ role: string }>(
    'SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2',
    [orgId, userId]
  );
  return result.rows[0]?.role ?? null;
}

export async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  return (await getOrgRole(userId, orgId)) !== null;
}

/**
 * Retorna o modelo somente quando o usuário pertence à organização dele.
 * O retorno nulo é usado como 404 para não revelar a existência do recurso.
 */
export async function getModelAccess(
  userId: string,
  modelId: string
): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `SELECT m.*
       FROM models m
       JOIN memberships mem ON mem.org_id = m.org_id
      WHERE m.id = $1 AND mem.user_id = $2`,
    [modelId, userId]
  );
  return result.rows[0] ?? null;
}

const RESOURCE_TABLES = {
  apps: 'apps',
  folders: 'folders',
  services: 'services',
} as const;

export type OrgResource = keyof typeof RESOURCE_TABLES;

export async function getOrgResourceAccess(
  resource: OrgResource,
  userId: string,
  id: string
): Promise<Record<string, unknown> | null> {
  // O nome da tabela vem de uma união fechada (não vem do usuário).
  const table = RESOURCE_TABLES[resource];
  const result = await pool.query(
    `SELECT r.*
       FROM ${table} r
       JOIN memberships mem ON mem.org_id = r.org_id
      WHERE r.id = $1 AND mem.user_id = $2`,
    [id, userId]
  );
  return result.rows[0] ?? null;
}
