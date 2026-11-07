import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { getModelAccess, getOrgRole, isWriterRole } from '../auth/access.js';
import {
  DEFAULT_C4_MODEL_TYPE,
  isC4ModelType,
  type C4ModelType,
} from '../c4/model-types.js';
import { generateDAS } from '../c4/das.js';
import { parseDiagrams } from '../c4/diagrams.js';

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
    const { orgId, title, description, status, folderId, c4Type, c4Scope, parentId } = req.body as {
      orgId?: string;
      title?: string;
      description?: string | null;
      status?: 'draft' | 'final';
      folderId?: string | null;
      c4Type?: C4ModelType;
      c4Scope?: string | null;
      parentId?: string | null;
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
    if (parentId !== undefined && parentId !== null && !isUuid(parentId)) {
      return res.status(400).json({ error: 'parentId inválido' });
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

      // Validação de vínculo a modelo existente (parent) e unicidade do tipo de diagrama
      const effectiveC4Type = c4Type ?? DEFAULT_C4_MODEL_TYPE;
      if (parentId) {
        const parent = await pool.query(
          'SELECT id, org_id, c4_type FROM models WHERE id = $1',
          [parentId]
        );
        if (parent.rows.length === 0 || parent.rows[0].org_id !== orgId) {
          return res.status(404).json({ error: 'Modelo pai não encontrado ou não pertence à organização' });
        }
        // Impede mais de um modelo com o mesmo tipo de diagrama no mesmo grupo
        const dup = await pool.query(
          `SELECT id FROM models WHERE org_id = $1 AND c4_type = $2
             AND (id = $3 OR parent_id = $3)`,
          [orgId, effectiveC4Type, parentId]
        );
        if (dup.rows.length > 0 || parent.rows[0].c4_type === effectiveC4Type) {
          return res.status(409).json({ error: 'Já existe um diagrama deste tipo vinculado a este modelo' });
        }
      }
 
      const model = await pool.query(
        `INSERT INTO models (org_id, title, description, status, folder_id, c4_type, c4_scope, parent_id)
         VALUES ($1, $2, $3, COALESCE($4, 'draft'), $5, $6, $7, $8) RETURNING *`,
        [
          orgId,
          cleanTitle,
          cleanOptionalText(description, 5000),
          status ?? null,
          folderId ?? null,
          c4Type ?? DEFAULT_C4_MODEL_TYPE,
          cleanOptionalText(c4Scope, 200),
          parentId ?? null,
        ]
      );
      const created = model.rows[0];
      // Gera o DAS automaticamente
      let folderName: string | null = null;
      if (folderId) {
        const f = await pool.query('SELECT name FROM folders WHERE id = $1', [folderId]);
        folderName = f.rows[0]?.name ?? null;
      }
      const das = generateDAS(
        {
          id: created.id,
          title: created.title,
          description: created.description,
          status: created.status,
          c4_type: created.c4_type,
          c4_scope: created.c4_scope,
          folder_id: created.folder_id,
          org_id: created.org_id,
        },
        [],
        [],
        folderName,
        created.drawio_xml ?? null
      );
      await pool.query('UPDATE models SET das_content = $1 WHERE id = $2', [das, created.id]);
      created.das_content = das;
      return res.status(201).json(created);
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

  /**
   * Vincula um novo tipo de diagrama ao MESMO modelo (não cria novo modelo).
   * Os diagramas extras ficam na coluna JSONB `diagrams`.
   */
  static async addDiagram(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { c4Type } = req.body as { c4Type?: C4ModelType };

    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    if (!isC4ModelType(c4Type)) {
      return res.status(400).json({ error: 'c4Type inválido' });
    }

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const diagrams = parseDiagrams(model.diagrams);
      if (model.c4_type === c4Type || diagrams.some((d) => d.c4Type === c4Type)) {
        return res.status(409).json({ error: 'Este tipo de diagrama já existe neste modelo' });
      }

      const next = [...diagrams, { c4Type, drawioXml: null }];
      const result = await pool.query(
        'UPDATE models SET diagrams = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING *',
        [JSON.stringify(next), id]
      );
      return res.status(201).json({ ...result.rows[0], diagrams: parseDiagrams(result.rows[0].diagrams) });
    } catch (err) {
      console.error('[models] addDiagram error', err);
      return res.status(500).json({ error: 'Erro ao adicionar tipo de diagrama' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { title, description, status, folderId, c4Type, c4Scope, parentId } = req.body as {
      title?: string;
      description?: string | null;
      status?: 'draft' | 'final';
      folderId?: string | null;
      c4Type?: C4ModelType;
      c4Scope?: string | null;
      parentId?: string | null;
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
    if (parentId !== undefined && parentId !== null && !isUuid(parentId)) {
      return res.status(400).json({ error: 'parentId inválido' });
    }
 
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const orgId = model.org_id as string;
      // Validação de vínculo/uniqueness se parentId ou c4Type forem alterados
      const newParentId = parentId !== undefined ? parentId : (model.parent_id as string | null);
      const newC4Type = c4Type !== undefined ? c4Type : (model.c4_type as C4ModelType);
      if (parentId !== undefined && parentId !== null) {
        const parent = await pool.query('SELECT id, org_id, c4_type FROM models WHERE id = $1', [parentId]);
        if (parent.rows.length === 0 || parent.rows[0].org_id !== orgId) {
          return res.status(404).json({ error: 'Modelo pai não encontrado ou não pertence à organização' });
        }
      }
      // unicidade do tipo de diagrama no grupo
      const groupRoot = newParentId ?? id;
      const dup = await pool.query(
        `SELECT id FROM models WHERE org_id = $1 AND c4_type = $2
           AND (id = $3 OR parent_id = $3) AND id <> $4`,
        [orgId, newC4Type, groupRoot, id]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'Já existe um diagrama deste tipo vinculado a este modelo' });
      }
      if (groupRoot !== id) {
        const parentRow = await pool.query('SELECT c4_type FROM models WHERE id = $1', [groupRoot]);
        if (parentRow.rows[0]?.c4_type === newC4Type) {
          return res.status(409).json({ error: 'Já existe um diagrama deste tipo vinculado a este modelo' });
        }
      }
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
      if (parentId !== undefined) {
        sets.push(`parent_id = $${index++}`);
        values.push(parentId);
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
      const updated = result.rows[0];
      // Regenera o DAS automaticamente a partir do modelo atual
      const elems = await pool.query('SELECT * FROM elements WHERE model_id = $1 ORDER BY "order"', [id]);
      const edgs = await pool.query(
        `SELECT e.* FROM edges e WHERE e.model_id = $1`,
        [id]
      );
      let folderName: string | null = null;
      if (updated.folder_id) {
        const f = await pool.query('SELECT name FROM folders WHERE id = $1', [updated.folder_id]);
        folderName = f.rows[0]?.name ?? null;
      }
      const das = generateDAS(
        {
          id: updated.id,
          title: updated.title,
          description: updated.description,
          status: updated.status,
          c4_type: updated.c4_type,
          c4_scope: updated.c4_scope,
          folder_id: updated.folder_id,
          org_id: updated.org_id,
        },
        elems.rows,
        edgs.rows,
        folderName,
        updated.drawio_xml ?? null
      );
      await pool.query('UPDATE models SET das_content = $1 WHERE id = $2', [das, id]);
      updated.das_content = das;
      return res.json(updated);
    } catch (err) {
      console.error('[models] update error', err);
      return res.status(500).json({ error: 'Erro ao atualizar modelo' });
    }
  }

  static async das(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      const result = await pool.query('SELECT das_content FROM models WHERE id = $1', [id]);
      return res.json({ id, content: result.rows[0]?.das_content ?? '' });
    } catch (err) {
      console.error('[models] das error', err);
      return res.status(500).json({ error: 'Erro ao carregar DAS' });
    }
  }

  static async updateDas(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { content } = req.body as { content?: string };
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'content inválido' });
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }
      await pool.query('UPDATE models SET das_content = $1, updated_at = NOW() WHERE id = $2', [content, id]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[models] updateDas error', err);
      return res.status(500).json({ error: 'Erro ao salvar DAS' });
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
