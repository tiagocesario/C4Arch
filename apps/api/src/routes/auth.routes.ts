import { Router } from 'express';
import crypto from 'crypto';
import { AuthService } from '../auth/service.js';
import { verifyToken, AuthenticatedRequest } from '../auth/middleware.js';
import { signSessionToken } from '../auth/tokens.js';
import { config } from '../config.js';
import { pool } from '../db.js';

const router = Router();

const KNOWN_REGISTER_ERRORS = new Set([
  'Email invÃƒÂ¡lido',
  'Senha muito longa',
  'Nome invÃƒÂ¡lido',
  'Email jÃƒÂ¡ cadastrado',
]);

// Registro
router.post('/register', async (req, res) => {
  if (!config.allowRegistration) {
    return res.status(403).json({ error: 'Registro de novos usuÃƒÂ¡rios desabilitado' });
  }

  const { email, name, password } = req.body as {
    email?: string;
    name?: string;
    password?: string;
  };

  if (typeof email !== 'string' || typeof name !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email, name e password sÃƒÂ£o obrigatÃƒÂ³rios' });
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
    return res.status(500).json({ error: 'Erro ao criar usuÃƒÂ¡rio' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email e password sÃƒÂ£o obrigatÃƒÂ³rios' });
  }

  try {
    const result = await AuthService.login(email, password);
    return res.json(result);
  } catch {
    // Mensagem genÃƒÂ©rica: nÃƒÂ£o revela se o e-mail existe.
    return res.status(401).json({ error: 'Email ou senha invÃƒÂ¡lidos' });
  }
});

// Perfil do usuÃƒÂ¡rio autenticado (inclui a org da qual ele pertence)
router.get('/me', verifyToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const userResult = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [
      userId,
    ]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'UsuÃƒÂ¡rio nÃƒÂ£o encontrado' });
    }
    const user = userResult.rows[0];
    const orgResult = await pool.query(
      `SELECT o.id AS org_id, o.name AS org_name, mem.role
         FROM organizations o
         JOIN memberships mem ON mem.org_id = o.id
        WHERE mem.user_id = $1
        LIMIT 1`,
      [userId]
    );
    const org = orgResult.rows[0] ?? null;
    return res.json({
      user: { id: user.id, email: user.email, name: user.name },
      // O papel vem de `memberships`, nunca do JWT. Ãƒâ€° usado apenas para a UI;
      // cada rota do servidor revalida a permissÃƒÂ£o no banco.
      org: org ? { id: org.org_id, name: org.org_name, role: org.role } : null,
    });
  } catch (err) {
    console.error('[auth] me error', err);
    return res.status(500).json({ error: 'Erro ao carregar sessÃƒÂ£o' });
  }
});


const oauthStates = new Map();

function pruneOauthStates() {
  const now = Date.now();
  for (const [key, value] of oauthStates) {
    if (now - value.createdAt > 10 * 60 * 1000) oauthStates.delete(key);
  }
}

router.get('/google', (req, res) => {
  if (!config.googleClientId || !config.googleClientSecret) {
    return res.status(503).json({ error: 'Login com Google nao configurado' });
  }
  pruneOauthStates();
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, { createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleCallbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  });
  return res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

router.get('/google/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!code || !state || !oauthStates.has(state)) {
    return res.status(400).json({ error: 'Estado OAuth invalido ou expirado' });
  }
  oauthStates.delete(state);

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: config.googleCallbackUrl,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!tokenRes.ok) {
      return res.status(401).json({ error: 'Falha ao autenticar com Google' });
    }
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) return res.status(401).json({ error: 'Token do Google ausente' });

    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Falha ao obter perfil do Google' });
    const profile = await userRes.json();
    const email = String(profile.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email nao informado pelo Google' });

    const domain = email.split('@')[1] || '';
    const ruleResult = await pool.query(
      'SELECT r.org_id, r.role, o.name FROM login_domain_rules r JOIN organizations o ON o.id = r.org_id WHERE r.enabled = TRUE AND lower(r.domain) = $1 ORDER BY r.created_at ASC LIMIT 1',
      [domain]
    );
    const rule = ruleResult.rows[0];
    if (!rule) {
      return res.status(403).json({ error: 'Dominio de email nao autorizado' });
    }

    let userResult = await pool.query('SELECT id, email, name FROM users WHERE lower(email) = $1', [email]);
    let user = userResult.rows[0];
    if (!user) {
      const randomPassword = crypto.randomBytes(24).toString('hex');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(randomPassword, salt, 64).toString('hex');
      const passwordHash = salt + hash;
      const inserted = await pool.query(
        'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id, email, name',
        [email, (profile.name || email.split('@')[0]).trim(), passwordHash]
      );
      user = inserted.rows[0];
      if (!user) {
        userResult = await pool.query('SELECT id, email, name FROM users WHERE lower(email) = $1', [email]);
        user = userResult.rows[0];
      }
    }
    if (!user) return res.status(500).json({ error: 'Falha ao criar usuario SSO' });

    await pool.query(
      'INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (org_id, user_id) DO NOTHING',
      [rule.org_id, user.id, rule.role]
    );

    const token = signSessionToken({ id: user.id, email: user.email, role: rule.role });
    const redirectUrl = new URL(config.frontendUrl);
    redirectUrl.searchParams.set('token', token);
    return res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error('[auth] google callback error', err);
    return res.status(500).json({ error: 'Erro ao concluir login com Google' });
  }
});

router.get('/domains', verifyToken, async (req: AuthenticatedRequest, res) => {
  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : '';
  if (!orgId) return res.status(400).json({ error: 'orgId e obrigatorio' });
  try {
    const { getOrgRole } = await import('../auth/access.js');
    const role = await getOrgRole(req.user!.id, orgId);
    if (role !== 'owner') return res.status(403).json({ error: 'Somente owner pode gerenciar dominios' });
    const result = await pool.query(
      'SELECT id, org_id, domain, role, enabled, created_at FROM login_domain_rules WHERE org_id = $1 ORDER BY domain',
      [orgId]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('[auth] domains list error', err);
    return res.status(500).json({ error: 'Erro ao listar dominios' });
  }
});

router.post('/domains', verifyToken, async (req: AuthenticatedRequest, res) => {
  const { orgId, domain, role } = req.body || {};
  if (!orgId || typeof domain !== 'string' || !domain.trim()) {
    return res.status(400).json({ error: 'orgId e domain sao obrigatorios' });
  }
  const cleanDomain = domain.trim().toLowerCase().replace(/^@/, '');
  const cleanRole = role === 'editor' || role === 'owner' ? role : 'viewer';
  try {
    const { getOrgRole } = await import('../auth/access.js');
    const ownerRole = await getOrgRole(req.user!.id, orgId);
    if (ownerRole !== 'owner') return res.status(403).json({ error: 'Somente owner pode gerenciar dominios' });
    const result = await pool.query(
      'INSERT INTO login_domain_rules (org_id, domain, role) VALUES ($1, $2, $3) ON CONFLICT (org_id, domain) DO UPDATE SET role = EXCLUDED.role, enabled = TRUE RETURNING id, org_id, domain, role, enabled, created_at',
      [orgId, cleanDomain, cleanRole]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[auth] domains create error', err);
    return res.status(500).json({ error: 'Erro ao criar dominio' });
  }
});

router.delete('/domains/:id', verifyToken, async (req: AuthenticatedRequest, res) => {
  try {
    const found = await pool.query('SELECT org_id FROM login_domain_rules WHERE id = $1', [req.params.id]);
    if (found.rows.length === 0) return res.status(404).json({ error: 'Dominio nao encontrado' });
    const orgId = found.rows[0].org_id;
    const { getOrgRole } = await import('../auth/access.js');
    const role = await getOrgRole(req.user!.id, orgId);
    if (role !== 'owner') return res.status(403).json({ error: 'Somente owner pode gerenciar dominios' });
    await pool.query('DELETE FROM login_domain_rules WHERE id = $1', [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth] domains delete error', err);
    return res.status(500).json({ error: 'Erro ao excluir dominio' });
  }
});

export default router;
