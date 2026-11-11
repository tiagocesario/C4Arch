import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { extractDiagramLayout } from '../src/c4/diagram-layout.js';

const ELEMENT_ID = '11111111-1111-4111-8111-111111111111';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram id="page-1" name="Container">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <object id="obj-api" label="[Container: API REST]" c4archElementId="${ELEMENT_ID}">
          <mxCell id="cell-api" vertex="1" parent="1" style="rounded=1;whiteSpace=wrap;html=1;">
            <mxGeometry x="10" y="20" width="120" height="60" as="geometry" />
          </mxCell>
        </object>
        <mxCell id="cell-db" vertex="1" value="Banco de dados" parent="1" style="shape=cylinder;html=1;">
          <mxGeometry x="200" y="30" width="80" height="100" as="geometry" />
        </mxCell>
        <mxCell id="edge-1" edge="1" source="cell-api" target="cell-db" parent="1">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

test('extrai geometria de objetos e células nativas do draw.io', () => {
  const shapes = extractDiagramLayout(XML);
  assert.equal(shapes.length, 2);

  const api = shapes.find((shape) => shape.objectKey === 'obj-api');
  assert.ok(api);
  assert.equal(api.elementRef, ELEMENT_ID);
  assert.equal(api.name, 'API REST');
  assert.equal(api.x, 10);
  assert.equal(api.y, 20);
  assert.equal(api.width, 120);
  assert.equal(api.height, 60);
  assert.deepEqual(api.style, { drawio: 'rounded=1;whiteSpace=wrap;html=1;' });

  const db = shapes.find((shape) => shape.objectKey === 'cell-db');
  assert.ok(db);
  assert.equal(db.elementRef, null);
  assert.equal(db.name, 'Banco de dados');
  assert.equal(db.x, 200);
  assert.equal(db.y, 30);
  assert.equal(db.width, 80);
  assert.equal(db.height, 100);
});

test('extrai layout de diagramas comprimidos do draw.io', () => {
  const inner = XML.replace(/^[\s\S]*?<diagram[^>]*>/, '').replace(/<\/diagram>[\s\S]*$/, '');
  const compressed = deflateRawSync(Buffer.from(encodeURIComponent(inner), 'utf8')).toString(
    'base64'
  );
  const compressedXml = `<mxfile host="app.diagrams.net"><diagram id="page-1" name="Container">${compressed}</diagram></mxfile>`;

  const shapes = extractDiagramLayout(compressedXml);
  assert.equal(shapes.length, 2);
  assert.equal(shapes.find((shape) => shape.objectKey === 'obj-api')?.elementRef, ELEMENT_ID);
});

test('retorna lista vazia para XML ausente ou sem vértices', () => {
  assert.deepEqual(extractDiagramLayout(null), []);
  assert.deepEqual(extractDiagramLayout(''), []);
  assert.deepEqual(extractDiagramLayout('<mxGraphModel><root><mxCell id="0" /></root></mxGraphModel>'), []);
});

test('desambigua chaves repetidas de células', () => {
  const xml = `<mxGraphModel><root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="dup" vertex="1" value="A" parent="1"><mxGeometry x="1" y="1" width="10" height="10" as="geometry" /></mxCell>
    <mxCell id="dup" vertex="1" value="B" parent="1"><mxGeometry x="2" y="2" width="10" height="10" as="geometry" /></mxCell>
  </root></mxGraphModel>`;

  const shapes = extractDiagramLayout(xml);
  assert.deepEqual(
    shapes.map((shape) => shape.objectKey),
    ['dup', 'dup#2']
  );
});
