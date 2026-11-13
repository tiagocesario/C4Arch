import type { Response } from 'express';
import { pool } from '../db.js';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import { getModelAccess, getOrgRole, isWriterRole } from '../auth/access.js';
import { recordAudit } from '../c4/audit.js';
import { regenerateModelDAS } from '../c4/das-service.js';
import {
  detectStructurizrFormat,
  importWorkspaceIntoModel,
  parseStructurizrWorkspace,
} from '../c4/structurizr-import.js';
import { isC4ModelType, type C4ModelType } from '../c4/model-types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMPORT_BYTES = 5_000_000;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function validateImportBody(body: Record<string, unknown>, res: Response): string | null {
  const content = body.content;
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'content é obrigatório' });
    return null;
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) {
    res.status(413).json({ error: 'Conteúdo do workspace muito grande' });
    return null;
  }
  if (body.format !== undefined && body.format !== 'json' && body.format !== 'dsl') {
    res.status(400).json({ error: 'format deve ser "json" ou "dsl"' });
    return null;
  }
  if (body.mode !== undefined && body.mode !== 'replace' && body.mode !== 'merge') {
    res.status(400).json({ error: 'mode deve ser "replace" ou "merge"' });
    return null;
  }
  return content;
}

export class ImportController {
  /** Importa um workspace Structurizr criando um novo modelo na organização. */
  static async importNew(req: AuthenticatedRequest, res: Response) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const orgId = body.orgId;
    if (!isUuid(orgId)) return res.status(400).json({ error: 'orgId inválido' });
    if (body.folderId !== undefined && body.folderId !== null && !isUuid(body.folderId)) {
      return res.status(400).json({ error: 'folderId inválido' });
    }
    if (body.parentId !== undefined && body.parentId !== null && !isUuid(body.parentId)) {
      return res.status(400).json({ error: 'parentId inválido' });
    }
    if (body.c4Type !== undefined && !isC4ModelType(body.c4Type)) {
      return res.status(400).json({ error: 'c4Type inválido' });
    }
    const content = validateImportBody(body, res);
    if (!content) return;

    try {
      const role = await getOrgRole(req.user!.id, orgId);
      if (!isWriterRole(role)) {
        return res.status(403).json({ error: 'Sem permissão de escrita nesta organização' });
      }

      if (body.folderId) {
        const folder = await pool.query('SELECT id FROM folders WHERE id = $1 AND org_id = $2', [
          body.folderId,
          orgId,
        ]);
        if (folder.rows.length === 0) {
          return res.status(404).json({ error: 'Pasta não encontrada ou não pertence à organização' });
        }
      }
      if (body.parentId) {
        const parent = await pool.query('SELECT id, org_id FROM models WHERE id = $1', [body.parentId]);
        if (parent.rows.length === 0 || parent.rows[0].org_id !== orgId) {
          return res.status(404).json({ error: 'Modelo pai não encontrado ou não pertence à organização' });
        }
      }

      const format = typeof body.format === 'string' ? (body.format as 'json' | 'dsl') : undefined;
      let workspace;
      try {
        workspace = parseStructurizrWorkspace(content, format ?? detectStructurizrFormat(content));
      } catch {
        return res.status(400).json({ error: 'Workspace Structurizr inválido' });
      }

      const c4Type = (body.c4Type as C4ModelType | undefined) ?? 'container';
      const title =
        cleanTitle(body.title) ??
        cleanTitle(body.name) ??
        cleanTitle(workspace.name) ??
        'Modelo importado do Structurizr';

      const created = await pool.query(
        `INSERT INTO models (org_id, title, description, status, folder_id, c4_type, c4_scope, parent_id)
         VALUES ($1, $2, $3, 'draft', $4, $5, NULL, $6)
         RETURNING *`,
        [
          orgId,
          title,
          workspace.description,
          body.folderId ?? null,
          c4Type,
          body.parentId ?? null,
        ]
      );
      const model = created.rows[0];

      const result = await importWorkspaceIntoModel(model.id, workspace, {
        mode: 'replace',
        title,
        c4Type,
      });

      model.das_content = await regenerateModelDAS(model.id);
      await recordAudit({
        orgId,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'model.import.structurizr',
        entityType: 'model',
        entityId: model.id,
        metadata: {
          format: format ?? detectStructurizrFormat(content),
          elements: result.elements,
          relationships: result.relationships,
        },
      });

      return res.status(201).json({ ...model, import: result });
    } catch (err) {
      console.error('[imports] importNew error', err);
      return res.status(500).json({ error: 'Erro ao importar workspace Structurizr' });
    }
  }

  /** Importa um workspace Structurizr para um modelo existente. */
  static async importIntoModel(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.c4Type !== undefined && !isC4ModelType(body.c4Type)) {
      return res.status(400).json({ error: 'c4Type inválido' });
    }
    const content = validateImportBody(body, res);
    if (!content) return;

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const format = typeof body.format === 'string' ? (body.format as 'json' | 'dsl') : undefined;
      let workspace;
      try {
        workspace = parseStructurizrWorkspace(content, format ?? detectStructurizrFormat(content));
      } catch {
        return res.status(400).json({ error: 'Workspace Structurizr inválido' });
      }

      const result = await importWorkspaceIntoModel(id, workspace, {
        mode: body.mode === 'merge' ? 'merge' : 'replace',
        title: cleanTitle(body.title),
        c4Type: typeof body.c4Type === 'string' ? body.c4Type : null,
        fileName: typeof body.fileName === 'string' ? body.fileName : null,
      });
      const das = await regenerateModelDAS(id);
      await recordAudit({
        orgId: (model.org_id as string) ?? null,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'model.import.structurizr',
        entityType: 'model',
        entityId: id,
        metadata: {
          format: format ?? detectStructurizrFormat(content),
          mode: result.mode,
          elements: result.elements,
          relationships: result.relationships,
        },
      });

      return res.json({ ok: true, das_content: das, import: result });
    } catch (err) {
      console.error('[imports] importIntoModel error', err);
      return res.status(500).json({ error: 'Erro ao importar workspace Structurizr' });
    }
  }
}
