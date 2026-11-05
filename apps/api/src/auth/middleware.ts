import type { NextFunction, Request, Response } from 'express';
import { verifyDrawioToken, verifySessionToken } from './tokens.js';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; role: string };
}

function unauthorized(res: Response) {
  return res.status(401).json({ error: 'Token de acesso não fornecido' });
}

function forbidden(res: Response) {
  return res.status(403).json({ error: 'Token inválido ou expirado' });
}

export function verifyToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return unauthorized(res);
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) return unauthorized(res);

  const user = verifySessionToken(token);
  if (!user) return forbidden(res);

  req.user = user;
  return next();
}

/**
 * Aceita o token de sessão via header (uso interno/API) ou o token escopado
 * de 5 minutos na query string (abertura do editor no navegador).
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
