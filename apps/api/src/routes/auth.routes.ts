import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { AuthService } from '../auth/service.js';
import { verifyToken, requireRole, AuthenticatedRequest } from '../auth/middleware.js';
import { pool } from '../db.js';

const router = Router();

// Registro
router.post('/register', async (req, res) => {
  try {
    const { email, name, password } = req.body as {
      email: string;
      name: string;
      password: string;
    };
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'email, name e password são obrigatórios' });
    }
    const user = await AuthService.register(email, name, password);
    const token = jwtSign(user.id, user.email);
    res.status(201).json({ token, user });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) {
      return res.status(400).json({ error: 'email e password são obrigatórios' });
    }
    const result = await AuthService.login(email, password);
    res.json(result);
  } catch (err: any) {
    res.status(401).json({ error: err.message });
  }
});

// Perfil do usuário autenticado (inclui a org da qual ele pertence)
router.get('/me', verifyToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const userResult = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    const user = userResult.rows[0];
    const orgResult = await pool.query(
      `SELECT o.id AS org_id, o.name AS org_name FROM organizations o
       JOIN memberships mem ON mem.org_id = o.id
       WHERE mem.user_id = $1
       LIMIT 1`,
      [userId]
    );
    const org = orgResult.rows[0] ?? null;
    res.json({
      user: { id: user.id, email: user.email, name: user.name },
      org: org ? { id: org.org_id, name: org.org_name } : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

function jwtSign(id: string, email: string): string {
  const secret = process.env.JWT_SECRET ?? '';
  return jwt.sign({ id, email, role: 'editor' }, secret, { expiresIn: '7d' });
}
