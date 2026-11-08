import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { getOrgResourceAccess, getOrgRole, isValidUuid, isWriterRole } from '../auth/access.js';

export class FolderController {
  static async list(req: AuthenticatedRequest, res: Response) {
    const { orgId } = req.query as { orgId?: string };
    if (!isValidUuid(orgId)) return res.status(400).json({ error: 'orgId inválido' });

    try {
      if (!(await getOrgRole(req.user!.id, orgId))) {
        return res.status(403).json({ error: 'Sem acesso a esta organização' });
      }
      const result = await pool.query(
        `SELECT * FROM folders WHERE org_id = $1 ORDER BY name ASC`,
        [orgId]
      );
      return res.json(result.rows);
    } catch (err) {
      console.error('[folders] list error', err);
      return res.status(500).json({ error: 'Erro ao listar pastas' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const { orgId, name, parentId } = req.body as {
      orgId?: string;
      name?: string;
      parentId?: string | null;
    };
    const cleanName = typeof name === 'string' ? name.trim() : '';

    if (!isValidUuid(orgId) || !cleanName) {
      return res.status(400).json({ error: 'orgId e name são obrigatórios' });
    }
    if (cleanName.length > 120) {
      return res.status(400).json({ error: 'name muito longo' });
    }
    if (parentId !== undefined && parentId !== null && !isValidUuid(parentId)) {
      return res.status(400).json({ error: 'parentId inválido' });
    }

    try {
      const role = await getOrgRole(req.user!.id, orgId);
      if (!isWriterRole(role)) {
        return res.status(403).json({ error: 'Sem permissão de escrita nesta organização' });
      }
      if (parentId) {
        const parent = await pool.query(
          'SELECT id FROM folders WHERE id = $1 AND org_id = $2',
          [parentId, orgId]
        );
        if (parent.rows.length === 0) {
          return res.status(404).json({ error: 'Pasta pai não encontrada' });
        }
      }
      const result = await pool.query(
        `INSERT INTO folders (org_id, name, parent_id) VALUES ($1, $2, $3) RETURNING *`,
        [orgId, cleanName, parentId ?? null]
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('[folders] create error', err);
      return res.status(500).json({ error: 'Erro ao criar pasta' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { name, parentId } = req.body as {
      name?: string;
      parentId?: string | null;
    };

    try {
      const folder = await getOrgResourceAccess('folders', req.user!.id, id);
      if (!folder) return res.status(404).json({ error: 'Pasta não encontrada' });
      if (!isWriterRole(folder.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar esta pasta' });
      }

      const orgId = folder.org_id as string;
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

      if (parentId !== undefined) {
        if (parentId !== null) {
          if (!isValidUuid(parentId) || parentId === id) {
            return res.status(400).json({ error: 'parentId inválido' });
          }
          const parent = await pool.query(
            'SELECT id FROM folders WHERE id = $1 AND org_id = $2',
            [parentId, orgId]
          );
          if (parent.rows.length === 0) {
            return res.status(404).json({ error: 'Pasta pai não encontrada' });
          }

          // Previne ciclo: o novo pai não pode ser a própria pasta nem um
          // descendente dela.
          const allFolders = await pool.query(
            'SELECT id, parent_id FROM folders WHERE org_id = $1',
            [orgId]
          );
          const childrenByParent = new Map<string, string[]>();
          for (const row of allFolders.rows) {
            const key = row.parent_id ?? '';
            const list = childrenByParent.get(key) ?? [];
            list.push(row.id);
            childrenByParent.set(key, list);
          }
          const descendants = new Set<string>();
          const stack = [id];
          while (stack.length > 0) {
            const current = stack.pop() as string;
            for (const child of childrenByParent.get(current) ?? []) {
              if (!descendants.has(child)) {
                descendants.add(child);
                stack.push(child);
              }
            }
          }
          if (descendants.has(parentId)) {
            return res.status(400).json({ error: 'parentId inválido: pasta descendente' });
          }
        }
        sets.push(`parent_id = $${index++}`);
        values.push(parentId);
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      values.push(id);
      const result = await pool.query(
        `UPDATE folders SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${index} RETURNING *`,
        values
      );
      return res.json(result.rows[0]);
    } catch (err) {
      console.error('[folders] update error', err);
      return res.status(500).json({ error: 'Erro ao atualizar pasta' });
    }
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;

    try {
      const folder = await getOrgResourceAccess('folders', req.user!.id, id);
      if (!folder) return res.status(404).json({ error: 'Pasta não encontrada' });
      if (!isWriterRole(folder.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para excluir esta pasta' });
      }

      await pool.query('DELETE FROM folders WHERE id = $1', [id]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[folders] remove error', err);
      return res.status(500).json({ error: 'Erro ao excluir pasta' });
    }
  }
}
