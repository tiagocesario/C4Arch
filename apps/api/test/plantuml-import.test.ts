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
  assert.equal(byIdentifier.size, 6);
  assert.equal(byIdentifier.get('cliente')!.kind, 'person');
  assert.equal(byIdentifier.get('cliente')!.description, 'Compra produtos');
  assert.equal(byIdentifier.get('loja')!.kind, 'software_system');
  assert.equal(byIdentifier.get('loja')!.name, 'Loja');
  assert.equal(byIdentifier.get('api')!.kind, 'container');
  assert.equal(byIdentifier.get('api')!.technology, 'Node.js');
  // A fronteira do PlantUML vira o pai estrutural no modelo canônico.
  assert.equal(byIdentifier.get('api')!.parentIdentifier, 'loja');
  assert.equal(byIdentifier.get('banco')!.parentIdentifier, 'loja');
  assert.equal(byIdentifier.get('banco')!.technology, 'PostgreSQL');
  assert.equal(byIdentifier.get('pagamentos')!.kind, 'software_system');
  assert.equal(byIdentifier.get('pagamentos')!.parentIdentifier, null);
  assert.equal(byIdentifier.get('carrinho')!.kind, 'component');
  assert.equal(byIdentifier.get('carrinho')!.parentIdentifier, null);

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
      ['banco', 'api', 'lê e grava', 'SQL'],
      ['pagamentos', 'api', 'consulta', null],
    ]
  );

  assert.equal(workspace.views.length, 1);
  assert.equal(workspace.views[0].type, 'container');
  assert.equal(workspace.views[0].title, 'Loja');
});

test('parsePlantUmlWorkspace preserva boundaries e blocos aninhados', () => {
  const workspace = parsePlantUmlWorkspace(`@startuml
!include <C4/C4_Component>
System_Boundary(sistema, "Sistema") {
  Container(api, "API", "Node.js", "Backend") {
    Component(servico, "Serviço", "TypeScript", "Regras de negócio")
  }
  Container_Boundary(dados, "Dados") {
    ComponentDb(banco, "Banco")
  }
}
Person(cliente, "Cliente")
Rel(cliente, api, "usa", "HTTPS")
@enduml`);

  const parentOf = new Map(
    workspace.elements.map((element) => [element.identifier, element.parentIdentifier])
  );
  assert.deepEqual(
    workspace.elements.map((element) => [
      element.identifier,
      element.kind,
      element.parentIdentifier,
    ]),
    [
      ['sistema', 'software_system', null],
      ['api', 'container', 'sistema'],
      ['servico', 'component', 'api'],
      ['dados', 'container', 'sistema'],
      ['banco', 'component', 'dados'],
      ['cliente', 'person', null],
    ]
  );
  assert.equal(parentOf.get('api'), 'sistema');
  assert.equal(workspace.relationships[0].technology, 'HTTPS');
});

test('parsePlantUmlWorkspace extrai $tags de elementos', () => {
  const workspace = parsePlantUmlWorkspace(`@startuml
!include <C4/C4_Container>
Person(cliente, "Cliente", "Compra", $tags="externo+prioritario")
Container(api, "API", "Node.js", "Backend", $tags="interno")
Container(banco, "Banco", "PostgreSQL")
@enduml`);

  const byIdentifier = new Map(workspace.elements.map((element) => [element.identifier, element]));
  assert.deepEqual(byIdentifier.get('cliente')!.tags, ['externo', 'prioritario']);
  assert.deepEqual(byIdentifier.get('api')!.tags, ['interno']);
  assert.deepEqual(byIdentifier.get('banco')!.tags, []);
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

test('parsePlantUmlWorkspace aceita declarações e setas genéricas do PlantUML', () => {
  const workspace = parsePlantUmlWorkspace(`@startuml
title Teste Alterado
caption Descrição do diagrama
actor "Usuário" as user
rectangle "Aplicação Web" as app
database "Banco de Dados" as db
user --> app : Acessa
app --> db : Consulta
db --> app : Retorna
app --> user : Exibe
@enduml`);

  assert.equal(workspace.name, 'Teste Alterado');
  assert.equal(workspace.description, 'Descrição do diagrama');
  assert.deepEqual(
    workspace.elements.map((element) => [
      element.identifier,
      element.kind,
      element.name,
    ]),
    [
      ['user', 'person', 'Usuário'],
      ['app', 'software_system', 'Aplicação Web'],
      ['db', 'container', 'Banco de Dados'],
    ]
  );
  assert.deepEqual(
    workspace.relationships.map((relationship) => [
      relationship.sourceIdentifier,
      relationship.targetIdentifier,
      relationship.description,
    ]),
    [
      ['user', 'app', 'Acessa'],
      ['app', 'db', 'Consulta'],
      ['db', 'app', 'Retorna'],
      ['app', 'user', 'Exibe'],
    ]
  );
});

test('parsePlantUmlWorkspace aceita comentários, macros multilinha e argumentos nomeados', () => {
  const workspace = parsePlantUmlWorkspace(`@startuml
/' comentário de bloco
   ignorado '/
actor "Operador" as operador ' comentário de linha
Person(
  administrador,
  "Administrador",
  "Administra o sistema"
)
System($alias=sistema, $label="Sistema", $descr="Sistema principal")
operador --> administrador : Opera
@enduml`);

  assert.deepEqual(
    workspace.elements.map((element) => element.identifier),
    ['operador', 'administrador', 'sistema']
  );
  assert.equal(workspace.elements[2].name, 'Sistema');
  assert.equal(workspace.elements[2].description, 'Sistema principal');
  assert.deepEqual(
    workspace.relationships.map((relationship) => [
      relationship.sourceIdentifier,
      relationship.targetIdentifier,
    ]),
    [['operador', 'administrador']]
  );
});

test('parsePlantUmlWorkspace respeita setas reversas e bidirecionais', () => {
  const workspace = parsePlantUmlWorkspace(`@startuml
actor "Usuário" as user
rectangle "Aplicação" as app
rectangle "Serviço" as service
user <-- app : Publica
user <--> service : Troca
@enduml`);

  assert.deepEqual(
    workspace.relationships.map((relationship) => [
      relationship.sourceIdentifier,
      relationship.targetIdentifier,
    ]),
    [
      ['app', 'user'],
      ['user', 'service'],
      ['service', 'user'],
    ]
  );
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
