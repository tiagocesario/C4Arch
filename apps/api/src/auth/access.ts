import { pool } from '../db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Evita enviar identificadores malformados ao Postgres (que responderia com
 * erro de cast e transformaria um 400/404 em 500).
 */
export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export interface OrgMembership {
  role: string;
}

export async function getOrgRole(userId: string, orgId: string): Promise<string | null> {
  if (!isValidUuid(userId) || !isValidUuid(orgId)) return null;
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
 * `viewer` é somente leitura. `owner` e `editor` podem alterar o conteúdo da
 * organização. O papel vem sempre de `memberships`, nunca do JWT.
 */
export function isWriterRole(role: unknown): boolean {
  return role === 'owner' || role === 'editor';
}

/**
 * Ações administrativas (gestão de grupos de acesso, membros e permissões) são
 * exclusivas do `owner`. `editor` pode editar conteúdo, mas não conceder papéis.
 */
export function isOwnerRole(role: unknown): boolean {
  return role === 'owner';
}

/**
 * Retorna o modelo somente quando o usuário pertence à organização dele.
 * O retorno nulo é usado como 404 para não revelar a existência do recurso.
 * `member_role` acompanha o registro para as checagens de escrita.
 */
export async function getModelAccess(
  userId: string,
  modelId: string
): Promise<Record<string, unknown> | null> {
  if (!isValidUuid(userId) || !isValidUuid(modelId)) return null;
  const result = await pool.query(
    `SELECT m.*, mem.role AS member_role
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
  if (!isValidUuid(userId) || !isValidUuid(id)) return null;
  // O nome da tabela vem de uma união fechada (não vem do usuário).
  const table = RESOURCE_TABLES[resource];
  const result = await pool.query(
    `SELECT r.*, mem.role AS member_role
       FROM ${table} r
       JOIN memberships mem ON mem.org_id = r.org_id
      WHERE r.id = $1 AND mem.user_id = $2`,
    [id, userId]
  );
  return result.rows[0] ?? null;
}
