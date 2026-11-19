import type { CookieOptions, Request, Response } from 'express';
import { config } from '../config.js';

/**
 * Sessão em cookie `HttpOnly`.
 *
 * O JWT de sessão deixa de ficar em `localStorage`/URL (onde um XSS ou um log
 * de proxy o exporia) e passa a viajar em cookie inacessível ao JavaScript.
 * O modo Bearer continua aceito para clientes de API/MCP.
 */

const OAUTH_STATE_COOKIE = 'c4arch_oauth_state';
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    domain: config.cookieDomain,
    path: '/',
  };
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(config.sessionCookieName, token, {
    ...baseOptions(),
    maxAge: config.sessionCookieMaxAgeMs,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.sessionCookieName, baseOptions());
}

export function readSessionCookie(req: Request): string | null {
  return readCookie(req, config.sessionCookieName);
}

export function hasSessionCookie(req: Request): boolean {
  return readSessionCookie(req) !== null;
}

export function setOauthStateCookie(res: Response, state: string): void {
  res.cookie(OAUTH_STATE_COOKIE, state, {
    ...baseOptions(),
    path: '/api/auth/google',
    maxAge: OAUTH_STATE_MAX_AGE_MS,
  });
}

export function readOauthStateCookie(req: Request): string | null {
  return readCookie(req, OAUTH_STATE_COOKIE);
}

export function clearOauthStateCookie(res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE, {
    ...baseOptions(),
    path: '/api/auth/google',
  });
}
