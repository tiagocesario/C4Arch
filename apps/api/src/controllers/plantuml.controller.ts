import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import { encodePlantUml } from '../c4/plantuml-render.js';
import { sanitizeSvg } from '../security/svg.js';

/** O parser global de JSON limita o corpo a 100 kB; mantemos margem abaixo disso. */
const MAX_CONTENT_BYTES = 100_000;
/** Limite do SVG devolvido pelo renderizador externo (proteção de memória). */
const MAX_RESPONSE_BYTES = 2_000_000;
const RENDER_TIMEOUT_MS = 15_000;
const DEFAULT_TEMPLATE = 'https://www.plantuml.com/plantuml/svg/{encoded}';

/**
 * Lê a resposta como texto respeitando um teto de bytes. `Response.text()` não
 * impõe limite e um renderizador comprometido poderia devolver gigabytes.
 */
async function readLimitedText(
  response: globalThis.Response,
  limit: number
): Promise<string | null> {
  const body = response.body;
  if (!body) return '';

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    // Stream abortado/erro de rede: o chamador responde 502.
    return null;
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString('utf8');
}

function sendSvg(res: Response, svg: string) {
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Imagem estática para `<img>`; se aberta diretamente, vira download e a CSP
  // impede qualquer script caso o navegador renderize mesmo assim.
  res.setHeader('Content-Disposition', 'attachment; filename="diagram.svg"');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  );
  return res.send(sanitizeSvg(svg));
}

export class PlantumlController {
  static async render(req: AuthenticatedRequest, res: Response) {
    const content = req.body?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content obrigatório' });
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
      return res.status(413).json({ error: 'Conteúdo muito grande' });
    }

    const template = (process.env.PLANTUML_RENDER_URL_TEMPLATE || DEFAULT_TEMPLATE).trim();
    if (!template.includes('{encoded}')) {
      return res
        .status(500)
        .json({ error: 'PLANTUML_RENDER_URL_TEMPLATE deve conter o marcador {encoded}' });
    }

    const url = template.replace('{encoded}', encodePlantUml(content));
    let response: globalThis.Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(RENDER_TIMEOUT_MS) });
    } catch {
      return res.status(502).json({ error: 'Falha ao renderizar PlantUML' });
    }
    if (!response.ok) {
      // O servidor PlantUML responde 400 com um SVG que desenha o erro de
      // sintaxe. Encaminhar esse SVG permite ao usuário ver e corrigir o
      // problema no próprio painel, em vez de receber só "retornou 400".
      const contentType = response.headers.get('content-type') ?? '';
      const body = await readLimitedText(response, MAX_RESPONSE_BYTES);
      if (body === null) {
        return res.status(502).json({ error: 'Resposta do PlantUML inválida ou muito grande' });
      }
      if (contentType.includes('svg') && body.includes('<svg')) {
        return sendSvg(res, body);
      }
      return res.status(502).json({ error: `PlantUML server retornou ${response.status}` });
    }

    const svg = await readLimitedText(response, MAX_RESPONSE_BYTES);
    if (svg === null) {
      return res.status(502).json({ error: 'Resposta do PlantUML inválida ou muito grande' });
    }
    if (!svg.includes('<svg')) {
      return res.status(502).json({ error: 'PlantUML não retornou um SVG' });
    }
    return sendSvg(res, svg);
  }
}
