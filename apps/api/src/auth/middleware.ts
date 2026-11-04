import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; role: string };
}

export function verifyToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Token de acesso não fornecido' });
  }
  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token de acesso ausente' });
  }
  try {
    const secret = process.env.JWT_SECRET ?? '';
    const decoded = jwt.verify(token, secret) as {
      id: string;
      email: string;
      role: string;
    };
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role };
    return next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido ou expirado' });
  }
}

export function requireRole(...allowed: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    if (!allowed.includes(req.user.role as string)) {
      return res.status(403).json({ error: 'Permissão insuficiente' });
    }
    return next();
  };
}
