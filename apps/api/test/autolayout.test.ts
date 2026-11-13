import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAutoLayout, hasStoredLayout } from '../src/c4/autolayout.js';

const nodes = [
  { id: 'a', type: 'actor', title: 'Cliente' },
  { id: 's', type: 'system', title: 'Sistema' },
  { id: 'c', type: 'container', title: 'API' },
  { id: 'k', type: 'component', title: 'Componente' },
];

const edges = [
  { from: 'a', to: 's' },
  { from: 's', to: 'c' },
  { from: 'c', to: 'k' },
];

test('computeAutoLayout retorna vazio sem nós', () => {
  assert.deepEqual(computeAutoLayout([], []), []);
});

test('computeAutoLayout respeita a ordem das camadas C4 em LR', () => {
  const positions = computeAutoLayout(nodes, edges, { direction: 'LR' });
  const byId = new Map(positions.map((position) => [position.id, position]));
  assert.ok(byId.get('a')!.x < byId.get('s')!.x);
  assert.ok(byId.get('s')!.x < byId.get('c')!.x);
  assert.ok(byId.get('c')!.x < byId.get('k')!.x);
});

test('computeAutoLayout usa eixo Y em TB', () => {
  const positions = computeAutoLayout(nodes, edges, { direction: 'TB' });
  const byId = new Map(positions.map((position) => [position.id, position]));
  assert.ok(byId.get('a')!.y < byId.get('s')!.y);
  assert.ok(byId.get('s')!.y < byId.get('c')!.y);
});

test('computeAutoLayout é determinístico e não perde nós', () => {
  const first = computeAutoLayout(nodes, edges);
  const second = computeAutoLayout(nodes, edges);
  assert.deepEqual(first, second);
  assert.equal(first.length, nodes.length);
  assert.equal(new Set(first.map((position) => position.id)).size, nodes.length);
});

test('computeAutoLayout lida com ciclos sem loop infinito', () => {
  const cyclic = [
    { from: 'a', to: 's' },
    { from: 's', to: 'c' },
    { from: 'c', to: 'a' },
  ];
  const positions = computeAutoLayout(nodes, cyclic);
  assert.equal(positions.length, 4);
});

test('computeAutoLayout ignora arestas com pontas desconhecidas e auto-arestas', () => {
  const positions = computeAutoLayout(
    [{ id: 'x', type: 'system' }],
    [
      { from: 'x', to: 'missing' },
      { from: 'missing', to: 'x' },
      { from: 'x', to: 'x' },
    ]
  );
  assert.deepEqual(positions, [{ id: 'x', x: 0, y: 0 }]);
});

test('hasStoredLayout detecta posições não nulas', () => {
  assert.equal(hasStoredLayout([{ position_x: 0, position_y: 0 }]), false);
  assert.equal(hasStoredLayout([{ position_x: 0, position_y: 0 }, { position_x: 10, position_y: 0 }]), true);
});
