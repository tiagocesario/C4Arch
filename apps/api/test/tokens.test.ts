import test from 'node:test';
import assert from 'node:assert/strict';

// config.ts valida o segredo no import; define antes do import dinâmico e não
// depende do .env local.
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters-123456';
process.env.NODE_ENV = 'test';

const {
  signDrawioToken,
  signSessionToken,
  signWsTicket,
  verifyDrawioToken,
  verifySessionToken,
  verifyWsTicket,
} = await import('../src/auth/tokens.js');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_MODEL_ID = '33333333-3333-4333-8333-333333333333';

test('token de sessão é aceito por verifySessionToken', () => {
  const token = signSessionToken({ id: USER_ID, email: 'user@example.com', role: 'editor' });
  const user = verifySessionToken(token);
  assert.equal(user?.id, USER_ID);
  assert.equal(user?.email, 'user@example.com');
  assert.equal(user?.role, 'editor');
});

test('token do draw.io não é aceito como token de sessão', () => {
  const token = signDrawioToken(USER_ID, 'user@example.com', MODEL_ID);
  assert.equal(verifySessionToken(token), null);
});

test('token do draw.io é aceito apenas para o modelo correto', () => {
  const token = signDrawioToken(USER_ID, 'user@example.com', MODEL_ID);
  assert.equal(verifyDrawioToken(token, MODEL_ID)?.id, USER_ID);
  assert.equal(verifyDrawioToken(token, OTHER_MODEL_ID), null);
});

test('token de sessão não é aceito como token do draw.io', () => {
  const token = signSessionToken({ id: USER_ID, email: 'user@example.com' });
  assert.equal(verifyDrawioToken(token, MODEL_ID), null);
});

test('token do draw.io expirado é rejeitado', () => {
  const token = signDrawioToken(USER_ID, 'user@example.com', MODEL_ID, '-1s');
  assert.equal(verifyDrawioToken(token, MODEL_ID), null);
});

test('token adulterado é rejeitado', () => {
  const token = signSessionToken({ id: USER_ID, email: 'user@example.com' });
  const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
  assert.equal(verifySessionToken(tampered), null);
});

test('ticket do WebSocket tem propósito próprio e jti', () => {
  const ticket = signWsTicket(USER_ID);
  const claims = verifyWsTicket(ticket);
  assert.equal(claims?.userId, USER_ID);
  assert.ok(claims && claims.jti.length >= 16);
});

test('ticket do WebSocket não é aceito como sessão nem como draw.io', () => {
  const ticket = signWsTicket(USER_ID);
  assert.equal(verifySessionToken(ticket), null);
  assert.equal(verifyDrawioToken(ticket, MODEL_ID), null);
});

test('sessão não é aceita como ticket do WebSocket', () => {
  const token = signSessionToken({ id: USER_ID, email: 'user@example.com' });
  assert.equal(verifyWsTicket(token), null);
});

test('ticket do WebSocket expirado é rejeitado', () => {
  const ticket = signWsTicket(USER_ID, '-1s');
  assert.equal(verifyWsTicket(ticket), null);
});
