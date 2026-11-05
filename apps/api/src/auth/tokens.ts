import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface TokenUser {
  id: string;
  email: string;
  role: string;
}

export function signSessionToken(user: { id: string; email: string; role?: string }): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role ?? 'user' },
    config.jwtSecret,
    {
      algorithm: 'HS256',
      expiresIn: config.jwtExpiresIn,
      issuer: config.jwtIssuer,
    }
  );
}

export function verifySessionToken(token: string): TokenUser | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: config.jwtIssuer,
    }) as jwt.JwtPayload;

    if (typeof decoded.id !== 'string') return null;

    return {
      id: decoded.id,
      email: typeof decoded.email === 'string' ? decoded.email : '',
      role: typeof decoded.role === 'string' ? decoded.role : 'user',
    };
  } catch {
    return null;
  }
}

/**
 * Token de curta duração e escopo restrito para abrir o editor draw.io.
 * Evita colocar o JWT de sessão (7 dias) na query string / histórico do browser.
 */
export function signDrawioToken(userId: string, email: string, modelId: string): string {
  return jwt.sign(
    { id: userId, email, purpose: 'drawio', modelId },
    config.jwtSecret,
    {
      algorithm: 'HS256',
      expiresIn: '5m',
      issuer: config.jwtIssuer,
      audience: 'c4arch-drawio',
    }
  );
}

export function verifyDrawioToken(token: string, modelId: string): TokenUser | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: config.jwtIssuer,
      audience: 'c4arch-drawio',
    }) as jwt.JwtPayload;

    if (
      decoded.purpose !== 'drawio' ||
      decoded.modelId !== modelId ||
      typeof decoded.id !== 'string'
    ) {
      return null;
    }

    return {
      id: decoded.id,
      email: typeof decoded.email === 'string' ? decoded.email : '',
      role: 'editor',
    };
  } catch {
    return null;
  }
}
