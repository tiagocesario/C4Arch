import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import zlib from 'node:zlib';

const MAX_BYTES = 200_000;

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

function extractBody(text: string): string {
  const start = text.search(/@start\w*/i);
  const end = text.search(/@end\w*/i);
  if (start !== -1 && end !== -1 && end > start) {
    const firstLineEnd = text.indexOf('\n', start);
    const bodyStart = firstLineEnd === -1 ? text.length : firstLineEnd + 1;
    return text.slice(bodyStart, end).trim();
  }
  return text.trim();
}

function plantUmlEncode(text: string): string {
  const body = extractBody(text);
  const compressed = zlib.deflateRawSync(Buffer.from(body, 'utf8'));
  let result = '';
  for (let i = 0; i < compressed.length; i += 3) {
    const b1 = compressed[i];
    const b2 = i + 1 < compressed.length ? compressed[i + 1] : 0;
    const b3 = i + 2 < compressed.length ? compressed[i + 2] : 0;
    result += append3Bytes(b1, b2, b3);
  }
  return result;
}

export class PlantumlController {
  static async render(req: AuthenticatedRequest, res: Response) {
    const content = (req.body ?? {}).content;
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content obrigatório' });
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
      return res.status(413).json({ error: 'Conteúdo muito grande' });
    }
    const template =
      process.env.PLANTUML_RENDER_URL_TEMPLATE ||
      'https://www.plantuml.com/plantuml/svg/{encoded}';
    const encoded = plantUmlEncode(content);
    const url = template.replace('{encoded}', encoded);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(502).json({ error: `PlantUML server retornou ${response.status}` });
      }
      const svg = await response.text();
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(svg);
    } catch (err) {
      return res.status(502).json({ error: 'Falha ao renderizar PlantUML' });
    }
  }
}
