import crypto from 'crypto';
import { Router } from 'express';
import { verifyToken, AuthenticatedRequest } from '../auth/middleware.js';
import { getOrgRole } from '../auth/access.js';
import { AuthService } from '../auth/service.js';
import { pool } from '../db.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;

const ROLES = ['owner', 'editor', 'viewer'] as const;
type OrgRole = (typeof ROLES)[number];

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

const MEMBER_SELECT = `
  SELECT m.id, m.user_id, u.name, u.email, m.role, m.created_at
    FROM memberships m
    JOIN users u ON u.id = m.user_id`;

async function findMembership(orgId: string, userId: string) {
  const result = await pool.query<{ id: string; role: OrgRole }>(
    'SELECT id, role FROM memberships WHERE org_id = $1 AND user_id = $2',
    [orgId, userId]
  );
  return result.rows[0] ?? null;
}

async function countOwners(orgId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM memberships
      WHERE org_id = $1 AND role = 'owner'`,
    [orgId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function loadMember(orgId: string, userId: string) {
  const result = await pool.query(
    `${MEMBER_SELECT} WHERE m.org_id = $1 AND m.user_id = $2`,
    [orgId, userId]
  );
  return result.rows[0] ?? null;
}

function knownUserErrors(message: string): boolean {
  return (
    message === 'Email inválido' ||
    message === 'Nome inválido' ||
    message === 'Senha muito longa' ||
    message.startsWith('A senha deve ter')
  );
}

// Criar organização (qualquer usuário autenticado vira owner da nova org)
router.post('/', verifyToken, async (req: AuthenticatedRequest, res) => {
  const { name, slug } = req.body as { name?: string; slug?: string };
  const cleanName = typeof name === 'string' ? name.trim() : '';

  if (!cleanName || cleanName.length > 120) {
    return res.status(400).json({ error: 'name é obrigatório (máx. 120 caracteres)' });
  }

  const cleanSlug =
    typeof slug === 'string' && slug.trim()
      ? slug.trim().toLowerCase()
      : cleanName
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

  if (!SLUG_RE.test(cleanSlug)) {
    return res.status(400).json({ error: 'slug inválido' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orgResult = await client.query(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug`,
      [cleanName, cleanSlug]
    );
    const org = orgResult.rows[0];
    await client.query(
      `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [org.id, req.user!.id]
    );
    await client.query('COMMIT');
    return res.status(201).json(org);
  } catch (err) {
    await client.query('ROLLBACK');
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      return res.status(409).json({ error: 'Já existe uma organização com este slug' });
    }
    console.error('[orgs] create error', err);
    return res.status(500).json({ error: 'Erro ao criar organização' });
  } finally {
    client.release();
  }
});

// Listar organizações do usuário
router.get('/', verifyToken, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.name, o.slug, m.role
         FROM organizations o
         JOIN memberships m ON m.org_id = o.id
        WHERE m.user_id = $1
        ORDER BY o.name`,
      [req.user!.id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('[orgs] list error', err);
    return res.status(500).json({ error: 'Erro ao listar organizações' });
  }
});

// Obter organização por ID (somente membros)
router.get('/:id', verifyToken, async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Organização não encontrada' });
  }

  try {
    const role = await getOrgRole(req.user!.id, id);
    if (!role) {
      return res.status(404).json({ error: 'Organização não encontrada' });
    }
    const result = await pool.query('SELECT id, name, slug FROM organizations WHERE id = $1', [
      id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organização não encontrada' });
    }
    return res.json({ ...result.rows[0], role });
  } catch (err) {
    console.error('[orgs] get error', err);
    return res.status(500).json({ error: 'Erro ao carregar organização' });
  }
});

// Listar membros (qualquer membro da organização pode ver a equipe)
router.get('/:id/members', verifyToken, async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;

  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Organização não encontrada' });
  }

  try {
    const role = await getOrgRole(req.user!.id, id);
    if (!role) {
      return res.status(404).json({ error: 'Organização não encontrada' });
    }

    const result = await pool.query(
      `${MEMBER_SELECT}
        WHERE m.org_id = $1
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.name`,
      [id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('[orgs] list members error', err);
    return res.status(500).json({ error: 'Erro ao listar membros' });
  }
});

// Adicionar membro / convidar por e-mail (somente owner da própria organização).
// Se o e-mail ainda não existir, cria a conta com uma senha temporária exibida
// uma única vez na resposta para o owner compartilhar com segurança.
router.post('/:id/members', verifyToken, async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const {
    userId,
    user_id,
    email,
    name,
    role: requestedRole,
  } = req.body as {
    userId?: string;
    user_id?: string;
    email?: string;
    name?: string;
    role?: string;
  };
  const targetUserId = userId ?? user_id;
  const memberRole = requestedRole === undefined ? 'viewer' : requestedRole;

  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Organização não encontrada' });
  }
  if (!isRole(memberRole)) {
    return res.status(400).json({ error: 'role deve ser owner, editor ou viewer' });
  }
  if (!isUuid(targetUserId) && (typeof email !== 'string' || !email.trim())) {
    return res.status(400).json({ error: 'userId ou email é obrigatório' });
  }

  try {
    const requesterRole = await getOrgRole(req.user!.id, id);
    if (requesterRole !== 'owner') {
      return res.status(403).json({ error: 'Somente o owner pode adicionar membros' });
    }

    const orgCheck = await pool.query('SELECT id FROM organizations WHERE id = $1', [id]);
    if (orgCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Organização não encontrada' });
    }

    let target: { id: string; email: string; name: string } | null = null;
    let temporaryPassword: string | undefined;

    if (isUuid(targetUserId)) {
      const userCheck = await pool.query<{ id: string; email: string; name: string }>(
        'SELECT id, email, name FROM users WHERE id = $1',
        [targetUserId]
      );
      target = userCheck.rows[0] ?? null;
      if (!target) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }
    } else {
      const cleanEmail = email!.trim().toLowerCase();
      const existing = await pool.query<{ id: string; email: string; name: string }>(
        'SELECT id, email, name FROM users WHERE lower(email) = $1',
        [cleanEmail]
      );

      if (existing.rows.length > 0) {
        target = existing.rows[0];
      } else {
        const cleanName = typeof name === 'string' ? name.trim() : '';
        if (!cleanName) {
          return res
            .status(400)
            .json({ error: 'name é obrigatório para criar uma conta nova' });
        }

        temporaryPassword = crypto.randomBytes(12).toString('base64url');
        try {
          target = await AuthService.register(cleanEmail, cleanName, temporaryPassword);
        } catch (err) {
          const message = err instanceof Error ? err.message : '';
          // Corrida entre dois owners convidando o mesmo e-mail.
          if (message === 'Email já cadastrado') {
            const retry = await pool.query<{ id: string; email: string; name: string }>(
              'SELECT id, email, name FROM users WHERE lower(email) = $1',
              [cleanEmail]
            );
            target = retry.rows[0] ?? null;
            temporaryPassword = undefined;
          } else if (knownUserErrors(message)) {
            return res.status(400).json({ error: message });
          } else {
            throw err;
          }
        }
      }
    }

    if (!target) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const inserted = await pool.query(
      `INSERT INTO memberships (org_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, user_id) DO NOTHING
       RETURNING id`,
      [id, target.id, memberRole]
    );

    if (inserted.rows.length === 0) {
      return res.status(409).json({ error: 'Já é membro desta organização' });
    }

    const member = await loadMember(id, target.id);
    return res.status(201).json({ member, temporaryPassword });
  } catch (err) {
    console.error('[orgs] add member error', err);
    return res.status(500).json({ error: 'Erro ao adicionar membro' });
  }
});

// Alterar o perfil de um membro (somente owner)
router.patch('/:id/members/:userId', verifyToken, async (req: AuthenticatedRequest, res) => {
  const { id, userId } = req.params;
  const { role } = req.body as { role?: string };

  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Organização não encontrada' });
  }
  if (!isUuid(userId)) {
    return res.status(404).json({ error: 'Membro não encontrado' });
  }
  if (!isRole(role)) {
    return res.status(400).json({ error: 'role deve ser owner, editor ou viewer' });
  }

  try {
    const requesterRole = await getOrgRole(req.user!.id, id);
    if (requesterRole !== 'owner') {
      return res.status(403).json({ error: 'Somente o owner pode alterar perfis' });
    }

    const membership = await findMembership(id, userId);
    if (!membership) {
      return res.status(404).json({ error: 'Membro não encontrado' });
    }

    if (membership.role === 'owner' && role !== 'owner' && (await countOwners(id)) <= 1) {
      return res
        .status(409)
        .json({ error: 'A organização precisa de pelo menos um owner' });
    }

    await pool.query('UPDATE memberships SET role = $1 WHERE org_id = $2 AND user_id = $3', [
      role,
      id,
      userId,
    ]);

    const member = await loadMember(id, userId);
    return res.json(member);
  } catch (err) {
    console.error('[orgs] update member error', err);
    return res.status(500).json({ error: 'Erro ao alterar perfil do membro' });
  }
});

// Remover membro (somente owner). O owner não pode remover a si mesmo nem
// deixar a organização sem nenhum owner.
router.delete('/:id/members/:userId', verifyToken, async (req: AuthenticatedRequest, res) => {
  const { id, userId } = req.params;

  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Organização não encontrada' });
  }
  if (!isUuid(userId)) {
    return res.status(404).json({ error: 'Membro não encontrado' });
  }
  if (userId === req.user!.id) {
    return res.status(409).json({ error: 'Você não pode remover a si mesmo da organização' });
  }

  try {
    const requesterRole = await getOrgRole(req.user!.id, id);
    if (requesterRole !== 'owner') {
      return res.status(403).json({ error: 'Somente o owner pode remover membros' });
    }

    const membership = await findMembership(id, userId);
    if (!membership) {
      return res.status(404).json({ error: 'Membro não encontrado' });
    }

    if (membership.role === 'owner' && (await countOwners(id)) <= 1) {
      return res
        .status(409)
        .json({ error: 'A organização precisa de pelo menos um owner' });
    }

    await pool.query('DELETE FROM memberships WHERE org_id = $1 AND user_id = $2', [id, userId]);
    return res.status(204).send();
  } catch (err) {
    console.error('[orgs] remove member error', err);
    return res.status(500).json({ error: 'Erro ao remover membro' });
  }
});

export default router;
