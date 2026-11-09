import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDrawio } from '../src/c4/das.js';

test('parseDrawio retorna estrutura vazia para XML ausente', () => {
  assert.deepEqual(parseDrawio(null), { shapes: [], edges: [], elements: [] });
  assert.deepEqual(parseDrawio(''), { shapes: [], edges: [], elements: [] });
});

test('parseDrawio extrai vértices e arestas nativas do draw.io', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram name="Container">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="a" value="Usuário" vertex="1" parent="1" />
        <mxCell id="b" value="API REST" vertex="1" parent="1" />
        <mxCell id="e" value="chama" edge="1" source="a" target="b" parent="1" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

  const parsed = parseDrawio(xml);
  assert.equal(parsed.elements.length, 2);
  assert.deepEqual(parsed.shapes, ['Usuário', 'API REST']);
  assert.equal(parsed.edges.length, 1);
  assert.equal(parsed.edges[0].source, 'Usuário');
  assert.equal(parsed.edges[0].target, 'API REST');
  assert.equal(parsed.edges[0].label, 'chama');
});

test('parseDrawio lê objetos com metadados c4 e decodifica entidades', () => {
  const xml = `<mxGraphModel><root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <object id="svc" label="[Componente: Pagamentos &amp; Cobrança]&lt;br&gt;Aplicação&lt;br&gt;%c4Technology% — %c4Description%" c4Type="Componente" c4Technology="Node.js" c4Description="Processa pagamentos">
      <mxCell vertex="1" parent="1" />
    </object>
  </root></mxGraphModel>`;

  const parsed = parseDrawio(xml);
  assert.equal(parsed.elements.length, 1);
  assert.equal(parsed.elements[0].name, 'Pagamentos & Cobrança');
  assert.equal(parsed.elements[0].c4Kind, 'Componente');
  assert.equal(parsed.elements[0].technology, 'Node.js');
  assert.equal(parsed.elements[0].description, 'Processa pagamentos');
});

test('parseDrawio resolve %c4Name% a partir do atributo c4Name e mantém a natureza', () => {
  const xml = `<mxGraphModel><root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <object id="svc" label="%c4Name%&lt;br&gt;[%c4Type%]&lt;br&gt;Serviço http:8080&lt;br&gt;%c4Technology% — %c4Description%" c4Name="PayHub" c4Type="Container" c4Technology="Node.js" c4Description="Processa pagamentos">
      <mxCell vertex="1" parent="1" />
    </object>
  </root></mxGraphModel>`;

  const parsed = parseDrawio(xml);
  assert.equal(parsed.elements.length, 1);
  assert.equal(parsed.elements[0].name, 'PayHub');
  assert.equal(parsed.elements[0].c4Kind, 'Container');
  assert.equal(parsed.elements[0].nature, 'service');
  assert.equal(parsed.elements[0].technology, 'http:8080');
});

test('parseDrawio remove o tipo entre colchetes do nome do elemento', () => {
  const xml = `<mxGraphModel><root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <object id="sys" label="Site / App [Software System]&lt;br&gt;%c4Description%" c4Type="Software System" c4Description="E-commerce">
      <mxCell vertex="1" parent="1" />
    </object>
  </root></mxGraphModel>`;

  const parsed = parseDrawio(xml);
  assert.equal(parsed.elements.length, 1);
  assert.equal(parsed.elements[0].name, 'Site / App');
  assert.equal(parsed.elements[0].c4Kind, 'Software System');
  assert.equal(parsed.elements[0].description, 'E-commerce');
});
