import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlantUmlFormat, parsePlantUmlWorkspace } from '../src/c4/plantuml-import.js';
import { PLANTUML_TEMPLATES } from '../src/c4/plantuml-templates.js';
import { isC4ModelType } from '../src/c4/model-types.js';

const diagram = `@startuml
!include <C4/C4_Container>
' comentário ignorado
title Loja
Person(cliente, "Cliente", "Compra produtos")
System_Boundary(loja, "Loja") {
  Container(api, "API", "Node.js", "Backend")
  ContainerDb(banco, "Banco", "PostgreSQL", "Persistência")
}
System_Ext(pagamentos, "Pagamentos", "Gateway externo")
Component(carrinho, "Carrinho", "React", "Compras")
Rel(cliente, api, "usa", "HTTPS")
BiRel(api, banco, "lê e grava", "SQL")
Rel_Back(api, pagamentos, "consulta")
@enduml`;

test('detectPlantUmlFormat reconhece diagramas C4-PlantUML', () => {
  assert.equal(detectPlantUmlFormat(diagram), true);
  assert.equal(detectPlantUmlFormat('!include <C4/C4_Context>'), true);
  assert.equal(detectPlantUmlFormat('workspace "x" {}'), false);
  assert.equal(detectPlantUmlFormat('{"workspace":{}}'), false);
});

test('parsePlantUmlWorkspace extrai elementos, tecnologia e relações', () => {
  const workspace = parsePlantUmlWorkspace(diagram);
  assert.equal(workspace.name, 'Loja');
  assert.equal(workspace.description, null);

  const byIdentifier = new Map(workspace.elements.map((element) => [element.identifier, element]));
  assert.equal(byIdentifier.size, 5);
  assert.equal(byIdentifier.get('cliente')!.kind, 'person');
  assert.equal(byIdentifier.get('cliente')!.description, 'Compra produtos');
  assert.equal(byIdentifier.get('api')!.kind, 'container');
  assert.equal(byIdentifier.get('api')!.technology, 'Node.js');
  assert.equal(byIdentifier.get('banco')!.technology, 'PostgreSQL');
  assert.equal(byIdentifier.get('pagamentos')!.kind, 'software_system');
  assert.equal(byIdentifier.get('carrinho')!.kind, 'component');

  assert.deepEqual(
    workspace.relationships.map((relationship) => [
      relationship.sourceIdentifier,
      relationship.targetIdentifier,
      relationship.description,
      relationship.technology,
    ]),
    [
      ['cliente', 'api', 'usa', 'HTTPS'],
      ['api', 'banco', 'lê e grava', 'SQL'],
      ['api', 'pagamentos', 'consulta', null],
    ]
  );

  assert.equal(workspace.views.length, 1);
  assert.equal(workspace.views[0].type, 'container');
  assert.equal(workspace.views[0].title, 'Loja');
});

test('parsePlantUmlWorkspace ignora diretivas, comentários e aliases repetidos', () => {
  const workspace = parsePlantUmlWorkspace(`@startuml
!include <C4/C4_Context>
' Person(ignorado, "Ignorado")
Person(usuario, "Usuário")
Person(usuario, "Duplicado")
@enduml`);

  assert.deepEqual(
    workspace.elements.map((element) => element.identifier),
    ['usuario']
  );
  assert.equal(workspace.views[0].type, 'system_context');
});

test('padrões PlantUML são diagramas válidos e referenciáveis', () => {
  assert.ok(PLANTUML_TEMPLATES.length >= 4);
  assert.equal(
    new Set(PLANTUML_TEMPLATES.map((template) => template.id)).size,
    PLANTUML_TEMPLATES.length
  );

  for (const template of PLANTUML_TEMPLATES) {
    assert.ok(isC4ModelType(template.c4Type), `${template.id}: c4Type inválido`);
    assert.equal(template.format, 'plantuml');
    assert.equal(detectPlantUmlFormat(template.content), true);

    const workspace = parsePlantUmlWorkspace(template.content);
    const identifiers = new Set(workspace.elements.map((element) => element.identifier));

    for (const relationship of workspace.relationships) {
      assert.ok(
        identifiers.has(relationship.sourceIdentifier) &&
          identifiers.has(relationship.targetIdentifier),
        `${template.id}: relação com elemento inexistente`
      );
    }

    if (template.id === 'blank') {
      assert.deepEqual(workspace.elements, []);
      assert.ok(workspace.views.length >= 1);
    } else {
      assert.ok(workspace.elements.length > 0, `${template.id}: sem elementos`);
      assert.ok(workspace.relationships.length > 0, `${template.id}: sem relações`);
      assert.ok(workspace.views.length > 0, `${template.id}: sem views`);
    }
  }
});
