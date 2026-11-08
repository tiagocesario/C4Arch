import test from 'node:test';
import assert from 'node:assert/strict';
import { isOwnerRole, isValidUuid, isWriterRole } from '../src/auth/access.js';

test('isValidUuid aceita apenas UUIDs canônicos', () => {
  assert.equal(isValidUuid('11111111-1111-4111-8111-111111111111'), true);
  assert.equal(isValidUuid('11111111-1111-4111-8111-11111111111Z'), false);
  assert.equal(isValidUuid('1-1-1-1-1'), false);
  assert.equal(isValidUuid(''), false);
  assert.equal(isValidUuid(null), false);
  assert.equal(isValidUuid(42), false);
});

test('isWriterRole permite owner/editor e bloqueia viewer', () => {
  assert.equal(isWriterRole('owner'), true);
  assert.equal(isWriterRole('editor'), true);
  assert.equal(isWriterRole('viewer'), false);
  assert.equal(isWriterRole(null), false);
});

test('isOwnerRole é exclusivo do owner (gestão de grupos)', () => {
  assert.equal(isOwnerRole('owner'), true);
  assert.equal(isOwnerRole('editor'), false);
  assert.equal(isOwnerRole('viewer'), false);
  assert.equal(isOwnerRole(undefined), false);
});
