import type { Response } from 'express';
import { pool } from '../db.js';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import {
  getModelAccess,
  getOrgRole,
  isOwnerRole,
  isWriterRole,
  isValidUuid,
} from '../auth/access.js';
import { parseIntegrationHttpUrl, UnsafeUrlError } from '../security/url.js';
import { recordAudit } from '../c4/audit.js';
import {
  syncModelExternal,
  type ExternalFormat,
  type ExternalMethod,
} from '../c4/external-sync.js';

const AUTH_TYPES = new Set(['none', 'bearer', 'basic']);
const METHODS = new Set<ExternalMethod>(['POST', 'PUT', 'PATCH']);
const FORMATS = new Set<ExternalFormat>(['json', 'raw']);

/**
 * Headers controlados pelo cliente HTTP. Permitir que a configuração os
 * sobrescreva quebraria a requisição ou permitiria smuggling.
 */
const BLOCKED_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'expect',
]);

interface SystemRow {
  id: string;
  org_id: string;
  name: string;
  base_url: string | null;
  auth_type: 'none' | 'bearer' | 'basic';
  auth_token: string | null;
  auth_user: string | null;
  headers: Record<string, unknown> | null;
  enabled: boolean;
  binding_count?: string | number;
  created_at: string;
  updated_at: string;
  member_role?: string;
}

interface BindingRow {
  id: string;
  model_id: string;
  external_system_id: string;
  drawio_url: string | null;
  das_url: string | null;
  method: ExternalMethod;
  format: ExternalFormat;
  enabled: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
  system_name: string;
  system_enabled: boolean;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return null;
  return trimmed;
}

function cleanOptionalUrl(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${field} inválida`);
  if (!value.trim()) return null;
  try {
    return parseIntegrationHttpUrl(value.trim()).toString();
  } catch (err) {
    const message = err instanceof UnsafeUrlError ? err.message : 'URL inválida';
    throw new Error(`${field}: ${message}`);
  }
}

function parseHeaders(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('headers deve ser um objeto de strings');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 30) throw new Error('headers aceita no máximo 30 entradas');
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of entries) {
    const name = key.trim();
    if (!name || name.length > 100 || /[\r\n]/.test(name)) {
      throw new Error('nome de header inválido');
    }
    if (BLOCKED_HEADERS.has(name.toLowerCase())) {
      throw new Error(`header ${name} não pode ser configurado`);
    }
    if (typeof headerValue !== 'string' || /[\r\n]/.test(headerValue)) {
      throw new Error(`valor do header ${name} inválido`);
    }
    headers[name] = headerValue;
  }
  return headers;
}

function mapSystem(row: SystemRow) {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    baseUrl: row.base_url,
    authType: row.auth_type,
    authUser: row.auth_user,
    hasAuthToken: Boolean(row.auth_token),
    headers: row.headers ?? {},
    enabled: row.enabled,
    bindingCount: Number(row.binding_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBinding(row: BindingRow) {
  return {
    id: row.id,
    modelId: row.model_id,
    externalSystemId: row.external_system_id,
    externalSystemName: row.system_name,
    drawioUrl: row.drawio_url,
    dasUrl: row.das_url,
    method: row.method,
    format: row.format,
    enabled: row.enabled,
    lastSyncAt: row.last_sync_at,
    lastSyncStatus: row.last_sync_status,
    lastSyncError: row.last_sync_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getSystemAccess(
  userId: string,
  systemId: string
): Promise<SystemRow | null> {
  if (!isValidUuid(systemId)) return null;
  const result = await pool.query<SystemRow>(
    `SELECT s.*, mem.role AS member_role
       FROM external_systems s
       JOIN memberships mem ON mem.org_id = s.org_id
      WHERE s.id = $1 AND mem.user_id = $2`,
    [systemId, userId]
  );
  return result.rows[0] ?? null;
}

async function listBindingRows(modelId: string): Promise<BindingRow[]> {
  const result = await pool.query<BindingRow>(
    `SELECT b.*, s.name AS system_name, s.enabled AS system_enabled
       FROM model_external_bindings b
       JOIN external_systems s ON s.id = b.external_system_id
      WHERE b.model_id = $1
      ORDER BY s.name`,
    [modelId]
  );
  return result.rows;
}

async function getBinding(
  modelId: string,
  bindingId: string
): Promise<BindingRow | null> {
  if (!isValidUuid(bindingId)) return null;
  const result = await pool.query<BindingRow>(
    `SELECT b.*, s.name AS system_name, s.enabled AS system_enabled
       FROM model_external_bindings b
       JOIN external_systems s ON s.id = b.external_system_id
      WHERE b.id = $1 AND b.model_id = $2`,
    [bindingId, modelId]
  );
  return result.rows[0] ?? null;
}

/**
 * Configuração de APIs de outros sistemas (por organização) e vínculos por
 * modelo. O token de autenticação nunca é devolvido; a UI só sabe se existe.
 */
export class IntegrationController {
  static async listSystems(req: AuthenticatedRequest, res: Response) {
    const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : '';
    if (!isValidUuid(orgId)) return res.status(400).json({ error: 'orgId inválido' });

    try {
      const role = await getOrgRole(req.user!.id, orgId);
      if (!role) return res.status(404).json({ error: 'Organização não encontrada' });

      const result = await pool.query<SystemRow>(
        `SELECT s.*,
                (SELECT COUNT(*) FROM model_external_bindings b
                  WHERE b.external_system_id = s.id) AS binding_count
           FROM external_systems s
          WHERE s.org_id = $1
          ORDER BY s.name`,
        [orgId]
      );
      return res.json(result.rows.map(mapSystem));
    } catch (err) {
      console.error('[integrations] list systems error', err);
      return res.status(500).json({ error: 'Erro ao listar sistemas externos' });
    }
  }

  static async createSystem(req: AuthenticatedRequest, res: Response) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const orgId = typeof body.orgId === 'string' ? body.orgId : '';
    const name = cleanName(body.name);
    if (!isValidUuid(orgId) || !name) {
      return res.status(400).json({ error: 'orgId e name são obrigatórios' });
    }

    const authType = typeof body.authType === 'string' ? body.authType : 'none';
    if (!AUTH_TYPES.has(authType)) {
      return res.status(400).json({ error: 'authType inválido' });
    }

    let baseUrl: string | null = null;
    let headers: Record<string, string> | null = null;
    try {
      baseUrl = cleanOptionalUrl(body.baseUrl, 'baseUrl');
      headers = parseHeaders(body.headers);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Dados inválidos' });
    }

    try {
      const role = await getOrgRole(req.user!.id, orgId);
      if (!isWriterRole(role)) {
        return res.status(403).json({ error: 'Sem permissão de escrita nesta organização' });
      }

      const result = await pool.query<SystemRow>(
        `INSERT INTO external_systems
           (org_id, name, base_url, auth_type, auth_token, auth_user, headers, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING *`,
        [
          orgId,
          name,
          baseUrl,
          authType,
          typeof body.authToken === 'string' && body.authToken ? body.authToken : null,
          typeof body.authUser === 'string' && body.authUser ? body.authUser : null,
          JSON.stringify(headers ?? {}),
          body.enabled === undefined ? true : Boolean(body.enabled),
        ]
      );

      await recordAudit({
        orgId,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'integration.system.create',
        entityType: 'external_system',
        entityId: result.rows[0].id,
        metadata: { name },
      });

      return res.status(201).json(mapSystem(result.rows[0]));
    } catch (err) {
      if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
        return res.status(409).json({ error: 'Já existe um sistema externo com este nome' });
      }
      console.error('[integrations] create system error', err);
      return res.status(500).json({ error: 'Erro ao criar sistema externo' });
    }
  }

  static async updateSystem(req: AuthenticatedRequest, res: Response) {
    const { systemId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;

    try {
      const existing = await getSystemAccess(req.user!.id, systemId);
      if (!existing) return res.status(404).json({ error: 'Sistema externo não encontrado' });
      if (!isWriterRole(existing.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar integrações' });
      }

      const sets: string[] = [];
      const values: unknown[] = [];

      if (body.name !== undefined) {
        const name = cleanName(body.name);
        if (!name) return res.status(400).json({ error: 'name inválido' });
        values.push(name);
        sets.push(`name = $${values.length}`);
      }
      if (body.baseUrl !== undefined) {
        let baseUrl: string | null;
        try {
          baseUrl = cleanOptionalUrl(body.baseUrl, 'baseUrl');
        } catch (err) {
          return res.status(400).json({ error: err instanceof Error ? err.message : 'baseUrl inválida' });
        }
        values.push(baseUrl);
        sets.push(`base_url = $${values.length}`);
      }
      if (body.authType !== undefined) {
        if (typeof body.authType !== 'string' || !AUTH_TYPES.has(body.authType)) {
          return res.status(400).json({ error: 'authType inválido' });
        }
        values.push(body.authType);
        sets.push(`auth_type = $${values.length}`);
      }
      if (body.authToken !== undefined) {
        values.push(typeof body.authToken === 'string' && body.authToken ? body.authToken : null);
        sets.push(`auth_token = $${values.length}`);
      }
      if (body.authUser !== undefined) {
        values.push(typeof body.authUser === 'string' && body.authUser ? body.authUser : null);
        sets.push(`auth_user = $${values.length}`);
      }
      if (body.headers !== undefined) {
        let headers: Record<string, string> | null;
        try {
          headers = parseHeaders(body.headers);
        } catch (err) {
          return res.status(400).json({ error: err instanceof Error ? err.message : 'headers inválidos' });
        }
        values.push(JSON.stringify(headers ?? {}));
        sets.push(`headers = $${values.length}::jsonb`);
      }
      if (body.enabled !== undefined) {
        values.push(Boolean(body.enabled));
        sets.push(`enabled = $${values.length}`);
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      values.push(systemId);
      const result = await pool.query<SystemRow>(
        `UPDATE external_systems
            SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${values.length}
          RETURNING *`,
        values
      );

      await recordAudit({
        orgId: existing.org_id,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'integration.system.update',
        entityType: 'external_system',
        entityId: systemId,
        metadata: { fields: Object.keys(body) },
      });

      return res.json(mapSystem(result.rows[0]));
    } catch (err) {
      if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
        return res.status(409).json({ error: 'Já existe um sistema externo com este nome' });
      }
      console.error('[integrations] update system error', err);
      return res.status(500).json({ error: 'Erro ao atualizar sistema externo' });
    }
  }

  static async removeSystem(req: AuthenticatedRequest, res: Response) {
    const { systemId } = req.params;
    try {
      const existing = await getSystemAccess(req.user!.id, systemId);
      if (!existing) return res.status(404).json({ error: 'Sistema externo não encontrado' });
      if (!isOwnerRole(existing.member_role)) {
        return res.status(403).json({ error: 'Somente owner pode remover integrações' });
      }

      await pool.query('DELETE FROM external_systems WHERE id = $1', [systemId]);
      await recordAudit({
        orgId: existing.org_id,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'integration.system.delete',
        entityType: 'external_system',
        entityId: systemId,
        metadata: { name: existing.name },
      });
      return res.json({ ok: true });
    } catch (err) {
      console.error('[integrations] remove system error', err);
      return res.status(500).json({ error: 'Erro ao remover sistema externo' });
    }
  }

  static async listModelBindings(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isValidUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      const rows = await listBindingRows(id);
      return res.json(rows.map(mapBinding));
    } catch (err) {
      console.error('[integrations] list bindings error', err);
      return res.status(500).json({ error: 'Erro ao listar vínculos do modelo' });
    }
  }

  static async createModelBinding(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!isValidUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });

    const externalSystemId =
      typeof body.externalSystemId === 'string' ? body.externalSystemId : '';
    if (!isValidUuid(externalSystemId)) {
      return res.status(400).json({ error: 'externalSystemId inválido' });
    }

    let drawioUrl: string | null = null;
    let dasUrl: string | null = null;
    try {
      drawioUrl = cleanOptionalUrl(body.drawioUrl, 'drawioUrl');
      dasUrl = cleanOptionalUrl(body.dasUrl, 'dasUrl');
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'URL inválida' });
    }
    if (!drawioUrl && !dasUrl) {
      return res.status(400).json({ error: 'Informe a URL do draw.io e/ou a URL do DAS' });
    }

    const method = typeof body.method === 'string' ? body.method : 'PUT';
    if (!METHODS.has(method as ExternalMethod)) {
      return res.status(400).json({ error: 'method inválido' });
    }
    const format = typeof body.format === 'string' ? body.format : 'json';
    if (!FORMATS.has(format as ExternalFormat)) {
      return res.status(400).json({ error: 'format inválido' });
    }

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const system = await pool.query<{ id: string }>(
        'SELECT id FROM external_systems WHERE id = $1 AND org_id = $2',
        [externalSystemId, model.org_id]
      );
      if (system.rows.length === 0) {
        return res.status(404).json({ error: 'Sistema externo não encontrado nesta organização' });
      }

      const result = await pool.query<BindingRow>(
        `INSERT INTO model_external_bindings
           (model_id, external_system_id, drawio_url, das_url, method, format, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          id,
          externalSystemId,
          drawioUrl,
          dasUrl,
          method,
          format,
          body.enabled === undefined ? true : Boolean(body.enabled),
        ]
      );

      const created = await getBinding(id, result.rows[0].id);
      await recordAudit({
        orgId: String(model.org_id),
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'integration.binding.create',
        entityType: 'model',
        entityId: id,
        metadata: { bindingId: result.rows[0].id, externalSystemId },
      });
      return res.status(201).json(mapBinding(created ?? result.rows[0]));
    } catch (err) {
      if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
        return res.status(409).json({ error: 'Este modelo já está vinculado a este sistema externo' });
      }
      console.error('[integrations] create binding error', err);
      return res.status(500).json({ error: 'Erro ao criar vínculo do modelo' });
    }
  }

  static async updateModelBinding(req: AuthenticatedRequest, res: Response) {
    const { id, bindingId } = req.params;
    if (!isValidUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }
      const existing = await getBinding(id, bindingId);
      if (!existing) return res.status(404).json({ error: 'Vínculo não encontrado' });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const sets: string[] = [];
      const values: unknown[] = [];
      let nextDrawio: string | null = existing.drawio_url;
      let nextDas: string | null = existing.das_url;

      if (body.drawioUrl !== undefined) {
        let url: string | null;
        try {
          url = cleanOptionalUrl(body.drawioUrl, 'drawioUrl');
        } catch (err) {
          return res.status(400).json({ error: err instanceof Error ? err.message : 'URL inválida' });
        }
        nextDrawio = url;
        values.push(url);
        sets.push(`drawio_url = $${values.length}`);
      }
      if (body.dasUrl !== undefined) {
        let url: string | null;
        try {
          url = cleanOptionalUrl(body.dasUrl, 'dasUrl');
        } catch (err) {
          return res.status(400).json({ error: err instanceof Error ? err.message : 'URL inválida' });
        }
        nextDas = url;
        values.push(url);
        sets.push(`das_url = $${values.length}`);
      }
      if (body.method !== undefined) {
        if (typeof body.method !== 'string' || !METHODS.has(body.method as ExternalMethod)) {
          return res.status(400).json({ error: 'method inválido' });
        }
        values.push(body.method);
        sets.push(`method = $${values.length}`);
      }
      if (body.format !== undefined) {
        if (typeof body.format !== 'string' || !FORMATS.has(body.format as ExternalFormat)) {
          return res.status(400).json({ error: 'format inválido' });
        }
        values.push(body.format);
        sets.push(`format = $${values.length}`);
      }
      if (body.enabled !== undefined) {
        values.push(Boolean(body.enabled));
        sets.push(`enabled = $${values.length}`);
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      // Não deixa o vínculo ficar sem nenhuma URL.
      if (!nextDrawio && !nextDas) {
        return res.status(400).json({ error: 'Informe a URL do draw.io e/ou a URL do DAS' });
      }

      values.push(bindingId, id);
      await pool.query(
        `UPDATE model_external_bindings
            SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${values.length - 1} AND model_id = $${values.length}`,
        values
      );

      const updated = await getBinding(id, bindingId);
      await recordAudit({
        orgId: String(model.org_id),
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'integration.binding.update',
        entityType: 'model',
        entityId: id,
        metadata: { bindingId, fields: Object.keys(body) },
      });
      return res.json(updated ? mapBinding(updated) : { ok: true });
    } catch (err) {
      console.error('[integrations] update binding error', err);
      return res.status(500).json({ error: 'Erro ao atualizar vínculo do modelo' });
    }
  }

  static async removeModelBinding(req: AuthenticatedRequest, res: Response) {
    const { id, bindingId } = req.params;
    if (!isValidUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }
      const result = await pool.query(
        'DELETE FROM model_external_bindings WHERE id = $1 AND model_id = $2 RETURNING id',
        [bindingId, id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Vínculo não encontrado' });
      }
      await recordAudit({
        orgId: String(model.org_id),
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'integration.binding.delete',
        entityType: 'model',
        entityId: id,
        metadata: { bindingId },
      });
      return res.json({ ok: true });
    } catch (err) {
      console.error('[integrations] remove binding error', err);
      return res.status(500).json({ error: 'Erro ao remover vínculo do modelo' });
    }
  }

  /** Força o envio do modelo atual para um vínculo (botão "Enviar agora"). */
  static async syncModelBinding(req: AuthenticatedRequest, res: Response) {
    const { id, bindingId } = req.params;
    if (!isValidUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }
      const binding = await getBinding(id, bindingId);
      if (!binding) return res.status(404).json({ error: 'Vínculo não encontrado' });

      const results = await syncModelExternal(id, 'model.updated', {
        force: true,
        bindingId,
        regenerateDas: true,
        preferStoredDrawio: true,
      });
      return res.json({ ok: true, results });
    } catch (err) {
      console.error('[integrations] sync binding error', err);
      return res.status(500).json({ error: 'Erro ao enviar atualização para o sistema externo' });
    }
  }
}
