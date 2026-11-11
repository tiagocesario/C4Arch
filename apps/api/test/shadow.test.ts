import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonicalSnapshot, type BuildSnapshotInput } from '../src/c4/backfill.js';
import { compareSnapshots, formatShadowSummary } from '../src/c4/shadow.js';
import { makeSnapshotInput } from './fixtures/m2.js';

function snapshots(): {
  expected: ReturnType<typeof buildCanonicalSnapshot>;
  actual: ReturnType<typeof buildCanonicalSnapshot>;
} {
  const expected = buildCanonicalSnapshot(makeSnapshotInput());
  const actual = structuredClone(expected);
  return { expected, actual };
}

test('comparação em sombra não aponta divergências quando o canônico reflete o legado', () => {
  const { expected, actual } = snapshots();
  assert.deepEqual(compareSnapshots(expected, actual), []);
});

test('comparação detecta divergências de elementos', () => {
  const { expected, actual } = snapshots();
  actual.elements[0].name = 'Nome divergente';
  actual.elements[1].kind = 'container';
  actual.elements.pop();

  const kinds = compareSnapshots(expected, actual).map((divergence) => divergence.kind);
  assert.ok(kinds.includes('ELEMENT_FIELD'));
  assert.ok(kinds.includes('ELEMENT_MISSING'));
});

test('comparação detecta divergências de relações, views e layout', () => {
  const { expected, actual } = snapshots();
  actual.relationships.pop();
  actual.views[0].type = 'filtered';
  actual.layout[0].x = (actual.layout[0].x ?? 0) + 5;

  const kinds = compareSnapshots(expected, actual).map((divergence) => divergence.kind);
  assert.ok(kinds.includes('RELATIONSHIP_MISSING'));
  assert.ok(kinds.includes('VIEW_FIELD'));
  assert.ok(kinds.includes('LAYOUT_FIELD'));
});

test('comparação detecta divergências de overrides e versões', () => {
  const { expected, actual } = snapshots();
  actual.overrides[0].content = 'conteúdo divergente';
  actual.versions[0].content_hash = 'sha256:outro';

  const divergences = compareSnapshots(expected, actual);
  assert.ok(divergences.some((divergence) => divergence.kind === 'OVERRIDE_FIELD'));
  assert.ok(
    divergences.some(
      (divergence) => divergence.kind === 'VERSION_FIELD' && divergence.field === 'content_hash'
    )
  );
});

test('comparação detecta entidades extras no canônico', () => {
  const { expected, actual } = snapshots();
  actual.elements.push({
    ...actual.elements[0],
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    identifier: 'extra',
  });
  actual.views.push({
    ...actual.views[0],
    key: 'extra',
  });
  actual.overrides.push({ section_key: 'custom:x', content: 'x', mode: 'append' });
  actual.versions.push({
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    version: 99,
    content_hash: null,
    author_id: null,
    duplicate: true,
  });

  const kinds = compareSnapshots(expected, actual).map((divergence) => divergence.kind);
  assert.ok(kinds.includes('ELEMENT_EXTRA'));
  assert.ok(kinds.includes('VIEW_EXTRA'));
  assert.ok(kinds.includes('OVERRIDE_EXTRA'));
  assert.ok(kinds.includes('VERSION_EXTRA'));
});

test('resumo da sombra informa contagem por tipo de divergência', () => {
  const { expected, actual } = snapshots();
  actual.elements[0].name = 'Outro';
  const divergences = compareSnapshots(expected, actual);

  const report = {
    modelId: expected.modelId,
    checkedAt: new Date(0).toISOString(),
    ok: false,
    expected: expected.stats,
    actual: actual.stats,
    divergences,
  };

  const summary = formatShadowSummary(report);
  assert.match(summary, /1 divergência/);
  assert.match(summary, /ELEMENT_FIELD=1/);
});

test('fixture de entrada aceita variações sem quebrar o tipo', () => {
  const input: BuildSnapshotInput = makeSnapshotInput();
  assert.equal(input.model.id, input.elements[0].model_id);
});
