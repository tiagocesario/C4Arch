import { Router } from 'express';
import { verifyToken, AuthenticatedRequest } from '../auth/middleware.js';
import { getOrgRole } from '../auth/access.js';
import { pool } from '../db.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
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

// Adicionar membro (somente owner da própria organização)
router.post('/:id/members', verifyToken, async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { userId, user_id } = req.body as { userId?: string; user_id?: string };
  const targetUserId = userId ?? user_id;

  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Organização não encontrada' });
  }
  if (!isUuid(targetUserId)) {
    return res.status(400).json({ error: 'userId é obrigatório' });
  }

  try {
    const role = await getOrgRole(req.user!.id, id);
    if (role !== 'owner') {
      return res.status(403).json({ error: 'Somente o owner pode adicionar membros' });
    }

    const orgCheck = await pool.query('SELECT id FROM organizations WHERE id = $1', [id]);
    if (orgCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Organização não encontrada' });
    }

    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [targetUserId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const result = await pool.query(
      `INSERT INTO memberships (org_id, user_id, role)
       VALUES ($1, $2, 'viewer')
       ON CONFLICT (org_id, user_id) DO NOTHING
       RETURNING id, org_id, user_id, role`,
      [id, targetUserId]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Já é membro desta organização' });
    }

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[orgs] add member error', err);
    return res.status(500).json({ error: 'Erro ao adicionar membro' });
  }
});

export default router;
