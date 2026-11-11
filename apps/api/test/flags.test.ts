import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlagMode, readFlags } from '../src/flags.js';

test('parseFlagMode aceita off, shadow e on sem diferenciar maiúsculas', () => {
  assert.equal(parseFlagMode('TEST', 'off'), 'off');
  assert.equal(parseFlagMode('TEST', 'shadow'), 'shadow');
  assert.equal(parseFlagMode('TEST', 'ON'), 'on');
  assert.equal(parseFlagMode('TEST', '  Shadow  '), 'shadow');
});

test('parseFlagMode usa o fallback quando o valor está vazio ou é inválido', () => {
  assert.equal(parseFlagMode('TEST', undefined, 'shadow'), 'shadow');
  assert.equal(parseFlagMode('TEST', '', 'on'), 'on');
  assert.equal(parseFlagMode('TEST', 'ligado', 'off'), 'off');
});

test('readFlags começa com todas as flags em off', () => {
  assert.deepEqual(readFlags({}), {
    canonicalModel: 'off',
    canonicalViews: 'off',
    dasOverrides: 'off',
    versionHash: 'off',
    realtimePgState: 'off',
    projectorShadow: 'off',
  });
});

test('readFlags lê cada variável de ambiente', () => {
  assert.deepEqual(
    readFlags({
      CANONICAL_MODEL: 'shadow',
      CANONICAL_VIEWS: 'on',
      DAS_OVERRIDES: 'on',
      VERSION_HASH: 'on',
      REALTIME_PG_STATE: 'shadow',
      PROJECTOR_SHADOW: 'on',
    }),
    {
      canonicalModel: 'shadow',
      canonicalViews: 'on',
      dasOverrides: 'on',
      versionHash: 'on',
      realtimePgState: 'shadow',
      projectorShadow: 'on',
    }
  );
});
