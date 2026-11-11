import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDasOverrides,
  diffDasSections,
  parseDasSections,
} from '../src/c4/canonical.js';

const GENERATED = `# Documento

## 1. Informações

| Campo | Valor |
|---|---|
| Projeto | X |

## 6. Elementos e conexões

### 6.1 Elementos

| Elemento |
|---|
| Sistema |

### 6.2 Conexões

_Nenhuma conexão._

## 7. Modelo de dados

_A definir._
`;

test('parseDasSections expõe os limites de linha', () => {
  const sections = parseDasSections(GENERATED);
  const section61 = sections.find((section) => section.key === '6.1');
  assert.ok(section61);
  assert.ok(section61.startLine < section61.endLine);
  assert.equal(section61.hasChildren, false);

  const section6 = sections.find((section) => section.key === '6');
  assert.ok(section6);
  assert.equal(section6.hasChildren, true);
});

test('applyDasOverrides substitui, anexa e oculta seções folha', () => {
  const replaced = applyDasOverrides(GENERATED, [
    { section_key: '6.1', content: '### 6.1 Elementos\n\nTabela editada.', mode: 'replace' },
  ]);
  assert.match(replaced, /Tabela editada\./);
  assert.doesNotMatch(replaced, /\| Sistema \|/);

  const appended = applyDasOverrides(GENERATED, [
    { section_key: '6.2', content: 'Linha adicional.', mode: 'append' },
  ]);
  assert.match(appended, /_Nenhuma conexão\._\n\nLinha adicional\./);

  const hidden = applyDasOverrides(GENERATED, [
    { section_key: '7', content: null, mode: 'hide' },
  ]);
  assert.doesNotMatch(hidden, /## 7\. Modelo de dados/);
  assert.match(hidden, /### 6\.2 Conexões/);
});

test('diffDasSections e applyDasOverrides preservam a edição por seção', () => {
  const edited = GENERATED.replace(
    '| Sistema |',
    '| Sistema |\n| API |'
  );
  const diff = diffDasSections(GENERATED, edited);
  assert.deepEqual(diff.changedKeys, ['6.1']);

  const roundTrip = applyDasOverrides(GENERATED, diff.overrides);
  assert.equal(roundTrip.replace(/\s+/g, ' ').trim(), edited.replace(/\s+/g, ' ').trim());
});

test('seções voláteis (1 e 10) nunca viram override', () => {
  const edited = GENERATED.replace('| Projeto | X |', '| Projeto | Y |');
  const diff = diffDasSections(GENERATED, edited);
  assert.deepEqual(diff.changedKeys, []);
});

test('documento inteiro vira override quando não há seções reconhecíveis', () => {
  const diff = diffDasSections('texto sem seções', 'texto editado');
  assert.equal(diff.overrides.length, 1);
  assert.equal(diff.overrides[0].section_key, 'document');
});
