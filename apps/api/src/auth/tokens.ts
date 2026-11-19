import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
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

    // Tokens escopados do draw.io têm `purpose`/`aud` próprios e não podem ser
    // reutilizados como token de sessão em outras rotas da API.
    if (decoded.purpose !== undefined || decoded.aud !== undefined) return null;

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
export function signDrawioToken(
  userId: string,
  email: string,
  modelId: string,
  expiresIn: SignOptions['expiresIn'] = '5m'
): string {
  return jwt.sign(
    { id: userId, email, purpose: 'drawio', modelId },
    config.jwtSecret,
    {
      algorithm: 'HS256',
      expiresIn,
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

export interface WsTicket {
  userId: string;
  jti: string;
}

/**
 * Ticket efêmero (30 s) para abrir o WebSocket.
 *
 * O cliente troca o ticket por um token de sessão no servidor realtime; assim
 * o JWT de sessão nunca aparece na query string/logs do handshake. O `jti`
 * permite uso único do ticket no endpoint de troca.
 */
export function signWsTicket(userId: string, expiresIn: SignOptions['expiresIn'] = '30s'): string {
  return jwt.sign(
    { id: userId, purpose: 'ws', jti: randomUUID() },
    config.jwtSecret,
    {
      algorithm: 'HS256',
      expiresIn,
      issuer: config.jwtIssuer,
      audience: 'c4arch-ws',
    }
  );
}

export function verifyWsTicket(token: string): WsTicket | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: config.jwtIssuer,
      audience: 'c4arch-ws',
    }) as jwt.JwtPayload;

    if (
      decoded.purpose !== 'ws' ||
      typeof decoded.id !== 'string' ||
      typeof decoded.jti !== 'string'
    ) {
      return null;
    }

    return { userId: decoded.id, jti: decoded.jti };
  } catch {
    return null;
  }
}
