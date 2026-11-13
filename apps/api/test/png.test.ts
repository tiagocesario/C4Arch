import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { COLORS, Raster, encodePng } from '../src/c4/png.js';

const COLOR = [10, 20, 30, 255] as const;

test('Raster pinta pixels dentro dos limites', () => {
  const raster = new Raster(4, 4, [255, 255, 255, 255]);
  raster.fillRect(1, 1, 2, 2, COLOR);
  const at = (x: number, y: number) => {
    const index = (y * 4 + x) * 4;
    return [...raster.data.subarray(index, index + 4)];
  };
  assert.deepEqual(at(0, 0), [255, 255, 255, 255]);
  assert.deepEqual(at(1, 1), [...COLOR]);
  assert.deepEqual(at(2, 2), [...COLOR]);
  assert.deepEqual(at(3, 3), [255, 255, 255, 255]);
});

test('Raster ignora desenho fora dos limites', () => {
  const raster = new Raster(2, 2, [255, 255, 255, 255]);
  assert.doesNotThrow(() => {
    raster.fillRect(-5, -5, 20, 20, COLOR);
    raster.line(-10, -10, 10, 10, COLOR);
    raster.text(-4, -4, 'AB', COLOR);
  });
});

test('Raster strokeRect desenha apenas a borda', () => {
  const raster = new Raster(3, 3, [255, 255, 255, 255]);
  raster.strokeRect(0, 0, 3, 3, COLORS.border);
  const index = (1 * 3 + 1) * 4;
  assert.deepEqual([...raster.data.subarray(index, index + 4)], [255, 255, 255, 255]);
  assert.deepEqual([...raster.data.subarray(0, 4)], [...COLORS.border]);
});

test('encodePng gera assinatura, IHDR correto e IDAT inflável', () => {
  const raster = new Raster(8, 5, [12, 34, 56, 255]);
  raster.fillRect(0, 0, 8, 5, [12, 34, 56, 255]);
  const png = encodePng(raster);

  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 8);
  assert.equal(png.readUInt32BE(20), 5);
  assert.equal(png[24], 8); // bit depth
  assert.equal(png[25], 6); // RGBA

  const idatLength = png.readUInt32BE(33);
  assert.equal(png.subarray(37, 41).toString('ascii'), 'IDAT');
  const raw = inflateSync(png.subarray(41, 41 + idatLength));
  // 5 linhas, cada uma com 1 byte de filtro + 8 pixels * 4 canais.
  assert.equal(raw.length, 5 * (1 + 8 * 4));
  for (let row = 0; row < 5; row += 1) {
    assert.equal(raw[row * 33], 0);
  }
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString('ascii'), 'IEND');
});

test('encodePng é determinístico para o mesmo raster', () => {
  const first = new Raster(3, 3);
  first.text(0, 0, 'C4', COLORS.text);
  const second = new Raster(3, 3);
  second.text(0, 0, 'C4', COLORS.text);
  assert.deepEqual(encodePng(first), encodePng(second));
});
