import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { getOrgRole, isOrgMember, isWriterRole } from '../auth/access.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ['owner', 'editor', 'viewer'] as const;
type GroupRole = (typeof ROLES)[number];

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isRole(value: unknown): value is GroupRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export class GroupController {
  static async list(req: AuthenticatedRequest, res: Response) {
    const { orgId } = req.query as { orgId?: string };
    if (!orgId || !isUuid(orgId)) return res.status(400).json({ error: 'orgId inválido' });

    try {
      if (!(await isOrgMember(req.user!.id, orgId))) {
        return res.status(403).json({ error: 'Sem acesso a esta organização' });
      }
      const result = await pool.query(
        `SELECT g.id, g.org_id, g.name, g.description, g.base_role, g.created_at, g.updated_at,
                (SELECT COUNT(*)::int FROM access_group_members m WHERE m.group_id = g.id) AS member_count
           FROM access_groups g
          WHERE g.org_id = $1
          ORDER BY g.name`,
        [orgId]
      );
      return res.json(result.rows);
    } catch (err) {
      console.error('[groups] list error', err);
      return res.status(500).json({ error: 'Erro ao listar grupos' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const { orgId, name, description, baseRole } = req.body as {
      orgId?: string;
      name?: string;
      description?: string | null;
      baseRole?: string;
    };
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!orgId || !isUuid(orgId)) return res.status(400).json({ error: 'orgId inválido' });
    if (!cleanName || cleanName.length > 120) return res.status(400).json({ error: 'name é obrigatório (máx. 120)' });
    if (!isRole(baseRole)) return res.status(400).json({ error: 'baseRole deve ser owner, editor ou viewer' });

    try {
      const role = await getOrgRole(req.user!.id, orgId);
      if (!isWriterRole(role)) return res.status(403).json({ error: 'Sem permissão para criar grupos' });

      const result = await pool.query(
        `INSERT INTO access_groups (org_id, name, description, base_role)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [orgId, cleanName, description ?? null, baseRole]
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') return res.status(409).json({ error: 'Já existe um grupo com este nome' });
      console.error('[groups] create error', err);
      return res.status(500).json({ error: 'Erro ao criar grupo' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Grupo não encontrado' });
    const { name, description, baseRole } = req.body as {
      name?: string;
      description?: string | null;
      baseRole?: string;
    };

    try {
      const group = await pool.query('SELECT * FROM access_groups WHERE id = $1', [id]);
      if (group.rows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado' });
      const g = group.rows[0];
      const requesterRole = await getOrgRole(req.user!.id, g.org_id);
      if (!isWriterRole(requesterRole)) return res.status(403).json({ error: 'Sem permissão para editar grupos' });

      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (name !== undefined) {
        const cleanName = String(name).trim();
        if (!cleanName) return res.status(400).json({ error: 'name inválido' });
        sets.push(`name = $${idx++}`);
        values.push(cleanName);
      }
      if (description !== undefined) {
        sets.push(`description = $${idx++}`);
        values.push(description);
      }
      if (baseRole !== undefined) {
        if (!isRole(baseRole)) return res.status(400).json({ error: 'baseRole inválido' });
        sets.push(`base_role = $${idx++}`);
        values.push(baseRole);
      }
      if (sets.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      sets.push(`updated_at = NOW()`);
      values.push(id);
      const result = await pool.query(
        `UPDATE access_groups SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      return res.json(result.rows[0]);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') return res.status(409).json({ error: 'Já existe um grupo com este nome' });
      console.error('[groups] update error', err);
      return res.status(500).json({ error: 'Erro ao atualizar grupo' });
    }
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Grupo não encontrado' });

    try {
      const group = await pool.query('SELECT * FROM access_groups WHERE id = $1', [id]);
      if (group.rows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado' });
      const g = group.rows[0];
      const requesterRole = await getOrgRole(req.user!.id, g.org_id);
      if (!isWriterRole(requesterRole)) return res.status(403).json({ error: 'Sem permissão para excluir grupos' });

      await pool.query('DELETE FROM access_groups WHERE id = $1', [id]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[groups] remove error', err);
      return res.status(500).json({ error: 'Erro ao excluir grupo' });
    }
  }

  static async members(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Grupo não encontrado' });

    try {
      const group = await pool.query('SELECT * FROM access_groups WHERE id = $1', [id]);
      if (group.rows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado' });
      const g = group.rows[0];
      if (!(await isOrgMember(req.user!.id, g.org_id))) {
        return res.status(403).json({ error: 'Sem acesso' });
      }

      const result = await pool.query(
        `SELECT u.id AS user_id, u.name, u.email, m.created_at
           FROM access_group_members m
           JOIN users u ON u.id = m.user_id
          WHERE m.group_id = $1
          ORDER BY u.name`,
        [id]
      );
      return res.json(result.rows);
    } catch (err) {
      console.error('[groups] members error', err);
      return res.status(500).json({ error: 'Erro ao listar membros do grupo' });
    }
  }

  static async addMember(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { userId } = req.body as { userId?: string };
    if (!isUuid(id)) return res.status(404).json({ error: 'Grupo não encontrado' });
    if (!isUuid(userId)) return res.status(400).json({ error: 'userId inválido' });

    try {
      const group = await pool.query('SELECT * FROM access_groups WHERE id = $1', [id]);
      if (group.rows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado' });
      const g = group.rows[0];
      const requesterRole = await getOrgRole(req.user!.id, g.org_id);
      if (!isWriterRole(requesterRole)) return res.status(403).json({ error: 'Sem permissão' });

      // usuário deve ser membro da organização
      const mem = await pool.query('SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2', [g.org_id, userId]);
      if (mem.rows.length === 0) return res.status(400).json({ error: 'Usuário não é membro da organização' });

      await pool.query(
        `INSERT INTO access_group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, userId]
      );

      // aplica o base_role do grupo à membership, se for mais permissivo
      const roleRank: Record<string, number> = { viewer: 0, editor: 1, owner: 2 };
      const currentRole = mem.rows[0].role as string;
      if (roleRank[g.base_role] > roleRank[currentRole]) {
        await pool.query('UPDATE memberships SET role = $1 WHERE org_id = $2 AND user_id = $3', [g.base_role, g.org_id, userId]);
      }

      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('[groups] addMember error', err);
      return res.status(500).json({ error: 'Erro ao adicionar membro ao grupo' });
    }
  }

  static async removeMember(req: AuthenticatedRequest, res: Response) {
    const { id, userId } = req.params;
    if (!isUuid(id) || !isUuid(userId)) return res.status(400).json({ error: 'Parâmetros inválidos' });

    try {
      const group = await pool.query('SELECT * FROM access_groups WHERE id = $1', [id]);
      if (group.rows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado' });
      const g = group.rows[0];
      const requesterRole = await getOrgRole(req.user!.id, g.org_id);
      if (!isWriterRole(requesterRole)) return res.status(403).json({ error: 'Sem permissão' });

      await pool.query('DELETE FROM access_group_members WHERE group_id = $1 AND user_id = $2', [id, userId]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[groups] removeMember error', err);
      return res.status(500).json({ error: 'Erro ao remover membro do grupo' });
    }
  }
}