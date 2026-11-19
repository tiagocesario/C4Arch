import type { NextFunction, Request, Response } from 'express';
import { verifyDrawioToken, verifySessionToken } from './tokens.js';
import { readSessionCookie } from './session-cookie.js';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; role: string };
  /** Como o chamador se autenticou; usado pelo guard de CSRF. */
  authSource?: 'bearer' | 'cookie';
}

function unauthorized(res: Response) {
  return res.status(401).json({ error: 'Token de acesso não fornecido' });
}

function forbidden(res: Response) {
  return res.status(403).json({ error: 'Token inválido ou expirado' });
}

export function verifyToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  let token: string | null = null;
  let source: 'bearer' | 'cookie' = 'bearer';

  if (header && header.startsWith('Bearer ')) {
    token = header.slice('Bearer '.length).trim();
  } else {
    token = readSessionCookie(req);
    source = 'cookie';
  }

  if (!token) return unauthorized(res);

  const user = verifySessionToken(token);
  if (!user) return forbidden(res);

  req.user = user;
  req.authSource = source;
  return next();
}

/**
 * Aceita o token de sessão via header/cookie (uso interno/API) ou o token
 * escopado de 5 minutos na query string (abertura do editor no navegador).
 */
export function verifyDrawioAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (header) return verifyToken(req, res, next);

  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  if (!queryToken) return unauthorized(res);

  const modelId = typeof req.params.id === 'string' ? req.params.id : '';
  const user = verifyDrawioToken(queryToken, modelId);
  if (!user) return forbidden(res);

  req.user = user;
  return next();
}
