import dotenv from 'dotenv';
import type { SignOptions } from 'jsonwebtoken';

dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

function readJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim() ?? '';
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

export const config = {
  nodeEnv,
  isProduction,
  jwtSecret: readJwtSecret(),
  jwtIssuer: 'c4arch',
  jwtExpiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as SignOptions['expiresIn'],
  corsOrigins: readOrigins(),
  allowRegistration: readBoolean('ALLOW_REGISTRATION', !isProduction),
  seedDemo: readBoolean('SEED_DEMO', !isProduction),
  demoAdminPassword: process.env.DEMO_ADMIN_PASSWORD ?? 'admin123',
  trustProxy: readBoolean('TRUST_PROXY', false),
};
