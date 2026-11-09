import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCatalogElement,
  collectCatalogCandidates,
} from '../src/c4/catalog-import.js';
import type { ParsedElement } from '../src/c4/das.js';

function element(overrides: Partial<ParsedElement>): ParsedElement {
  return {
    id: 'e1',
    name: 'Elemento',
    c4Kind: 'Software System',
    technology: '',
    description: '',
    ...overrides,
  };
}

test('classifyCatalogElement usa a natureza do rótulo quando presente', () => {
  assert.equal(classifyCatalogElement(element({ name: 'Pedidos', nature: 'app' })), 'app');
  assert.equal(classifyCatalogElement(element({ name: 'Pagamentos', nature: 'service' })), 'service');
});

test('classifyCatalogElement usa o marcador de asset com prioridade', () => {
  assert.equal(
    classifyCatalogElement(element({ name: 'Pedidos', c4Kind: 'Software System', assetKind: 'service' })),
    'service'
  );
  assert.equal(
    classifyCatalogElement(element({ name: 'Pagamentos', c4Kind: 'Service', assetKind: 'app' })),
    'app'
  );
});

test('classifyCatalogElement reconhece tipos de serviço e mantém apps como padrão', () => {
  assert.equal(classifyCatalogElement(element({ name: 'PayHub', c4Kind: 'Service' })), 'service');
  assert.equal(classifyCatalogElement(element({ name: 'Fila', c4Kind: 'Queue' })), 'service');
  assert.equal(classifyCatalogElement(element({ name: 'Legado', c4Kind: 'Software System' })), 'app');
  assert.equal(classifyCatalogElement(element({ name: 'Integrador', c4Kind: 'Component' })), 'app');
});

test('classifyCatalogElement ignora atores, boundaries e nomes não resolvidos', () => {
  assert.equal(classifyCatalogElement(element({ name: 'Cliente', c4Kind: 'Person' })), null);
  assert.equal(
    classifyCatalogElement(element({ name: 'Janis', c4Kind: 'ContainerScopeBoundary' })),
    null
  );
  assert.equal(classifyCatalogElement(element({ name: 'HTTPS', c4Kind: 'Elemento' })), null);
  assert.equal(
    classifyCatalogElement(element({ name: 'Container name', c4Kind: 'Container' })),
    null
  );
  assert.equal(classifyCatalogElement(element({ name: '[Software System]', c4Kind: 'Software System' })), null);
  assert.equal(classifyCatalogElement(element({ name: '%c4Name%', c4Kind: 'Software System' })), null);
});

test('collectCatalogCandidates deduplica por nome e completa campos vazios', () => {
  const candidates = collectCatalogCandidates([
    element({ id: 'a', name: 'Payments', c4Kind: 'Service', description: 'API de pagamentos' }),
    element({ id: 'b', name: ' payments ', c4Kind: 'Service', technology: 'Java' }),
    element({ id: 'c', name: 'Payments', c4Kind: 'Software System' }),
    element({ id: 'd', name: 'Vtex', c4Kind: 'Software System', description: 'E-commerce' }),
  ]);

  assert.equal(candidates.length, 2);
  const payments = candidates.find((candidate) => candidate.name === 'Payments');
  assert.equal(payments?.kind, 'service');
  assert.equal(payments?.description, 'API de pagamentos');
  assert.equal(payments?.technology, 'Java');
  assert.equal(candidates.find((candidate) => candidate.name === 'Vtex')?.kind, 'app');
});

test('collectCatalogCandidates não recria assets já vinculados', () => {
  const candidates = collectCatalogCandidates(
    [
      element({ id: 'a', name: 'Vtex', c4Kind: 'Software System', assetId: 'asset-1', assetKind: 'app' }),
      element({ id: 'b', name: 'Novo', c4Kind: 'Software System' }),
    ],
    new Set(['asset-1'])
  );

  assert.deepEqual(candidates.map((candidate) => candidate.name), ['Novo']);
});
