import { deflateSync } from 'node:zlib';

/**
 * Rasterizador mínimo para exportação PNG server-side.
 *
 * Evita dependências nativas (canvas/sharp): desenha caixas, linhas e rótulos
 * com uma fonte bitmap 3x5 e codifica o PNG manualmente (zlib + CRC32).
 * O resultado é determinístico e suficiente para preview/embed.
 */

export type Rgba = readonly [number, number, number, number];

export const COLORS = {
  background: [255, 255, 255, 255] as Rgba,
  text: [30, 41, 59, 255] as Rgba,
  muted: [100, 116, 139, 255] as Rgba,
  line: [71, 85, 105, 255] as Rgba,
  actor: [254, 240, 138, 255] as Rgba,
  system: [191, 219, 254, 255] as Rgba,
  container: [187, 247, 208, 255] as Rgba,
  component: [233, 213, 255, 255] as Rgba,
  border: [51, 65, 85, 255] as Rgba,
};

const FONT: Record<string, number[]> = {
  A: [0b111, 0b101, 0b111, 0b101, 0b101],
  B: [0b110, 0b101, 0b110, 0b101, 0b110],
  C: [0b111, 0b100, 0b100, 0b100, 0b111],
  D: [0b110, 0b101, 0b101, 0b101, 0b110],
  E: [0b111, 0b100, 0b110, 0b100, 0b111],
  F: [0b111, 0b100, 0b110, 0b100, 0b100],
  G: [0b111, 0b100, 0b101, 0b101, 0b111],
  H: [0b101, 0b101, 0b111, 0b101, 0b101],
  I: [0b111, 0b010, 0b010, 0b010, 0b111],
  J: [0b001, 0b001, 0b001, 0b101, 0b111],
  K: [0b101, 0b101, 0b110, 0b101, 0b101],
  L: [0b100, 0b100, 0b100, 0b100, 0b111],
  M: [0b101, 0b111, 0b111, 0b101, 0b101],
  N: [0b101, 0b111, 0b111, 0b111, 0b101],
  O: [0b111, 0b101, 0b101, 0b101, 0b111],
  P: [0b111, 0b101, 0b111, 0b100, 0b100],
  Q: [0b111, 0b101, 0b101, 0b111, 0b001],
  R: [0b111, 0b101, 0b110, 0b101, 0b101],
  S: [0b111, 0b100, 0b111, 0b001, 0b111],
  T: [0b111, 0b010, 0b010, 0b010, 0b010],
  U: [0b101, 0b101, 0b101, 0b101, 0b111],
  V: [0b101, 0b101, 0b101, 0b101, 0b010],
  W: [0b101, 0b101, 0b111, 0b111, 0b101],
  X: [0b101, 0b101, 0b010, 0b101, 0b101],
  Y: [0b101, 0b101, 0b010, 0b010, 0b010],
  Z: [0b111, 0b001, 0b010, 0b100, 0b111],
  '0': [0b111, 0b101, 0b101, 0b101, 0b111],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111],
  '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
  '7': [0b111, 0b001, 0b001, 0b001, 0b001],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  ' ': [0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0b010],
  ',': [0, 0, 0, 0b010, 0b100],
  '-': [0, 0, 0b111, 0, 0],
  '_': [0, 0, 0, 0, 0b111],
  '/': [0b001, 0b001, 0b010, 0b100, 0b100],
  ':': [0, 0b010, 0, 0b010, 0],
  ';': [0, 0b010, 0, 0b010, 0b100],
  '(': [0b001, 0b010, 0b010, 0b010, 0b001],
  ')': [0b100, 0b010, 0b010, 0b010, 0b100],
  '[': [0b011, 0b010, 0b010, 0b010, 0b011],
  ']': [0b110, 0b010, 0b010, 0b010, 0b110],
  '+': [0, 0b010, 0b111, 0b010, 0],
  '=': [0, 0b111, 0, 0b111, 0],
  '?': [0b111, 0b001, 0b011, 0, 0b010],
  '!': [0b010, 0b010, 0b010, 0, 0b010],
  '#': [0b101, 0b111, 0b101, 0b111, 0b101],
  '@': [0b111, 0b101, 0b111, 0b100, 0b111],
  '%': [0b101, 0b001, 0b010, 0b100, 0b101],
  '&': [0b110, 0b110, 0b101, 0b101, 0b111],
  '*': [0, 0b101, 0b010, 0b101, 0],
};

function normalizeChar(char: string): string {
  const normalized = char.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const upper = normalized.toUpperCase();
  return FONT[upper] ? upper : '?';
}

export class Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, background: Rgba = COLORS.background) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
    this.fillRect(0, 0, width, height, background);
  }

  private setPixel(x: number, y: number, color: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const index = (y * this.width + x) * 4;
    this.data[index] = color[0];
    this.data[index + 1] = color[1];
    this.data[index + 2] = color[2];
    this.data[index + 3] = color[3];
  }

  fillRect(x: number, y: number, width: number, height: number, color: Rgba): void {
    for (let row = y; row < y + height; row += 1) {
      for (let col = x; col < x + width; col += 1) {
        this.setPixel(col, row, color);
      }
    }
  }

  strokeRect(x: number, y: number, width: number, height: number, color: Rgba): void {
    for (let col = x; col < x + width; col += 1) {
      this.setPixel(col, y, color);
      this.setPixel(col, y + height - 1, color);
    }
    for (let row = y; row < y + height; row += 1) {
      this.setPixel(x, row, color);
      this.setPixel(x + width - 1, row, color);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, color: Rgba, thickness = 1): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const targetX = Math.round(x1);
    const targetY = Math.round(y1);
    const dx = Math.abs(targetX - x);
    const dy = Math.abs(targetY - y);
    const sx = x < targetX ? 1 : -1;
    const sy = y < targetY ? 1 : -1;
    let error = dx - dy;

    for (;;) {
      for (let ox = 0; ox < thickness; ox += 1) {
        for (let oy = 0; oy < thickness; oy += 1) {
          this.setPixel(x + ox, y + oy, color);
        }
      }
      if (x === targetX && y === targetY) break;
      const doubled = error * 2;
      if (doubled > -dy) {
        error -= dy;
        x += sx;
      }
      if (doubled < dx) {
        error += dx;
        y += sy;
      }
    }
  }

  text(x: number, y: number, value: string, color: Rgba, scale = 2): void {
    let cursor = Math.round(x);
    for (const char of value) {
      const glyph = FONT[normalizeChar(char)] ?? FONT['?'];
      for (let row = 0; row < 5; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          if ((glyph[row] >> (2 - col)) & 1) {
            this.fillRect(cursor + col * scale, y + row * scale, scale, scale, color);
          }
        }
      }
      cursor += 4 * scale;
    }
  }

  textWidth(value: string, scale = 2): number {
    return value.length * 4 * scale;
  }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = crc & 1 ? 0xedb88320 : 0;
      crc = (crc >>> 1) ^ mask;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

export function encodePng(raster: Raster): Buffer {
  const { width, height, data } = raster;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * (stride + 1);
    raw[offset] = 0;
    raw.set(data.subarray(row * stride, (row + 1) * stride), offset + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
