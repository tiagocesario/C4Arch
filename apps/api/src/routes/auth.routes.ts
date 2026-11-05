import { Router } from 'express';
import { AuthService } from '../auth/service.js';
import { verifyToken, AuthenticatedRequest } from '../auth/middleware.js';
import { signSessionToken } from '../auth/tokens.js';
import { config } from '../config.js';
import { pool } from '../db.js';

const router = Router();

const KNOWN_REGISTER_ERRORS = new Set([
  'Email inválido',
  'Senha muito longa',
  'Nome inválido',
  'Email já cadastrado',
]);

// Registro
router.post('/register', async (req, res) => {
  if (!config.allowRegistration) {
    return res.status(403).json({ error: 'Registro de novos usuários desabilitado' });
  }

  const { email, name, password } = req.body as {
    email?: string;
    name?: string;
    password?: string;
  };

  if (typeof email !== 'string' || typeof name !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email, name e password são obrigatórios' });
  }

  try {
    const user = await AuthService.register(email, name, password);
    const token = signSessionToken({ id: user.id, email: user.email, role: 'editor' });
    return res.status(201).json({ token, user });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (KNOWN_REGISTER_ERRORS.has(message) || message.startsWith('A senha deve ter')) {
      return res.status(400).json({ error: message });
    }
    console.error('[auth] register error', err);
    return res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email e password são obrigatórios' });
  }

  try {
    const result = await AuthService.login(email, password);
    return res.json(result);
  } catch {
    // Mensagem genérica: não revela se o e-mail existe.
    return res.status(401).json({ error: 'Email ou senha inválidos' });
  }
});

// Perfil do usuário autenticado (inclui a org da qual ele pertence)
router.get('/me', verifyToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const userResult = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [
      userId,
    ]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    const user = userResult.rows[0];
    const orgResult = await pool.query(
      `SELECT o.id AS org_id, o.name AS org_name
         FROM organizations o
         JOIN memberships mem ON mem.org_id = o.id
        WHERE mem.user_id = $1
        LIMIT 1`,
      [userId]
    );
    const org = orgResult.rows[0] ?? null;
    return res.json({
      user: { id: user.id, email: user.email, name: user.name },
      org: org ? { id: org.org_id, name: org.org_name } : null,
    });
  } catch (err) {
    console.error('[auth] me error', err);
    return res.status(500).json({ error: 'Erro ao carregar sessão' });
  }
});

export default router;
