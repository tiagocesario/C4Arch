import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';

process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters-123456';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_SAMESITE = 'lax';

const { clearSessionCookie, hasSessionCookie, readCookie, readSessionCookie, setSessionCookie } =
  await import('../src/auth/session-cookie.js');
const { signSessionToken } = await import('../src/auth/tokens.js');
const { verifyToken } = await import('../src/auth/middleware.js');
const { config } = await import('../src/config.js');

function fakeRequest(cookie?: string): Request {
  return { headers: cookie === undefined ? {} : { cookie } } as unknown as Request;
}

test('readCookie lê o valor certo entre vários cookies', () => {
  const req = fakeRequest('other=1; c4arch_session=abc123; theme=dark');
  assert.equal(readCookie(req, 'c4arch_session'), 'abc123');
  assert.equal(readCookie(req, 'theme'), 'dark');
  assert.equal(readCookie(req, 'missing'), null);
  assert.equal(readCookie(fakeRequest()), null);
});

test('readCookie decodifica percent-encoding', () => {
  const req = fakeRequest('c4arch_session=a%20b%3Bc');
  assert.equal(readCookie(req, 'c4arch_session'), 'a b;c');
});

test('readSessionCookie usa o nome configurado', () => {
  const req = fakeRequest(`${config.sessionCookieName}=token-value`);
  assert.equal(readSessionCookie(req), 'token-value');
  assert.equal(hasSessionCookie(req), true);
  assert.equal(hasSessionCookie(fakeRequest('other=1')), false);
});

test('setSessionCookie grava cookie HttpOnly com SameSite', () => {
  const calls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const res = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => {
      calls.push({ name, value, options });
    },
  } as unknown as Response;

  setSessionCookie(res, 'signed-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, config.sessionCookieName);
  assert.equal(calls[0].value, 'signed-token');
  assert.equal(calls[0].options.httpOnly, true);
  assert.equal(calls[0].options.sameSite, config.cookieSameSite);
  assert.equal(calls[0].options.path, '/');
});

test('clearSessionCookie usa os mesmos atributos da sessão', () => {
  const calls: Array<Record<string, unknown>> = [];
  const res = {
    clearCookie: (name: string, options: Record<string, unknown>) => {
      calls.push({ name, ...options });
    },
  } as unknown as Response;

  clearSessionCookie(res);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, config.sessionCookieName);
  assert.equal(calls[0].httpOnly, true);
  assert.equal(calls[0].path, '/');
});

test('verifyToken autentica pelo cookie de sessão', () => {
  const token = signSessionToken({ id: 'user-1', email: 'user@example.com', role: 'editor' });
  const req = fakeRequest(`${config.sessionCookieName}=${encodeURIComponent(token)}`) as Request & {
    user?: { id: string };
    authSource?: string;
  };
  let nextCalled = false;

  verifyToken(req, {} as Response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.user?.id, 'user-1');
  assert.equal(req.authSource, 'cookie');
});

test('verifyToken sem header nem cookie responde 401', () => {
  let statusCode = 0;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;

  let nextCalled = false;
  verifyToken(fakeRequest(), res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 401);
});
