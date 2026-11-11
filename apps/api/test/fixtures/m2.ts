import type { BuildSnapshotInput } from '../../src/c4/backfill.js';

export const MODEL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const SYSTEM_ID = '11111111-1111-4111-8111-111111111111';
export const CONTAINER_ID = '22222222-2222-4222-8222-222222222222';
export const COMPONENT_ID = '33333333-3333-4333-8333-333333333333';
export const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
export const EDGE_ID = '55555555-5555-4555-8555-555555555555';
export const SELF_EDGE_ID = '66666666-6666-4666-8666-666666666666';

export const PRIMARY_XML = `<mxfile><diagram id="p1" name="Containers"><mxGraphModel><root>
  <mxCell id="0" />
  <mxCell id="1" parent="0" />
  <object id="sys" label="[Software System: Sistema X]" c4archElementId="${SYSTEM_ID}">
    <mxCell id="sys-cell" vertex="1" parent="1" style="rounded=1;">
      <mxGeometry x="100" y="100" width="400" height="300" as="geometry" />
    </mxCell>
  </object>
  <object id="api" label="[Container: API]" c4archElementId="${CONTAINER_ID}">
    <mxCell id="api-cell" vertex="1" parent="1" style="rounded=1;">
      <mxGeometry x="150" y="150" width="200" height="100" as="geometry" />
    </mxCell>
  </object>
  <object id="svc" label="[Componente: Serviço]" c4archElementId="${COMPONENT_ID}">
    <mxCell id="svc-cell" vertex="1" parent="1" style="rounded=1;">
      <mxGeometry x="170" y="170" width="80" height="40" as="geometry" />
    </mxCell>
  </object>
</root></mxGraphModel></diagram></mxfile>`;

export const COMPONENT_XML = `<mxfile><diagram id="p2" name="Componentes"><mxGraphModel><root>
  <mxCell id="0" />
  <mxCell id="1" parent="0" />
  <object id="svc-extra" label="[Componente: Serviço]" c4archElementId="${COMPONENT_ID}">
    <mxCell id="svc-extra-cell" vertex="1" parent="1" style="rounded=1;">
      <mxGeometry x="30" y="40" width="90" height="50" as="geometry" />
    </mxCell>
  </object>
</root></mxGraphModel></diagram></mxfile>`;

export const GENERATED_DAS = `# Documento de Arquitetura de Soluções (DAS)

## 1. Informações do documento

| Data | 01/01/2026 |

## 6. Elementos e conexões do modelo

### 6.1 Elementos

Tabela original de elementos.

### 6.2 Conexões

Tabela original de conexões.

## 10. Histórico

| Versão | Data |
|---|---|
| 0.3.0 | 01/01/2026 |
`;

export const EDITED_DAS = GENERATED_DAS.replace(
  'Tabela original de elementos.',
  'Tabela editada manualmente.'
).replace('| 0.3.0 | 01/01/2026 |', '| 0.3.0 | 02/01/2026 |');

export function makeSnapshotInput(): BuildSnapshotInput {
  return {
    model: {
      id: MODEL_ID,
      org_id: ORG_ID,
      title: 'Modelo de teste',
      description: 'Descrição',
      status: 'draft',
      c4_type: 'container',
      c4_scope: 'Sistema X',
      parent_id: null,
      drawio_xml: PRIMARY_XML,
      diagrams: [{ c4Type: 'component', drawioXml: COMPONENT_XML }],
      das_content: EDITED_DAS,
    },
    elements: [
      {
        id: ACTOR_ID,
        model_id: MODEL_ID,
        type: 'actor',
        title: 'Usuário',
        description: null,
        metadata: null,
        position_x: 10,
        position_y: 20,
        order: 0,
      },
      {
        id: SYSTEM_ID,
        model_id: MODEL_ID,
        type: 'system',
        title: 'Sistema X',
        description: 'Sistema principal',
        metadata: { technology: 'Legado', tags: ['core'] },
        position_x: 100,
        position_y: 100,
        order: 1,
      },
      {
        id: CONTAINER_ID,
        model_id: MODEL_ID,
        type: 'container',
        title: 'API',
        description: 'API REST',
        metadata: { technology: 'Node.js', url: 'https://api.example.com' },
        position_x: 150,
        position_y: 150,
        order: 2,
      },
      {
        id: COMPONENT_ID,
        model_id: MODEL_ID,
        type: 'component',
        title: 'Serviço',
        description: null,
        metadata: { owner: 'pagamentos' },
        position_x: 170,
        position_y: 170,
        order: 3,
      },
    ],
    edges: [
      {
        id: EDGE_ID,
        model_id: MODEL_ID,
        from_id: ACTOR_ID,
        to_id: SYSTEM_ID,
        label: 'Usa [HTTPS]',
        type: 'call',
      },
      {
        id: SELF_EDGE_ID,
        model_id: MODEL_ID,
        from_id: ACTOR_ID,
        to_id: ACTOR_ID,
        label: 'Auto',
        type: 'depends',
      },
    ],
    versions: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        version: 1,
        snapshot: { elements: [ACTOR_ID, SYSTEM_ID] },
        created_by: null,
      },
      {
        id: '88888888-8888-4888-8888-888888888888',
        version: 2,
        snapshot: { elements: [ACTOR_ID, SYSTEM_ID] },
        created_by: null,
      },
      {
        id: '99999999-9999-4999-8999-999999999999',
        version: 3,
        snapshot: { elements: [ACTOR_ID, SYSTEM_ID, CONTAINER_ID] },
        created_by: null,
      },
    ],
    existingVersionHashes: [],
    dasGenerated: GENERATED_DAS,
  };
}
