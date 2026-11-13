import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Contexto HTTP mínimo para observabilidade (Onda 3, item 17): todo request
 * recebe um `X-Request-Id` propagável e reutilizado nos logs/auditoria.
 */
export interface RequestWithId extends Request {
  requestId?: string;
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const requestId =
    typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
      ? incoming
      : randomUUID();
  (req as RequestWithId).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
