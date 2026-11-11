import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db.js';
import { runMigrations } from '../src/db/migrate.js';
import { backfillModel } from '../src/c4/backfill.js';
import { generateCanonicalDas, saveDasOverrides } from '../src/c4/das-canonical.js';
import { projectModel } from '../src/c4/projector.js';
import { computeStateContentHash, encodeModelState } from '../src/c4/state.js';
import { restoreVersion } from '../src/c4/versions.js';

const enabled = process.env.RUN_M3_TESTS === 'true';

after(async () => {
  await pool.end();
});

function decodedFixture(modelId: string, title = 'Sistema X') {
  const actorId = randomUUID();
  const systemId = randomUUID();
  const containerId = randomUUID();
  const edgeId = randomUUID();

  return {
    actorId,
    systemId,
    containerId,
    edgeId,
    decoded: {
      elements: [
        {
          id: actorId,
          type: 'actor',
          title: 'Usuário',
          description: null,
          metadata: null,
          position_x: 10,
          position_y: 20,
          order: 0,
        },
        {
          id: systemId,
          type: 'system',
          title,
          description: 'Sistema principal',
          metadata: { technology: 'Legado' },
          position_x: 100,
          position_y: 100,
          order: 1,
        },
        {
          id: containerId,
          type: 'container',
          title: 'API',
          description: 'API REST',
          metadata: { technology: 'Node.js' },
          position_x: 150,
          position_y: 150,
          order: 2,
        },
      ],
      edges: [
        {
          id: edgeId,
          from_id: actorId,
          to_id: systemId,
          label: 'Usa [HTTPS]',
          type: 'call',
        },
      ],
    },
  };
}

test(
  'M3: estado durável, projetor, DAS canônico e restore',
  { skip: enabled ? false : 'defina RUN_M3_TESTS=true e um Postgres descartável' },
  async () => {
    await runMigrations();

    const orgId = randomUUID();
    const modelId = randomUUID();
    const fixture = decodedFixture(modelId);

    const client = await pool.connect();
    try {
      await client.query(
        'INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)',
        [orgId, `m3-${orgId}`, 'Organização M3']
      );
      await client.query(
        `INSERT INTO models (id, org_id, title, description, status, c4_type)
         VALUES ($1, $2, 'Modelo M3', 'Fixture M3', 'draft', 'container')`,
        [modelId, orgId]
      );

      for (const element of fixture.decoded.elements) {
        await client.query(
          `INSERT INTO elements
             (id, model_id, type, title, description, metadata, position_x, position_y, "order")
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
          [
            element.id,
            modelId,
            element.type,
            element.title,
            element.description,
            element.metadata ? JSON.stringify(element.metadata) : null,
            element.position_x,
            element.position_y,
            element.order,
          ]
        );
      }
      for (const edge of fixture.decoded.edges) {
        await client.query(
          `INSERT INTO edges (id, model_id, from_id, to_id, label, type)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [edge.id, modelId, edge.from_id, edge.to_id, edge.label, edge.type]
        );
      }
    } finally {
      client.release();
    }

    try {
      await backfillModel(modelId);

      const state = encodeModelState(fixture.decoded);
      await pool.query(
        `INSERT INTO model_state (model_id, state, state_vector, content_hash, revision)
         VALUES ($1, $2, NULL, $3, 1)`,
        [modelId, Buffer.from(state), computeStateContentHash(fixture.decoded)]
      );

      // 1. Projetor em sombra: estado Yjs e canônico batem após o backfill.
      const shadow = await projectModel(modelId, { mode: 'shadow' });
      assert.equal(shadow.ok, true, JSON.stringify(shadow.divergences, null, 2));
      assert.equal(shadow.skipped, false);

      // 2. Divergência detectada sem escrever.
      await pool.query(
        `UPDATE model_elements SET name = 'Nome divergente' WHERE model_id = $1 AND id = $2`,
        [modelId, fixture.systemId]
      );
      const divergent = await projectModel(modelId, { mode: 'shadow' });
      assert.equal(divergent.ok, false);
      assert.ok(divergent.divergences.length > 0);

      // 3. Projetor em `on` aplica o estado e volta a convergir.
      const applied = await projectModel(modelId, { mode: 'on' });
      assert.equal(applied.applied, true);
      assert.equal(applied.ok, true, JSON.stringify(applied.divergences, null, 2));

      const name = await pool.query<{ name: string }>(
        'SELECT name FROM model_elements WHERE id = $1',
        [fixture.systemId]
      );
      assert.equal(name.rows[0].name, 'Sistema X');

      // 4. DAS canônico usa os elementos canônicos e grava overrides por seção.
      const das = await generateCanonicalDas(modelId);
      assert.ok(das);
      assert.match(das.content, /Sistema X/);
      assert.match(das.content, /Usa \[HTTPS\]/);

      const edited = das.generated.replace(
        '### 6.1 Elementos\n\n',
        '### 6.1 Elementos\n\nEditado manualmente no M3.\n\n'
      );
      const saved = await saveDasOverrides(modelId, edited, null);
      assert.ok(saved);
      assert.deepEqual(saved.changedKeys, ['6.1']);

      const overrides = await pool.query<{ section_key: string }>(
        'SELECT section_key FROM model_das_overrides WHERE model_id = $1',
        [modelId]
      );
      assert.deepEqual(overrides.rows.map((row) => row.section_key), ['6.1']);

      // 5. Restore volta o snapshot lógico, o legado e grava versão `restore`.
      const restoredFixture = decodedFixture(modelId, 'Sistema restaurado');
      const version = await pool.query<{ id: string }>(
        `INSERT INTO model_versions (model_id, version, snapshot, kind)
         VALUES ($1, 1, $2::jsonb, 'manual')
         RETURNING id`,
        [
          modelId,
          JSON.stringify({
            modelId,
            elements: restoredFixture.decoded.elements,
            edges: restoredFixture.decoded.edges,
          }),
        ]
      );

      const restored = await restoreVersion(modelId, version.rows[0].id, null);
      assert.ok(restored);

      const legacy = await pool.query<{ title: string }>(
        'SELECT title FROM elements WHERE id = $1',
        [restoredFixture.systemId]
      );
      assert.equal(legacy.rows[0].title, 'Sistema restaurado');

      const stateRow = await pool.query<{ content_hash: string; revision: string }>(
        'SELECT content_hash, revision FROM model_state WHERE model_id = $1',
        [modelId]
      );
      assert.equal(stateRow.rows[0].content_hash, restored!.contentHash);
      assert.equal(Number(stateRow.rows[0].revision), 2);

      const restoreVersionRow = await pool.query<{ kind: string }>(
        'SELECT kind FROM model_versions WHERE id = $1',
        [restored!.versionId]
      );
      assert.equal(restoreVersionRow.rows[0].kind, 'restore');
    } finally {
      await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    }
  }
);
