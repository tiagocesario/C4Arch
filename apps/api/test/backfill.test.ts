import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonicalSnapshot } from '../src/c4/backfill.js';
import {
  ACTOR_ID,
  COMPONENT_ID,
  CONTAINER_ID,
  SYSTEM_ID,
  makeSnapshotInput,
} from './fixtures/m2.js';

test('backfill monta elementos, relações, views e layout a partir do legado', () => {
  const snapshot = buildCanonicalSnapshot(makeSnapshotInput());

  assert.equal(snapshot.stats.elements, 4);
  assert.equal(snapshot.stats.relationships, 1);
  assert.equal(snapshot.stats.views, 2);
  assert.equal(snapshot.stats.skippedRelationships, 1);

  const byId = new Map(snapshot.elements.map((element) => [element.id, element]));
  assert.equal(byId.get(ACTOR_ID)?.kind, 'person');
  assert.equal(byId.get(SYSTEM_ID)?.kind, 'software_system');
  assert.equal(byId.get(CONTAINER_ID)?.kind, 'container');
  assert.equal(byId.get(COMPONENT_ID)?.kind, 'component');
  assert.equal(byId.get(CONTAINER_ID)?.technology, 'Node.js');
  assert.equal(byId.get(CONTAINER_ID)?.url, 'https://api.example.com');
  assert.deepEqual(byId.get(SYSTEM_ID)?.tags, ['core']);

  assert.equal(snapshot.relationships[0].technology, 'HTTPS');
  assert.deepEqual(snapshot.relationships[0].properties, { legacyType: 'call' });

  assert.deepEqual(
    snapshot.views.map((view) => [view.key, view.type]),
    [
      ['container', 'container'],
      ['component', 'component'],
    ]
  );
  assert.equal(snapshot.views[0].scope_element_id, SYSTEM_ID);
  assert.equal(snapshot.views[1].scope_element_id, null);

  assert.ok(snapshot.warnings.some((warning) => warning.code === 'RELATIONSHIP_SELF'));
  assert.ok(snapshot.warnings.some((warning) => warning.code === 'SCOPE_KIND_MISMATCH'));
});

test('backfill infere hierarquia por contenção no XML', () => {
  const snapshot = buildCanonicalSnapshot(makeSnapshotInput());
  const byId = new Map(snapshot.elements.map((element) => [element.id, element]));

  assert.equal(byId.get(CONTAINER_ID)?.parent_element_id, SYSTEM_ID);
  assert.equal(byId.get(COMPONENT_ID)?.parent_element_id, CONTAINER_ID);
  assert.equal(byId.get(ACTOR_ID)?.parent_element_id, null);
});

test('backfill extrai layout da view primária e da view extra', () => {
  const snapshot = buildCanonicalSnapshot(makeSnapshotInput());
  const primary = snapshot.layout.filter((row) => row.viewKey === 'container');
  const extra = snapshot.layout.filter((row) => row.viewKey === 'component');

  assert.equal(primary.length, 4);
  assert.equal(extra.length, 1);

  const api = primary.find((row) => row.element_id === CONTAINER_ID);
  assert.ok(api);
  assert.equal(api.x, 150);
  assert.equal(api.y, 150);
  assert.equal(api.width, 200);
  assert.equal(api.height, 100);

  const actor = primary.find((row) => row.element_id === ACTOR_ID);
  assert.ok(actor);
  assert.equal(actor.x, 10);
  assert.equal(actor.y, 20);
  assert.deepEqual(actor.style, { source: 'legacy' });

  assert.equal(extra[0].element_id, COMPONENT_ID);
  assert.equal(extra[0].x, 30);
});

test('backfill converte apenas a seção editada do DAS em override', () => {
  const snapshot = buildCanonicalSnapshot(makeSnapshotInput());
  assert.equal(snapshot.stats.overrides, 1);
  assert.deepEqual(
    snapshot.overrides.map((override) => override.section_key),
    ['6.1']
  );
  assert.match(snapshot.overrides[0].content ?? '', /editada manualmente/);
});

test('backfill calcula hash das versões e marca duplicatas', () => {
  const snapshot = buildCanonicalSnapshot(makeSnapshotInput());
  assert.equal(snapshot.stats.versions, 3);
  assert.equal(snapshot.stats.duplicateVersions, 1);

  const versions = new Map(snapshot.versions.map((version) => [version.version, version]));
  assert.match(versions.get(1)?.content_hash ?? '', /^sha256:/);
  assert.equal(versions.get(2)?.content_hash, null);
  assert.equal(versions.get(2)?.duplicate, true);
  assert.match(versions.get(3)?.content_hash ?? '', /^sha256:/);
  assert.notEqual(versions.get(1)?.content_hash, versions.get(3)?.content_hash);
});

test('backfill é determinístico para a mesma entrada', () => {
  const first = buildCanonicalSnapshot(makeSnapshotInput());
  const second = buildCanonicalSnapshot(makeSnapshotInput());
  assert.deepEqual(first, second);
});

test('backfill respeita hashes já existentes no banco', () => {
  const input = makeSnapshotInput();
  const first = buildCanonicalSnapshot(input);
  const existingHash = first.versions[0].content_hash;
  assert.ok(existingHash);

  const second = buildCanonicalSnapshot({
    ...input,
    existingVersionHashes: [existingHash],
    versions: input.versions?.map((version) => ({ ...version, content_hash: null })),
  });
  assert.equal(second.versions[0].content_hash, null);
  assert.equal(second.versions[0].duplicate, true);
});
