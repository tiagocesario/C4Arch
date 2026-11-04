import { Router } from 'express';
import { verifyToken, requireRole, AuthenticatedRequest } from '../auth/middleware.js';
import { pool } from '../db.js';

const router = Router();

// Criar organização (owner)
router.post('/', verifyToken, requireRole('owner'), async (req, res) => {
  try {
    const { name, slug } = req.body as { name?: string; slug?: string };
    if (!name) {
      return res.status(400).json({ error: 'name é obrigatória' });
    }
    const slugValue = slug ?? name.toLowerCase().replace(/\s+/g, '-');
    const result = await pool.query(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug`,
      [name, slugValue]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Listar organizações do usuário
router.get('/', verifyToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const result = await pool.query(
      `SELECT o.id, o.name, o.slug,
              m.role
       FROM organizations o
       JOIN memberships m ON m.org_id = o.id
       WHERE m.user_id = $1
       ORDER BY o.name`,
      [userId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Obter organização por ID
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, name, slug FROM organizations WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organização não encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Adicionar membro
router.post('/:id/members', verifyToken, requireRole('owner'), async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body as { user_id: string };
    if (!user_id) {
      return res.status(400).json({ error: 'user_id é obrigatório' });
    }
    // Verificar se a org existe
    const orgCheck = await pool.query(
      'SELECT id FROM organizations WHERE id = $1',
      [id]
    );
    if (orgCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Organização não encontrada' });
    }
    const memberCheck = await pool.query(
      'SELECT id FROM memberships WHERE org_id = $1 AND user_id = $2',
      [id, user_id]
    );
    if (memberCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Já é membro desta organização' });
    }
    const result = await pool.query(
      `INSERT INTO memberships (org_id, user_id, role)
       VALUES ($1, $2, 'viewer') RETURNING id, org_id, user_id, role`,
      [id, user_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;


