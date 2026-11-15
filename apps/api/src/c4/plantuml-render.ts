import { deflateRawSync } from 'node:zlib';

/**
 * Codificação usada pelo servidor PlantUML para receber o diagrama na URL
 * (`/svg/{encoded}`): deflate raw + base64 com alfabeto próprio. O texto vai
 * completo, incluindo `@startuml`/`@enduml`, para preservar título e diretivas.
 */

function encode6bit(value: number): string {
  if (value < 10) return String.fromCharCode(48 + value);
  value -= 10;
  if (value < 26) return String.fromCharCode(65 + value);
  value -= 26;
  if (value < 26) return String.fromCharCode(97 + value);
  value -= 26;
  if (value === 0) return '-';
  if (value === 1) return '_';
  return '?';
}

function append3Bytes(b1: number, b2: number, b3: number): string {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3f;
  return encode6bit(c1) + encode6bit(c2) + encode6bit(c3) + encode6bit(c4);
}

export function encodePlantUml(text: string): string {
  const compressed = deflateRawSync(Buffer.from(text, 'utf8'));
  let result = '';
  for (let i = 0; i < compressed.length; i += 3) {
    const b1 = compressed[i];
    const b2 = i + 1 < compressed.length ? compressed[i + 1] : 0;
    const b3 = i + 2 < compressed.length ? compressed[i + 2] : 0;
    result += append3Bytes(b1, b2, b3);
  }
  return result;
}
