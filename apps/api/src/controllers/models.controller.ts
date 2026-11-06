import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { getModelAccess, getOrgRole, isWriterRole } from '../auth/access.js';
import {
  DEFAULT_C4_MODEL_TYPE,
  isC4ModelType,
  type C4ModelType,
} from '../c4/model-types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function cleanOptionalText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().slice(0, max);
}

export class ModelController {
  static async list(req: AuthenticatedRequest, res: Response) {
    try {
      const result = await pool.query(
        `SELECT m.*, o.name AS org_name
           FROM models m
           JOIN organizations o ON o.id = m.org_id
           JOIN memberships mem ON mem.org_id = o.id
          WHERE mem.user_id = $1
          ORDER BY m.created_at DESC`,
        [req.user!.id]
      );
      return res.json(result.rows);
    } catch (err) {
      console.error('[models] list error', err);
      return res.status(500).json({ error: 'Erro ao listar modelos' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const { orgId, title, description, status, folderId, c4Type, c4Scope } = req.body as {
      orgId?: string;
      title?: string;
      description?: string | null;
      status?: 'draft' | 'final';
      folderId?: string | null;
      c4Type?: C4ModelType;
      c4Scope?: string | null;
    };

    const cleanTitle = typeof title === 'string' ? title.trim() : '';
    if (!isUuid(orgId) || !cleanTitle) {
      return res.status(400).json({ error: 'orgId e title são obrigatórios' });
    }
    if (cleanTitle.length > 200) {
      return res.status(400).json({ error: 'title muito longo' });
    }
    if (status !== undefined && status !== 'draft' && status !== 'final') {
      return res.status(400).json({ error: 'status deve ser "draft" ou "final"' });
    }
    if (folderId !== undefined && folderId !== null && !isUuid(folderId)) {
      return res.status(400).json({ error: 'folderId inválido' });
    }
    if (c4Type !== undefined && !isC4ModelType(c4Type)) {
      return res.status(400).json({ error: 'c4Type inválido' });
    }
    if (c4Scope !== undefined && c4Scope !== null && typeof c4Scope !== 'string') {
      return res.status(400).json({ error: 'c4Scope inválido' });
    }

    try {
      const role = await getOrgRole(req.user!.id, orgId);
      if (!isWriterRole(role)) {
        return res.status(403).json({ error: 'Sem permissão de escrita nesta organização' });
      }

      if (folderId) {
        const folder = await pool.query(
          'SELECT id FROM folders WHERE id = $1 AND org_id = $2',
          [folderId, orgId]
        );
        if (folder.rows.length === 0) {
          return res.status(404).json({ error: 'Pasta não encontrada ou não pertence à organização' });
        }
      }

      const model = await pool.query(
        `INSERT INTO models (org_id, title, description, status, folder_id, c4_type, c4_scope)
         VALUES ($1, $2, $3, COALESCE($4, 'draft'), $5, $6, $7) RETURNING *`,
        [
          orgId,
          cleanTitle,
          cleanOptionalText(description, 5000),
          status ?? null,
          folderId ?? null,
          c4Type ?? DEFAULT_C4_MODEL_TYPE,
          cleanOptionalText(c4Scope, 200),
        ]
      );
      return res.status(201).json(model.rows[0]);
    } catch (err) {
      console.error('[models] create error', err);
      return res.status(500).json({ error: 'Erro ao criar modelo' });
    }
  }

  static async get(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const elements = await pool.query(
        'SELECT * FROM elements WHERE model_id = $1 ORDER BY "order"',
        [id]
      );
      const edges = await pool.query(
        `SELECT e.*, from_elem.title AS source_title, to_elem.title AS target_title
           FROM edges e
           JOIN elements from_elem ON from_elem.id = e.from_id
           JOIN elements to_elem ON to_elem.id = e.to_id
          WHERE e.model_id = $1`,
        [id]
      );
      return res.json({ ...model, elements: elements.rows, edges: edges.rows });
    } catch (err) {
      console.error('[models] get error', err);
      return res.status(500).json({ error: 'Erro ao carregar modelo' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { title, description, status, folderId, c4Type, c4Scope } = req.body as {
      title?: string;
      description?: string | null;
      status?: 'draft' | 'final';
      folderId?: string | null;
      c4Type?: C4ModelType;
      c4Scope?: string | null;
    };

    if (!isUuid(id)) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) {
        return res.status(400).json({ error: 'title inválido' });
      }
    }
    if (description !== undefined && description !== null && typeof description !== 'string') {
      return res.status(400).json({ error: 'description inválida' });
    }
    if (status !== undefined && status !== 'draft' && status !== 'final') {
      return res.status(400).json({ error: 'status deve ser "draft" ou "final"' });
    }
    if (folderId !== undefined && folderId !== null && !isUuid(folderId)) {
      return res.status(400).json({ error: 'folderId inválido' });
    }
    if (c4Type !== undefined && !isC4ModelType(c4Type)) {
      return res.status(400).json({ error: 'c4Type inválido' });
    }
    if (c4Scope !== undefined && c4Scope !== null && typeof c4Scope !== 'string') {
      return res.status(400).json({ error: 'c4Scope inválido' });
    }

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const orgId = model.org_id as string;
      const sets: string[] = [];
      const values: unknown[] = [];
      let index = 1;

      if (title !== undefined) {
        sets.push(`title = $${index++}`);
        values.push(title.trim());
      }
      if (description !== undefined) {
        sets.push(`description = $${index++}`);
        values.push(cleanOptionalText(description, 5000));
      }
      if (status !== undefined) {
        sets.push(`status = $${index++}`);
        values.push(status);
      }
      if (folderId !== undefined) {
        if (folderId !== null) {
          const folder = await pool.query(
            'SELECT id FROM folders WHERE id = $1 AND org_id = $2',
            [folderId, orgId]
          );
          if (folder.rows.length === 0) {
            return res.status(404).json({ error: 'Pasta não encontrada ou não pertence à organização' });
          }
        }
        sets.push(`folder_id = $${index++}`);
        values.push(folderId);
      }
      if (c4Type !== undefined) {
        sets.push(`c4_type = $${index++}`);
        values.push(c4Type);
      }
      if (c4Scope !== undefined) {
        sets.push(`c4_scope = $${index++}`);
        values.push(cleanOptionalText(c4Scope, 200));
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      values.push(id);
      const result = await pool.query(
        `UPDATE models SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${index} RETURNING *`,
        values
      );
      return res.json(result.rows[0]);
    } catch (err) {
      console.error('[models] update error', err);
      return res.status(500).json({ error: 'Erro ao atualizar modelo' });
    }
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      await pool.query('DELETE FROM models WHERE id = $1', [id]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[models] remove error', err);
      return res.status(500).json({ error: 'Erro ao excluir modelo' });
    }
  }
}
