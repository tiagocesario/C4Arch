import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_MODES,
  buildHashRoute,
  isAppMode,
  parseHashRoute,
} from '../src/router.ts';

test('parseHashRoute reconhece deep link de modelo', () => {
  assert.deepEqual(parseHashRoute('#/models/abc-123'), {
    mode: 'edit',
    modelId: 'abc-123',
  });
  assert.deepEqual(parseHashRoute('#/model/abc-123'), {
    mode: 'edit',
    modelId: 'abc-123',
  });
});

test('parseHashRoute decodifica ids e cai em files para hash vazio', () => {
  assert.deepEqual(parseHashRoute('#/models/a%20b'), {
    mode: 'edit',
    modelId: 'a b',
  });
  assert.deepEqual(parseHashRoute(''), { mode: 'files', modelId: null });
  assert.deepEqual(parseHashRoute('#/'), { mode: 'files', modelId: null });
});

test('parseHashRoute aceita todas as telas conhecidas', () => {
  for (const mode of APP_MODES) {
    assert.deepEqual(parseHashRoute(`#/${mode}`), { mode, modelId: null });
  }
  assert.deepEqual(parseHashRoute('#/desconhecida'), {
    mode: 'files',
    modelId: null,
  });
});

test('buildHashRoute faz round-trip com parseHashRoute', () => {
  for (const mode of APP_MODES) {
    const hash = buildHashRoute(mode, mode === 'edit' ? 'm1' : null);
    assert.equal(parseHashRoute(hash).mode, mode);
  }
  assert.equal(buildHashRoute('edit', 'm1'), '#/models/m1');
});

test('isAppMode valida apenas modos registrados', () => {
  assert.equal(isAppMode('edit'), true);
  assert.equal(isAppMode('files'), true);
  assert.equal(isAppMode('nope'), false);
});
