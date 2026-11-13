import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, markdownToHtml } from '../src/utils/markdown';
import { buildDasFromSections, parseDasSections } from '../src/utils/das';
import { nameFromImportUrl, normalizeText, stripFileExtension } from '../src/utils/text';
import { C4_TYPE_HELP, C4_TYPE_LABEL } from '../src/utils/c4';
import { C4_MODEL_TYPES } from '../src/services/types';

test('markdownToHtml escapa HTML e formata título, negrito e código', () => {
  const html = markdownToHtml('# Título\n\nTexto **forte** e `<script>`');
  assert.match(html, /<h1>Título<\/h1>/);
  assert.match(html, /<strong>forte<\/strong>/);
  assert.match(html, /<code>&lt;script&gt;<\/code>/);
  assert.doesNotMatch(html, /<script>/);
});

test('markdownToHtml monta tabelas, listas, citações e régua', () => {
  const html = markdownToHtml(
    ['| A | B |', '| --- | --- |', '| 1 | 2 |', '', '- um', '- dois', '', '> nota', '', '---'].join(
      '\n'
    )
  );
  assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>1<\/td><td>2<\/td>/);
  assert.match(html, /<ul><li>um<\/li><li>dois<\/li><\/ul>/);
  assert.match(html, /<blockquote>nota<\/blockquote>/);
  assert.match(html, /<hr\/>/);
});

test('escapeHtml cobre os cinco caracteres perigosos', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('parseDasSections separa preâmbulo e seções nivel 2', () => {
  const parsed = parseDasSections('# Doc\n\n## 1. Visão\n\nA\n\n## 2. Contexto\n\nB');
  assert.equal(parsed.sections.length, 2);
  assert.equal(parsed.sections[0].heading, '1. Visão');
  assert.equal(parsed.sections[0].body.trim(), 'A');
  assert.match(parsed.preamble, /# Doc/);
});

test('buildDasFromSections reconstrói o documento', () => {
  const doc = '# Doc\n\n## 1. Visão\n\nA\n\n## 2. Contexto\n\nB';
  const parsed = parseDasSections(doc);
  const rebuilt = buildDasFromSections(parsed.preamble, parsed.sections);
  const reparsed = parseDasSections(rebuilt);
  assert.equal(reparsed.sections.length, 2);
  assert.equal(reparsed.sections[0].body.trim(), 'A');
  assert.equal(reparsed.sections[1].body.trim(), 'B');
  assert.match(rebuilt, /## 1\. Visão/);
});

test('normalizeText ignora caixa e acentos', () => {
  assert.equal(normalizeText('  Serviço de Pagamentos '), 'servico de pagamentos');
  assert.equal(normalizeText(null), '');
});

test('stripFileExtension remove sufixos draw.io', () => {
  assert.equal(stripFileExtension('sistema.drawio.xml'), 'sistema');
  assert.equal(stripFileExtension('sistema.drawio'), 'sistema');
  assert.equal(stripFileExtension('sistema.xml'), 'sistema');
});

test('nameFromImportUrl extrai nome de links do Drive e URLs genéricas', () => {
  assert.equal(
    nameFromImportUrl('https://drive.google.com/file/d/abc123def456/view'),
    'Modelo importado abc123de'
  );
  assert.equal(
    nameFromImportUrl('https://exemplo.com/modelos/checkout.drawio.xml'),
    'checkout'
  );
  assert.equal(nameFromImportUrl('nao-e-url'), 'Modelo importado');
});

test('rótulos e ajuda cobrem todos os tipos C4', () => {
  for (const type of C4_MODEL_TYPES) {
    assert.ok(C4_TYPE_LABEL[type], `rótulo ausente para ${type}`);
    assert.ok(C4_TYPE_HELP[type], `ajuda ausente para ${type}`);
  }
});
