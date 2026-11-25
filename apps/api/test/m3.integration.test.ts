import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { pool } from '../src/db.js';
import { InternalController } from '../src/controllers/internal.controller.js';
import { runMigrations } from '../src/db/migrate.js';
import { backfillModel } from '../src/c4/backfill.js';
import { generateCanonicalDas, saveDasOverrides } from '../src/c4/das-canonical.js';
import { projectModel } from '../src/c4/projector.js';
import { computeStateContentHash, decodeModelState, encodeModelState } from '../src/c4/state.js';
import { importWorkspaceIntoModel, type ImportedWorkspace } from '../src/c4/model-import.js';
import { loadModelGraph } from '../src/c4/model-graph.js';
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

function controllerResponse() {
  const result: { status: number; body: Record<string, unknown> | null } = {
    status: 200,
    body: null,
  };
  const response = {
    status(code: number) {
      result.status = code;
      return response;
    },
    json(body: Record<string, unknown>) {
      result.body = body;
      return response;
    },
  } as unknown as Response;
  return { response, result };
}

function stateRequest(
  modelId: string,
  state: Uint8Array,
  expectedRevision?: number
): Request {
  return {
    params: { id: modelId },
    body: {
      state: Buffer.from(state).toString('base64'),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    },
  } as unknown as Request;
}

test(
  'PUT interno faz CAS por revision e preserva compatibilidade sem expectedRevision',
  { skip: enabled ? false : 'defina RUN_M3_TESTS=true e um Postgres descartável' },
  async () => {
    await runMigrations();

    const orgId = randomUUID();
    const modelId = randomUUID();
    const fixture = decodedFixture(modelId, 'Revisão inicial');
    const initialState = encodeModelState(fixture.decoded);
    const updatedState = encodeModelState({
      ...fixture.decoded,
      elements: fixture.decoded.elements.map((element) =>
        element.id === fixture.systemId ? { ...element, title: 'Revisão atualizada' } : element
      ),
    });

    try {
      await pool.query(
        'INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)',
        [orgId, `m3-cas-${orgId}`, 'Organização CAS']
      );
      await pool.query(
        `INSERT INTO models (id, org_id, title, status, c4_type)
         VALUES ($1, $2, 'Modelo CAS', 'draft', 'container')`,
        [modelId, orgId]
      );
      await pool.query(
        `INSERT INTO model_state (model_id, state, state_vector, content_hash, revision)
         VALUES ($1, $2, NULL, $3, 1)`,
        [modelId, Buffer.from(initialState), computeStateContentHash(fixture.decoded)]
      );

      const invalid = controllerResponse();
      await InternalController.putState(stateRequest(modelId, updatedState, 1.5), invalid.response);
      assert.equal(invalid.result.status, 400);

      const first = controllerResponse();
      await InternalController.putState(stateRequest(modelId, updatedState, 1), first.response);
      assert.equal(first.result.status, 200);
      assert.equal(first.result.body?.revision, 2);

      const stale = controllerResponse();
      await InternalController.putState(stateRequest(modelId, initialState, 1), stale.response);
      assert.equal(stale.result.status, 409);
      assert.equal(stale.result.body?.expectedRevision, 1);
      assert.equal(stale.result.body?.currentRevision, 2);

      const rejected = await pool.query<{ revision: string; content_hash: string }>(
        'SELECT revision, content_hash FROM model_state WHERE model_id = $1',
        [modelId]
      );
      assert.equal(Number(rejected.rows[0].revision), 2);
      assert.equal(
        rejected.rows[0].content_hash,
        computeStateContentHash(decodeModelState(updatedState))
      );

      const compatible = controllerResponse();
      await InternalController.putState(
        stateRequest(modelId, initialState),
        compatible.response
      );
      assert.equal(compatible.result.status, 200);
      assert.equal(compatible.result.body?.revision, 3);

      const emptyModelId = randomUUID();
      await pool.query(
        `INSERT INTO models (id, org_id, title, status, c4_type)
         VALUES ($1, $2, 'Modelo sem estado', 'draft', 'container')`,
        [emptyModelId, orgId]
      );
      const create = controllerResponse();
      await InternalController.putState(stateRequest(emptyModelId, initialState, 0), create.response);
      assert.equal(create.result.status, 200);
      assert.equal(create.result.body?.revision, 1);

      const staleCreate = controllerResponse();
      await InternalController.putState(
        stateRequest(emptyModelId, initialState, 0),
        staleCreate.response
      );
      assert.equal(staleCreate.result.status, 409);
      assert.equal(staleCreate.result.body?.currentRevision, 1);
    } finally {
      await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    }
  }
);

function importWorkspaceFixture(label: string): ImportedWorkspace {
  const first = `${label}-first`;
  const second = `${label}-second`;
  return {
    name: label,
    description: null,
    elements: [
      {
        identifier: first,
        kind: 'container',
        name: first,
        description: null,
        technology: null,
        tags: [],
        url: null,
        parentIdentifier: null,
      },
      {
        identifier: second,
        kind: 'container',
        name: second,
        description: null,
        technology: null,
        tags: [],
        url: null,
        parentIdentifier: null,
      },
    ],
    relationships: [
      {
        sourceIdentifier: first,
        targetIdentifier: second,
        description: 'depende',
        technology: null,
      },
    ],
    views: [],
  };
}

test(
  'importações concorrentes do mesmo modelo mantêm grafo e model_state na mesma revisão',
  { skip: enabled ? false : 'defina RUN_M3_TESTS=true e um Postgres descartável' },
  async () => {
    await runMigrations();

    const orgId = randomUUID();
    const modelId = randomUUID();

    try {
      await pool.query(
        'INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)',
        [orgId, `m3-import-lock-${orgId}`, 'Organização Import Lock']
      );
      await pool.query(
        `INSERT INTO models (id, org_id, title, status, c4_type)
         VALUES ($1, $2, 'Modelo Import Lock', 'draft', 'container')`,
        [modelId, orgId]
      );

      await Promise.all([
        importWorkspaceIntoModel(modelId, importWorkspaceFixture('alpha'), { mode: 'replace' }),
        importWorkspaceIntoModel(modelId, importWorkspaceFixture('beta'), { mode: 'replace' }),
      ]);

      const graph = await loadModelGraph(modelId);
      assert.ok(graph);
      const stateRow = await pool.query<{ state: Buffer; revision: string }>(
        'SELECT state, revision FROM model_state WHERE model_id = $1',
        [modelId]
      );
      assert.equal(stateRow.rows.length, 1);
      assert.equal(Number(stateRow.rows[0].revision), 2);

      const state = decodeModelState(new Uint8Array(stateRow.rows[0].state));
      const graphElements = graph.elements
        .map((element) => ({ id: element.id, title: element.title }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const stateElements = state.elements
        .map((element) => ({ id: element.id, title: element.title }))
        .sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(stateElements, graphElements);
      assert.equal(state.edges.length, graph.edges.length);
    } finally {
      await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    }
  }
);
