import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db.js';
import { runMigrations } from '../src/db/migrate.js';
import { backfillModel } from '../src/c4/backfill.js';
import { shadowModel } from '../src/c4/shadow.js';
import { generateDAS } from '../src/c4/das.js';

const enabled = process.env.RUN_M2_TESTS === 'true';

after(async () => {
  await pool.end();
});

function xmlFor(ids: {
  systemId: string;
  containerId: string;
  componentId: string;
}): string {
  return `<mxfile><diagram id="p1" name="Containers"><mxGraphModel><root>
  <mxCell id="0" />
  <mxCell id="1" parent="0" />
  <object id="sys" label="[Software System: Sistema X]" c4archElementId="${ids.systemId}">
    <mxCell id="sys-cell" vertex="1" parent="1" style="rounded=1;">
      <mxGeometry x="100" y="100" width="400" height="300" as="geometry" />
    </mxCell>
  </object>
  <object id="api" label="[Container: API]" c4archElementId="${ids.containerId}">
    <mxCell id="api-cell" vertex="1" parent="1" style="rounded=1;">
      <mxGeometry x="150" y="150" width="200" height="100" as="geometry" />
    </mxCell>
  </object>
  <object id="svc" label="[Componente: Serviço]" c4archElementId="${ids.componentId}">
    <mxCell id="svc-cell" vertex="1" parent="1" style="rounded=1;">
      <mxGeometry x="170" y="170" width="80" height="40" as="geometry" />
    </mxCell>
  </object>
</root></mxGraphModel></diagram></mxfile>`;
}

function componentXml(componentId: string): string {
  return `<mxfile><diagram id="p2" name="Componentes"><mxGraphModel><root>
  <mxCell id="0" />
  <mxCell id="1" parent="0" />
  <object id="svc-extra" label="[Componente: Serviço]" c4archElementId="${componentId}">
    <mxCell id="svc-extra-cell" vertex="1" parent="1" style="rounded=1;">
      <mxGeometry x="30" y="40" width="90" height="50" as="geometry" />
    </mxCell>
  </object>
</root></mxGraphModel></diagram></mxfile>`;
}

test(
  'backfill do M2 é idempotente e a leitura em sombra fica sem divergências',
  { skip: enabled ? false : 'defina RUN_M2_TESTS=true e um Postgres descartável' },
  async () => {
    await runMigrations();

    const orgId = randomUUID();
    const modelId = randomUUID();
    const actorId = randomUUID();
    const systemId = randomUUID();
    const containerId = randomUUID();
    const componentId = randomUUID();
    const edgeId = randomUUID();
    const selfEdgeId = randomUUID();

    const primaryXml = xmlFor({ systemId, containerId, componentId });
    const extraXml = componentXml(componentId);
    const diagrams = [{ c4Type: 'component' as const, drawioXml: extraXml }];

    const elements = [
      {
        id: actorId,
        model_id: modelId,
        app_id: null,
        service_id: null,
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
        model_id: modelId,
        app_id: null,
        service_id: null,
        type: 'system',
        title: 'Sistema X',
        description: 'Sistema principal',
        metadata: { technology: 'Legado', tags: ['core'] },
        position_x: 100,
        position_y: 100,
        order: 1,
      },
      {
        id: containerId,
        model_id: modelId,
        app_id: null,
        service_id: null,
        type: 'container',
        title: 'API',
        description: 'API REST',
        metadata: { technology: 'Node.js', url: 'https://api.example.com' },
        position_x: 150,
        position_y: 150,
        order: 2,
      },
      {
        id: componentId,
        model_id: modelId,
        app_id: null,
        service_id: null,
        type: 'component',
        title: 'Serviço',
        description: null,
        metadata: { owner: 'pagamentos' },
        position_x: 170,
        position_y: 170,
        order: 3,
      },
    ];

    const edges = [
      {
        id: edgeId,
        model_id: modelId,
        from_id: actorId,
        to_id: systemId,
        label: 'Usa [HTTPS]',
        type: 'call',
      },
      {
        id: selfEdgeId,
        model_id: modelId,
        from_id: actorId,
        to_id: actorId,
        label: 'Auto',
        type: 'depends',
      },
    ];

    const generated = generateDAS(
      {
        id: modelId,
        title: 'Modelo M2',
        description: 'Fixture de integração',
        status: 'draft',
        c4_type: 'container',
        c4_scope: 'Sistema X',
        folder_id: null,
        org_id: orgId,
      },
      elements,
      edges,
      null,
      primaryXml,
      diagrams
    );
    const edited = generated.replace(
      '### 6.1 Elementos\n\n',
      '### 6.1 Elementos\n\nLinha editada manualmente.\n\n'
    );

    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)`,
        [orgId, `m2-${orgId}`, 'Organização M2']
      );
      await client.query(
        `INSERT INTO models
           (id, org_id, title, description, status, c4_type, c4_scope, drawio_xml, diagrams, das_content)
         VALUES ($1, $2, $3, $4, 'draft', 'container', $5, $6, $7::jsonb, $8)`,
        [
          modelId,
          orgId,
          'Modelo M2',
          'Fixture de integração',
          'Sistema X',
          primaryXml,
          JSON.stringify(diagrams),
          edited,
        ]
      );

      for (const element of elements) {
        await client.query(
          `INSERT INTO elements
             (id, model_id, app_id, service_id, type, title, description, metadata, position_x, position_y, "order")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
          [
            element.id,
            element.model_id,
            element.app_id,
            element.service_id,
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

      for (const edge of edges) {
        await client.query(
          `INSERT INTO edges (id, model_id, from_id, to_id, label, type)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [edge.id, edge.model_id, edge.from_id, edge.to_id, edge.label, edge.type]
        );
      }

      await client.query(
        `INSERT INTO model_versions (model_id, version, snapshot, created_by)
         VALUES ($1, 1, $2::jsonb, NULL), ($1, 2, $2::jsonb, NULL), ($1, 3, $3::jsonb, NULL)`,
        [
          modelId,
          JSON.stringify({ elements: [actorId, systemId] }),
          JSON.stringify({ elements: [actorId, systemId, containerId] }),
        ]
      );
    } finally {
      client.release();
    }

    try {
      const first = await backfillModel(modelId);
      assert.equal(first.stats.elements, 4);
      assert.equal(first.stats.relationships, 1);
      assert.equal(first.stats.views, 2);
      assert.equal(first.stats.overrides, 1);
      assert.equal(first.stats.versions, 3);
      assert.equal(first.stats.duplicateVersions, 1);
      assert.ok(first.warnings.some((warning) => warning.code === 'RELATIONSHIP_SELF'));

      const second = await backfillModel(modelId);
      assert.deepEqual(second.stats, first.stats);

      const counts = await pool.query<{
        elements: string;
        relationships: string;
        views: string;
        layout: string;
        overrides: string;
      }>(
        `SELECT
           (SELECT count(*) FROM model_elements WHERE model_id = $1)::text AS elements,
           (SELECT count(*) FROM model_relationships WHERE model_id = $1)::text AS relationships,
           (SELECT count(*) FROM model_views WHERE model_id = $1)::text AS views,
           (SELECT count(*) FROM model_view_layout l
              JOIN model_views v ON v.id = l.view_id
             WHERE v.model_id = $1)::text AS layout,
           (SELECT count(*) FROM model_das_overrides WHERE model_id = $1)::text AS overrides`,
        [modelId]
      );
      assert.deepEqual(counts.rows[0], {
        elements: '4',
        relationships: '1',
        views: '2',
        layout: '5',
        overrides: '1',
      });

      const versions = await pool.query<{ version: number; content_hash: string | null }>(
        'SELECT version, content_hash FROM model_versions WHERE model_id = $1 ORDER BY version',
        [modelId]
      );
      assert.match(versions.rows[0].content_hash ?? '', /^sha256:/);
      assert.equal(versions.rows[1].content_hash, null);
      assert.match(versions.rows[2].content_hash ?? '', /^sha256:/);

      const metadata = await pool.query<{
        das_override_count: number;
        das_source_hash: string | null;
      }>('SELECT das_override_count, das_source_hash FROM models WHERE id = $1', [modelId]);
      assert.equal(metadata.rows[0].das_override_count, 1);
      assert.match(metadata.rows[0].das_source_hash ?? '', /^sha256:/);

      const report = await shadowModel(modelId);
      assert.equal(report.ok, true, JSON.stringify(report.divergences, null, 2));
      assert.deepEqual(report.divergences, []);
    } finally {
      await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    }
  }
);
