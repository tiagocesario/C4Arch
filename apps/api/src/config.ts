import dotenv from 'dotenv';
import type { SignOptions } from 'jsonwebtoken';

dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

const PLACEHOLDER_SECRET_PATTERNS = [
  'change-me',
  'changeme',
  'your-secret',
  'your_secret',
  'example-secret',
  'example_secret',
  'dev-secret',
  'supersecret',
  'secret-key',
  'troque-este',
];

function looksLikePlaceholderSecret(secret: string): boolean {
  const normalized = secret.toLowerCase();
  return PLACEHOLDER_SECRET_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function readJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim() ?? '';
  if (isProduction && looksLikePlaceholderSecret(secret)) {
    throw new Error(
      'JWT_SECRET usa um valor de exemplo/placeholder. Gere um segredo aleatório antes de produção.'
    );
  }
  if (secret.length >= 32) return secret;

  if (isProduction) {
    throw new Error(
      'JWT_SECRET é obrigatório e deve ter pelo menos 32 caracteres em produção.'
    );
  }

  if (!secret) {
    throw new Error(
      'JWT_SECRET não configurado. Defina um segredo com pelo menos 32 caracteres no .env.'
    );
  }

  console.warn(
    '[security] JWT_SECRET tem menos de 32 caracteres. Gere um segredo mais forte antes de produção.'
  );
  return secret;
}

function readDemoAdminPassword(seedDemo: boolean): string {
  const configured = process.env.DEMO_ADMIN_PASSWORD?.trim() ?? '';
  if (!isProduction) return configured || 'admin123';

  if (seedDemo && (!configured || configured.length < 12 || looksLikePlaceholderSecret(configured))) {
    throw new Error(
      'SEED_DEMO=true em produção exige DEMO_ADMIN_PASSWORD forte (12+ caracteres, sem valores de exemplo).'
    );
  }

  return configured;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function readOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const seedDemo = readBoolean('SEED_DEMO', !isProduction);

type SameSite = 'lax' | 'strict' | 'none';

function readSameSite(): SameSite {
  const value = (process.env.COOKIE_SAMESITE ?? 'lax').trim().toLowerCase();
  if (value === 'lax' || value === 'strict' || value === 'none') return value;
  throw new Error('COOKIE_SAMESITE deve ser lax, strict ou none.');
}

const cookieSameSite = readSameSite();
const cookieSecure = readBoolean('COOKIE_SECURE', isProduction);

if (cookieSameSite === 'none' && !cookieSecure) {
  throw new Error('COOKIE_SAMESITE=none exige COOKIE_SECURE=true (cookies SameSite=None precisam de Secure).');
}

function readSessionCookieMaxAgeMs(): number {
  const fallback = 7 * 24 * 60 * 60 * 1000;
  const parsed = Number(process.env.SESSION_COOKIE_MAX_AGE_MS ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export const config = {
  nodeEnv,
  isProduction,
  jwtSecret: readJwtSecret(),
  jwtIssuer: 'c4arch',
  jwtExpiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as SignOptions['expiresIn'],
  corsOrigins: readOrigins(),
  /** Sessão em cookie HttpOnly (o Bearer continua aceito para clientes de API). */
  sessionCookieName: process.env.SESSION_COOKIE_NAME?.trim() || 'c4arch_session',
  cookieSecure,
  cookieSameSite,
  cookieDomain: process.env.COOKIE_DOMAIN?.trim() || undefined,
  sessionCookieMaxAgeMs: readSessionCookieMaxAgeMs(),
  allowRegistration: readBoolean('ALLOW_REGISTRATION', !isProduction),
  seedDemo,
  demoAdminPassword: readDemoAdminPassword(seedDemo),
  trustProxy: readBoolean('TRUST_PROXY', false),
  metricsEnabled: readBoolean('METRICS_ENABLED', !isProduction),
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL?.trim() ?? 'http://localhost:4000/api/auth/google/callback',
  frontendUrl: (process.env.FRONTEND_URL ?? process.env.PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  /**
   * Token de serviço usado pelo realtime/worker nas rotas internas de
   * `model_state`. Vazio desabilita o endpoint (fail closed).
   */
  internalToken: process.env.API_TOKEN_REALTIME?.trim() ?? '',
};
