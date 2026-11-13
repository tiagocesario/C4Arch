import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectStructurizrFormat,
  parseStructurizrWorkspace,
} from '../src/c4/structurizr-import.js';
import { STRUCTURIZR_TEMPLATES } from '../src/c4/structurizr-templates.js';
import { isC4ModelType } from '../src/c4/model-types.js';

const jsonWorkspace = JSON.stringify({
  workspace: {
    name: 'Loja',
    description: 'Workspace de exemplo',
    model: {
      people: [
        {
          id: '1',
          name: 'Cliente',
          description: 'Compra produtos',
          tags: 'externo, pessoa',
          relationships: [{ destinationId: '2', description: 'usa', technology: 'HTTPS' }],
        },
      ],
      softwareSystems: [
        {
          id: '2',
          name: 'Loja',
          description: 'Sistema principal',
          containers: [
            {
              id: '3',
              name: 'API',
              description: 'Backend',
              technology: 'Node.js',
              components: [
                {
                  id: '4',
                  name: 'Pagamentos',
                  description: 'Gateway',
                  technology: 'Stripe',
                  relationships: [{ destinationId: 3, description: 'consulta' }],
                },
              ],
            },
          ],
        },
      ],
    },
    views: {
      systemLandscapeViews: [{ key: 'landscape', description: 'Panorama' }],
      systemContextViews: [{ key: 'context', softwareSystemId: '2' }],
      containerViews: [{ key: 'containers', softwareSystemId: 2 }],
      componentViews: [{ key: 'components', containerId: 3 }],
    },
  },
});

const dslWorkspace = `
// comentário de linha
workspace "Loja DSL" "Descrição do workspace" {
  model {
    cliente = person "Cliente" "Compra produtos" "externo"
    loja = softwareSystem "Loja" "Sistema principal" {
      api = container "API" "Backend" "Node.js" "core"
      api -> pagamentos "chama" "HTTPS"
    }
    pagamentos = component "Pagamentos" "Gateway" "Stripe"
    /* bloco
       comentado */
  }
  views {
    systemLandscape { include * }
    container loja { include * }
  }
}
`;

test('detectStructurizrFormat distingue JSON e DSL', () => {
  assert.equal(detectStructurizrFormat('  {"workspace":{}}'), 'json');
  assert.equal(detectStructurizrFormat('workspace "x" {}'), 'dsl');
});

test('parse JSON mantém hierarquia, relações e views', () => {
  const workspace = parseStructurizrWorkspace(jsonWorkspace);
  assert.equal(workspace.name, 'Loja');
  assert.equal(workspace.description, 'Workspace de exemplo');

  const byIdentifier = new Map(workspace.elements.map((element) => [element.identifier, element]));
  assert.equal(byIdentifier.size, 4);
  assert.equal(byIdentifier.get('cliente')!.kind, 'person');
  assert.deepEqual(byIdentifier.get('cliente')!.tags, ['externo', 'pessoa']);
  assert.equal(byIdentifier.get('loja')!.kind, 'software_system');
  assert.equal(byIdentifier.get('api')!.parentIdentifier, 'loja');
  assert.equal(byIdentifier.get('pagamentos')!.parentIdentifier, 'api');
  assert.equal(byIdentifier.get('api')!.technology, 'Node.js');

  assert.deepEqual(
    workspace.relationships.map((relationship) => [
      relationship.sourceIdentifier,
      relationship.targetIdentifier,
      relationship.description,
      relationship.technology,
    ]),
    [
      ['cliente', 'loja', 'usa', 'HTTPS'],
      ['pagamentos', 'api', 'consulta', null],
    ]
  );

  assert.deepEqual(
    workspace.views.map((view) => [view.key, view.type, view.scopeIdentifier]),
    [
      ['landscape', 'filtered', null],
      ['context', 'system_context', 'loja'],
      ['containers', 'container', 'loja'],
      ['components', 'component', 'api'],
    ]
  );
});

test('parse DSL mantém hierarquia, tecnologia, tags e relações', () => {
  const workspace = parseStructurizrWorkspace(dslWorkspace, 'dsl');
  assert.equal(workspace.name, 'Loja DSL');
  assert.equal(workspace.description, 'Descrição do workspace');

  const byIdentifier = new Map(workspace.elements.map((element) => [element.identifier, element]));
  assert.equal(byIdentifier.get('cliente')!.description, 'Compra produtos');
  assert.deepEqual(byIdentifier.get('cliente')!.tags, ['externo']);
  assert.equal(byIdentifier.get('loja')!.kind, 'software_system');
  assert.equal(byIdentifier.get('api')!.parentIdentifier, 'loja');
  assert.equal(byIdentifier.get('api')!.technology, 'Node.js');
  assert.deepEqual(byIdentifier.get('api')!.tags, ['core']);
  assert.equal(byIdentifier.get('pagamentos')!.technology, 'Stripe');

  assert.equal(workspace.relationships.length, 1);
  assert.deepEqual(workspace.relationships[0], {
    sourceIdentifier: 'api',
    targetIdentifier: 'pagamentos',
    description: 'chama',
    technology: 'HTTPS',
  });

  assert.deepEqual(workspace.views.map((view) => view.type), ['filtered', 'container']);
});

test('parse DSL aplica autodetecção de formato', () => {
  const workspace = parseStructurizrWorkspace(dslWorkspace);
  assert.equal(workspace.name, 'Loja DSL');
});

test('parse JSON evita identifiers duplicados', () => {
  const duplicated = JSON.stringify({
    workspace: {
      model: {
        people: [
          { name: 'Usuário', description: 'a' },
          { name: 'Usuário', description: 'b' },
        ],
      },
    },
  });
  const workspace = parseStructurizrWorkspace(duplicated);
  assert.deepEqual(
    workspace.elements.map((element) => element.identifier),
    ['usuario', 'usuario-2']
  );
});

test('workspace vazio não falha', () => {
  const empty = parseStructurizrWorkspace('{}');
  assert.deepEqual(empty.elements, []);
  assert.deepEqual(empty.relationships, []);
  assert.deepEqual(empty.views, []);
});

test('padrões Structurizr são workspaces DSL válidos e referenciáveis', () => {
  assert.ok(STRUCTURIZR_TEMPLATES.length >= 4);
  assert.equal(new Set(STRUCTURIZR_TEMPLATES.map((template) => template.id)).size, STRUCTURIZR_TEMPLATES.length);

  for (const template of STRUCTURIZR_TEMPLATES) {
    assert.ok(isC4ModelType(template.c4Type), `${template.id}: c4Type inválido`);
    assert.equal(template.format, 'dsl');
    assert.notEqual(detectStructurizrFormat(template.content), 'json');

    const workspace = parseStructurizrWorkspace(template.content, 'dsl');
    const identifiers = new Set(workspace.elements.map((element) => element.identifier));

    for (const relationship of workspace.relationships) {
      assert.ok(
        identifiers.has(relationship.sourceIdentifier) &&
          identifiers.has(relationship.targetIdentifier),
        `${template.id}: relação com elemento inexistente`
      );
    }
    for (const view of workspace.views) {
      if (view.scopeIdentifier) {
        assert.ok(
          identifiers.has(view.scopeIdentifier),
          `${template.id}: view com escopo inexistente`
        );
      }
    }

    if (template.id === 'blank') {
      assert.deepEqual(workspace.elements, []);
      assert.deepEqual(workspace.views, []);
    } else {
      assert.ok(workspace.elements.length > 0, `${template.id}: sem elementos`);
      assert.ok(workspace.relationships.length > 0, `${template.id}: sem relações`);
      assert.ok(workspace.views.length > 0, `${template.id}: sem views`);
    }
  }
});
