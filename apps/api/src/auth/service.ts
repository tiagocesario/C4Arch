import crypto from 'crypto';
import { pool } from '../db.js';
import { signSessionToken } from './tokens.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 1024;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateCredentials(email: string, password: string) {
  if (!EMAIL_RE.test(email) || email.length > 320) {
    throw new Error('Email inválido');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Senha muito longa');
  }
}

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString('hex'));
    });
  });
}

// Hash descartável para manter o custo do login parecido quando o usuário
// não existe (reduz enumeração por diferença de tempo).
const DUMMY_SALT = 'f'.repeat(32);

export class AuthService {
  static async register(email: string, name: string, password: string) {
    const normalizedEmail = normalizeEmail(email);
    const cleanName = typeof name === 'string' ? name.trim() : '';

    validateCredentials(normalizedEmail, password);
    if (!cleanName || cleanName.length > 120) {
      throw new Error('Nome inválido');
    }

    const existing = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [
      normalizedEmail,
    ]);
    if (existing.rows.length > 0) {
      throw new Error('Email já cadastrado');
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = `${salt}${await hashPassword(password, salt)}`;

    try {
      const result = await pool.query(
        `INSERT INTO users (email, name, password_hash)
         VALUES ($1, $2, $3) RETURNING id, email, name`,
        [normalizedEmail, cleanName, passwordHash]
      );
      return result.rows[0];
    } catch (err) {
      // Corrida entre a checagem acima e o INSERT: o índice único decide.
      if ((err as { code?: string }).code === '23505') {
        throw new Error('Email já cadastrado');
      }
      throw err;
    }
  }

  static async login(email: string, password: string) {
    // Evita KDF com entradas arbitrariamente grandes antes de consultar o banco.
    if (email.length > 320 || password.length > MAX_PASSWORD_LENGTH) {
      throw new Error('Email ou senha inválidos');
    }

    const normalizedEmail = normalizeEmail(email);
    const result = await pool.query(
      `SELECT id, email, name, password_hash FROM users WHERE lower(email) = $1`,
      [normalizedEmail]
    );
    const user = result.rows[0];

    if (!user) {
      // Executa o mesmo custo de KDF de um login real.
      await hashPassword(password, DUMMY_SALT);
      throw new Error('Email ou senha inválidos');
    }

    const passwordHash = user.password_hash as string;
    const salt = passwordHash.slice(0, 32);
    const expected = passwordHash.slice(32);
    const actual = await hashPassword(password, salt);

    const actualBuffer = Buffer.from(actual, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const matches =
      actualBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(actualBuffer, expectedBuffer);

    if (!matches) {
      throw new Error('Email ou senha inválidos');
    }

    const token = signSessionToken({
      id: user.id,
      email: user.email,
      role: 'editor',
    });

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name },
    };
  }
}
