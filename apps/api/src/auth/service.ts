import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

export class AuthService {
  static async register(email: string, name: string, password: string) {
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    if (existing.rows.length > 0) {
      throw new Error('Email já cadastrado');
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hashed = crypto.scryptSync(password, salt, 64).toString('hex');
    const passwordHash = `${salt}${hashed}`;

    const result = await pool.query(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, $2, $3) RETURNING id, email, name`,
      [email, name, passwordHash]
    );
    return result.rows[0];
  }

  static async login(email: string, password: string) {
    const result = await pool.query(
      `SELECT id, email, name, password_hash FROM users WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      throw new Error('Email ou senha inválidos');
    }
    const passwordHash = user.password_hash as string;
    const salt = passwordHash.slice(0, 32);
    const expected = passwordHash.slice(32);
    const actual = crypto.scryptSync(password, salt, 64).toString('hex');
    if (actual !== expected) {
      throw new Error('Email ou senha inválidos');
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, role: 'editor' },
      process.env.JWT_SECRET ?? '',
      { expiresIn: '7d' }
    );
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name },
    };
  }
}
