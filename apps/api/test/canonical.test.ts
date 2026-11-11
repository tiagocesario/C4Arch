import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIdentifier,
  computeContentHash,
  computeDasSourceHash,
  diffDasSections,
  elementKindFromLegacy,
  extractElementMetadata,
  extractTechnologyFromLabel,
  parseDasSections,
  toCanonicalElement,
  toCanonicalRelationship,
  viewTypeFromC4Type,
} from '../src/c4/canonical.js';

const ELEMENT_ID = '11111111-1111-4111-8111-111111111111';

test('mapeia tipos legados de elemento para kinds canônicos', () => {
  assert.equal(elementKindFromLegacy('actor'), 'person');
  assert.equal(elementKindFromLegacy('system'), 'software_system');
  assert.equal(elementKindFromLegacy('container'), 'container');
  assert.equal(elementKindFromLegacy('component'), 'component');
  assert.equal(elementKindFromLegacy('desconhecido'), 'component');
});

test('mapeia tipos de diagrama C4 para tipos de view canônicos', () => {
  assert.equal(viewTypeFromC4Type('system-context'), 'system_context');
  assert.equal(viewTypeFromC4Type('container'), 'container');
  assert.equal(viewTypeFromC4Type('component'), 'component');
  assert.equal(viewTypeFromC4Type('code'), 'component');
  assert.equal(viewTypeFromC4Type('system-landscape'), 'filtered');
  assert.equal(viewTypeFromC4Type('dynamic'), 'dynamic');
  assert.equal(viewTypeFromC4Type('deployment'), 'deployment');
});

test('gera identificador estável com slug e sufixo do UUID', () => {
  assert.equal(buildIdentifier('Serviço de Pagamentos', ELEMENT_ID), 'servico-de-pagamentos-11111111');
  assert.equal(buildIdentifier('!!!', ELEMENT_ID), 'element-11111111');
});

test('extrai tecnologia, URL, tags e propriedades restantes do metadata', () => {
  const metadata = {
    technology: ' Node.js ',
    url: 'https://example.com',
    tags: ['api', 'critico'],
    owner: 'arquitetura',
  };
  assert.deepEqual(extractElementMetadata(metadata), {
    technology: 'Node.js',
    url: 'https://example.com',
    tags: ['api', 'critico'],
    properties: { owner: 'arquitetura' },
  });
  assert.deepEqual(extractElementMetadata({ tags: 'a, b ,c' }).tags, ['a', 'b', 'c']);
});

test('converte elemento legado preservando UUID, vínculos e metadados', () => {
  const canonical = toCanonicalElement({
    id: ELEMENT_ID,
    model_id: '22222222-2222-4222-8222-222222222222',
    type: 'actor',
    title: '  Usuário  ',
    description: '  ',
    metadata: { technology: 'Humano', tags: ['externo'], extra: 1 },
    app_id: '33333333-3333-4333-8333-333333333333',
    service_id: null,
  });

  assert.equal(canonical.id, ELEMENT_ID);
  assert.equal(canonical.kind, 'person');
  assert.equal(canonical.name, 'Usuário');
  assert.equal(canonical.description, null);
  assert.equal(canonical.technology, 'Humano');
  assert.deepEqual(canonical.tags, ['externo']);
  assert.equal(canonical.app_id, '33333333-3333-4333-8333-333333333333');
  assert.deepEqual(canonical.properties, { extra: 1, legacyType: 'actor' });
});

test('converte aresta legada e extrai tecnologia entre colchetes', () => {
  const canonical = toCanonicalRelationship({
    id: '44444444-4444-4444-8444-444444444444',
    model_id: '22222222-2222-4222-8222-222222222222',
    from_id: ELEMENT_ID,
    to_id: '55555555-5555-4555-8555-555555555555',
    label: 'Chama [HTTP]',
    type: 'http',
  });

  assert.equal(canonical.description, 'Chama [HTTP]');
  assert.equal(canonical.technology, 'HTTP');
  assert.deepEqual(canonical.properties, { legacyType: 'http' });
  assert.equal(extractTechnologyFromLabel('sem tecnologia'), null);
});

test('hash de conteúdo é determinístico independentemente da ordem das chaves', () => {
  const a = computeContentHash({ a: 1, b: { c: 2, d: [3, 4] } });
  const b = computeContentHash({ b: { d: [3, 4], c: 2 }, a: 1 });
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
});

test('hash da fonte do DAS muda quando o override muda', () => {
  const base = computeDasSourceHash('sha256:model', [
    { section_key: '6.1', content: 'A', mode: 'replace' },
  ]);
  const changed = computeDasSourceHash('sha256:model', [
    { section_key: '6.1', content: 'B', mode: 'replace' },
  ]);
  assert.notEqual(base, changed);
});

test('divide o DAS em seções numeradas e identifica seções com filhos', () => {
  const sections = parseDasSections(`# DAS

## 1. Informações

## 2. Visão geral

### 2.1 Propósito

Texto.

### 2.2 Escopo

Mais texto.
`);
  assert.deepEqual(
    sections.map((section) => ({ key: section.key, hasChildren: section.hasChildren })),
    [
      { key: '1', hasChildren: false },
      { key: '2', hasChildren: true },
      { key: '2.1', hasChildren: false },
      { key: '2.2', hasChildren: false },
    ]
  );
});

test('diff do DAS cria override só nas seções folha editadas e ignora data/histórico', () => {
  const generated = `# DAS

> Gerado automaticamente pelo C4Arch em 01/01/2026, 10:00.

## 1. Informações do documento

| Data | 01/01/2026 |

## 2. Visão geral

### 2.1 Propósito

Propósito original.

## 6. Elementos e conexões do modelo

### 6.1 Elementos

| Elemento | Tipo |
|---|---|
| API | Container |

### 6.2 Conexões

| Origem | Destino |
|---|---|
| API | Banco |

## 10. Histórico

| Versão | Data |
|---|---|
| 0.3.0 | 01/01/2026 |
`;

  const edited = generated
    .replace('| API | Container |', '| API | Container editado |')
    .replace('| 0.3.0 | 01/01/2026 |', '| 0.3.0 | 02/01/2026 |');

  const diff = diffDasSections(generated, edited);
  assert.deepEqual(diff.changedKeys, ['6.1']);
  assert.equal(diff.overrides.length, 1);
  assert.equal(diff.overrides[0].mode, 'replace');
  assert.match(diff.overrides[0].content ?? '', /Container editado/);
});

test('diff do DAS usa override document quando não há seções reconhecíveis', () => {
  const diff = diffDasSections('texto gerado', 'texto manual sem seções');
  assert.deepEqual(diff.overrides, [
    { section_key: 'document', content: 'texto manual sem seções', mode: 'replace' },
  ]);
});
