import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_FORMATS,
  exportModel,
  hasRawAngleInAttribute,
  isUsableDrawioXml,
  renderDrawio,
  renderHtml,
  renderMermaid,
  renderPlantUml,
  renderSvg,
} from '../src/c4/exporters.js';
import type { ModelGraph } from '../src/c4/model-graph.js';
import { parsePlantUmlWorkspace } from '../src/c4/plantuml-import.js';

function sampleGraph(): ModelGraph {
  return {
    model: { id: 'm1', title: 'Loja Online', description: 'Arquitetura de referência' },
    source: 'legacy',
    elements: [
      {
        id: 'p1',
        model_id: 'm1',
        type: 'actor',
        title: 'Cliente',
        description: 'Compra produtos',
        metadata: { tags: ['externo'] },
        position_x: 0,
        position_y: 0,
        order: 0,
      },
      {
        id: 's1',
        model_id: 'm1',
        type: 'system',
        title: 'Loja',
        description: 'Sistema principal',
        metadata: null,
        position_x: 200,
        position_y: 0,
        order: 1,
      },
      {
        id: 'c1',
        model_id: 'm1',
        type: 'container',
        title: 'API',
        description: 'Backend',
        metadata: { technology: 'Node.js' },
        position_x: 400,
        position_y: 0,
        order: 2,
      },
      {
        id: 'cp1',
        model_id: 'm1',
        type: 'component',
        title: 'Pagamentos',
        description: 'Integração com gateway',
        metadata: { technology: 'Stripe SDK' },
        position_x: 600,
        position_y: 0,
        order: 3,
      },
    ],
    edges: [
      {
        id: 'e1',
        model_id: 'm1',
        from_id: 'p1',
        to_id: 's1',
        label: 'usa',
        type: 'call',
      },
      {
        id: 'e2',
        model_id: 'm1',
        from_id: 'c1',
        to_id: 'cp1',
        label: 'processa pagamento',
        type: 'http',
      },
    ],
  };
}

test('EXPORT_FORMATS cobre todos os formatos suportados', () => {
  const formats = EXPORT_FORMATS.map((item) => item.format).sort();
  assert.deepEqual(formats, [
    'drawio',
    'html',
    'mermaid',
    'plantuml',
    'png',
    'svg',
  ]);
});

test('renderSvg inclui título, elementos e legenda', () => {
  const svg = renderSvg(sampleGraph());
  assert.match(svg, /^<svg xmlns=/);
  assert.match(svg, /Loja Online/);
  assert.match(svg, /Cliente/);
  assert.match(svg, /Pagamentos/);
  assert.match(svg, /Legenda:/);
  assert.match(svg, /marker-end="url\(#c4arrow\)"/);
});

test('renderSvg escape XML de títulos e descrições', () => {
  const graph = sampleGraph();
  graph.elements[0].title = 'Cliente <script>';
  graph.elements[0].description = 'A & B';
  const svg = renderSvg(graph);
  assert.match(svg, /Cliente &lt;script&gt;/);
  assert.match(svg, /A &amp; B/);
  assert.doesNotMatch(svg, /Cliente <script>/);
});

test('renderMermaid gera flowchart e relações rotuladas', () => {
  const mermaid = renderMermaid(sampleGraph());
  assert.match(mermaid, /^flowchart LR/);
  assert.match(mermaid, /"Cliente"/);
  assert.match(mermaid, /\|"usa"\|/);
  assert.match(mermaid, /\|"processa pagamento"\|/);
});

test('renderPlantUml escolhe C4_Component quando há componentes', () => {
  const plantuml = renderPlantUml(sampleGraph());
  assert.match(plantuml, /@startuml/);
  assert.match(plantuml, /!include <C4\/C4_Component>/);
  assert.match(plantuml, /Person\(e0, "Cliente"/);
  assert.match(plantuml, /Container\(e2, "API", "Node\.js"/);
  assert.match(plantuml, /Rel\(e2, e3, "processa pagamento"/);
  assert.match(plantuml, /@enduml/);
});

test('renderPlantUml preserva hierarquia, tags e tecnologia das relações', () => {
  const graph = sampleGraph();
  graph.elements[2].parent_element_id = 's1';
  graph.elements[3].parent_element_id = 'c1';
  graph.edges[1].technology = 'HTTPS';

  const plantuml = renderPlantUml(graph);
  assert.match(plantuml, /Person\(e0, "Cliente", "Compra produtos", \$tags="externo"\)/);
  assert.match(plantuml, /System_Boundary\(e1, "Loja"\) \{/);
  assert.match(plantuml, /\n {2}Container_Boundary\(e2, "API"\) \{/);
  assert.match(plantuml, /\n {4}Component\(e3, "Pagamentos"/);
  assert.match(plantuml, /Rel\(e2, e3, "processa pagamento", "HTTPS"\)/);
});

test('renderPlantUml faz roundtrip da hierarquia e da tecnologia', () => {
  const graph = sampleGraph();
  graph.elements[2].parent_element_id = 's1';
  graph.elements[3].parent_element_id = 'c1';
  graph.edges[1].technology = 'HTTPS';

  const workspace = parsePlantUmlWorkspace(renderPlantUml(graph));
  const byIdentifier = new Map(workspace.elements.map((element) => [element.identifier, element]));

  assert.equal(byIdentifier.get('e2')!.parentIdentifier, 'e1');
  assert.equal(byIdentifier.get('e3')!.parentIdentifier, 'e2');
  assert.deepEqual(byIdentifier.get('e0')!.tags, ['externo']);
  assert.equal(workspace.relationships[1].technology, 'HTTPS');
});

test('renderPlantUml usa identificadores canônicos como aliases', () => {
  const graph = sampleGraph();
  graph.elements[1].identifier = 'loja';
  graph.elements[2].identifier = 'api';
  graph.elements[3].identifier = 'pagamentos';

  const plantuml = renderPlantUml(graph);
  // Sem identificador o fallback continua sendo e0.
  assert.match(plantuml, /Person\(e0, "Cliente"/);
  assert.match(plantuml, /System\(loja, "Loja"/);
  assert.match(plantuml, /Rel\(api, pagamentos, "processa pagamento"\)/);
});

test('renderPlantUml faz roundtrip de título e caption com apóstrofo', () => {
  const graph = sampleGraph();
  graph.model.title = "Don't lose";
  graph.model.description = "It's critical";

  const plantuml = renderPlantUml(graph);
  assert.match(plantuml, /title "Don't lose"/);
  assert.match(plantuml, /caption "It's critical"/);

  const workspace = parsePlantUmlWorkspace(plantuml);
  assert.equal(workspace.name, "Don't lose");
  assert.equal(workspace.description, "It's critical");
});

test('renderDrawio inclui IDs estáveis e arestas conectadas', () => {
  const xml = renderDrawio(sampleGraph());
  assert.match(xml, /<mxfile/);
  assert.match(xml, /c4archElementId="p1"/);
  assert.match(xml, /c4archElementId="cp1"/);
  assert.match(xml, /source="c4arch-p1" target="c4arch-s1"/);
  assert.match(xml, /id="edge-e1"/);
});

test('renderDrawio escapa o HTML dos labels dentro dos atributos XML', () => {
  const xml = renderDrawio(sampleGraph());
  // O draw.io rejeita '<' cru em atributos; o HTML do label deve virar entidade.
  assert.match(xml, /label="&lt;font style=/);
  assert.match(xml, /%c4Name%/);
  assert.doesNotMatch(xml, /label="<font/);
  assert.equal(isUsableDrawioXml(xml), true);
  assert.equal(hasRawAngleInAttribute(xml), false);

  const broken = '<mxfile><diagram><mxGraphModel><root><object label="<b>x</b>"/></root></mxGraphModel></diagram></mxfile>';
  assert.equal(hasRawAngleInAttribute(broken), true);
  assert.equal(isUsableDrawioXml(broken), false);
});

test('renderDrawio usa as shapes e os rótulos oficiais do C4 model', () => {
  const xml = renderDrawio(sampleGraph());
  // Shapes oficiais da biblioteca C4 do draw.io.
  assert.match(xml, /shape=mxgraph\.c4\.person2/);
  assert.match(xml, /fillColor=#083F75/);
  assert.match(xml, /fillColor=#1061B0/);
  assert.match(xml, /fillColor=#23A2D9/);
  assert.match(xml, /fillColor=#63BEF2/);
  // Placeholders e atributos do rótulo C4 de três linhas.
  assert.match(xml, /placeholders="1"/);
  assert.match(xml, /c4Type="Person"/);
  assert.match(xml, /c4Type="Software System"/);
  assert.match(xml, /c4Type="Container"/);
  assert.match(xml, /c4Technology="Node\.js"/);
  assert.match(xml, /c4Type="Component"/);
  assert.match(xml, /c4Technology="Stripe SDK"/);
  // Relação no estilo C4 do draw.io.
  assert.match(xml, /endArrow=blockThin/);
});

test('renderDrawio refaz o layout quando as shapes C4 maiores se sobrepõem', () => {
  const graph = sampleGraph();
  for (const element of graph.elements) {
    element.position_x = 0;
    element.position_y = 0;
  }
  const xml = renderDrawio(graph);
  const positions = [...xml.matchAll(/<mxGeometry x="(\d+)" y="(\d+)"/g)].map(
    (match) => `${match[1]},${match[2]}`
  );
  assert.ok(positions.length >= graph.elements.length);
  assert.equal(new Set(positions).size, positions.length);
});

test('renderPlantUml desenha elementos com filhos como boundaries C4 oficiais', () => {
  const graph = sampleGraph();
  graph.elements[2].parent_element_id = 's1';
  const plantuml = renderPlantUml(graph);

  assert.match(plantuml, /System_Boundary\(e1, "Loja"\) \{/);
  assert.doesNotMatch(plantuml, /System\(e1, "Loja"/);

  const workspace = parsePlantUmlWorkspace(plantuml);
  assert.equal(workspace.elements.some((element) => element.identifier === 'e1'), true);

  graph.elements[3].parent_element_id = 'c1';
  const containerParent = renderPlantUml(graph);
  assert.match(containerParent, /Container_Boundary\(e2, /);
});

test('renderDrawio representa a hierarquia do PlantUML como boundary C4', () => {
  const graph = sampleGraph();
  graph.elements[2].parent_element_id = 's1';
  const xml = renderDrawio(graph);

  assert.match(xml, /c4archType="boundary"/);
  assert.match(xml, /dashPattern=8 4/);
  // O sistema que virou boundary aparece uma única vez no diagrama.
  assert.equal((xml.match(/c4archElementId="s1"/g) ?? []).length, 1);
  assert.match(xml, /c4archElementId="c1"/);
});

test('renderHtml monta site autocontido com inventário', () => {
  const html = renderHtml(sampleGraph());
  assert.match(html, /<!doctype html>/);
  assert.match(html, /<svg /);
  assert.match(html, /Elementos \(4\)/);
  assert.match(html, /Relações \(2\)/);
  assert.match(html, /Node\.js/);
  assert.match(html, /Gerado por C4Arch/);
});

test('exportModel devolve content-type e extensão por formato', () => {
  const svg = exportModel(sampleGraph(), 'svg');
  assert.equal(svg.contentType, 'image/svg+xml; charset=utf-8');
  assert.equal(svg.filename, 'loja-online.svg');
  assert.match(String(svg.body), /<svg/);

  const png = exportModel(sampleGraph(), 'png');
  assert.equal(png.contentType, 'image/png');
  assert.equal(png.filename, 'loja-online.png');
  assert.ok(Buffer.isBuffer(png.body));
  assert.deepEqual([...png.body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  assert.throws(() => exportModel(sampleGraph(), 'pdf' as never), /desconhecido/);
});
