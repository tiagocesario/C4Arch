import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_FORMATS,
  exportModel,
  renderDrawio,
  renderHtml,
  renderMermaid,
  renderPlantUml,
  renderStructurizrDsl,
  renderStructurizrJson,
  renderSvg,
} from '../src/c4/exporters.js';
import type { ModelGraph } from '../src/c4/model-graph.js';

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
    'structurizr-dsl',
    'structurizr-json',
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
  assert.match(plantuml, /C4_Component\.puml/);
  assert.match(plantuml, /Person\(e0, "Cliente"/);
  assert.match(plantuml, /Container\(e2, "API", "Node\.js"/);
  assert.match(plantuml, /Rel\(e2, e3, "processa pagamento"/);
  assert.match(plantuml, /@enduml/);
});

test('renderStructurizrJson produz workspace consumível', () => {
  const json = JSON.parse(renderStructurizrJson(sampleGraph())) as Record<string, any>;
  assert.equal(json.name, 'Loja Online');
  assert.equal(json.model.people.length, 1);
  assert.ok(json.model.softwareSystems.length >= 1);
  const host = json.model.softwareSystems[0];
  assert.equal(host.name, 'Loja');
  assert.equal(host.containers[0].name, 'API');
  assert.equal(host.containers[0].components[0].name, 'Pagamentos');
  assert.ok(Array.isArray(json.model.people[0].relationships));
  assert.equal(json.model.people[0].relationships[0].description, 'usa');
  assert.equal(json.model.people[0].relationships[0].technology, undefined);
  assert.ok(json.views.systemLandscapeViews.length > 0);
  assert.ok(json.views.containerViews.length > 0);
});

test('renderStructurizrJson cria sistema sintético sem software system', () => {
  const graph = sampleGraph();
  graph.elements = graph.elements.filter((element) => element.type !== 'system' && element.type !== 'actor');
  graph.edges = [];
  const json = JSON.parse(renderStructurizrJson(graph)) as Record<string, any>;
  assert.equal(json.model.people.length, 0);
  assert.equal(json.model.softwareSystems[0].name, 'Loja Online');
});

test('renderStructurizrDsl gera hierarquia e relações', () => {
  const dsl = renderStructurizrDsl(sampleGraph());
  assert.match(dsl, /^workspace "Loja Online"/);
  assert.match(dsl, /cliente = person "Cliente"/);
  assert.match(dsl, /api = container "API"/);
  assert.match(dsl, /pagamentos = component "Pagamentos"/);
  assert.match(dsl, /cliente -> loja "usa"/);
  assert.match(dsl, /views \{/);
});

test('renderDrawio inclui IDs estáveis e arestas conectadas', () => {
  const xml = renderDrawio(sampleGraph());
  assert.match(xml, /<mxfile/);
  assert.match(xml, /c4archElementId="p1"/);
  assert.match(xml, /c4archElementId="cp1"/);
  assert.match(xml, /source="c4arch-p1" target="c4arch-s1"/);
  assert.match(xml, /id="edge-e1"/);
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
