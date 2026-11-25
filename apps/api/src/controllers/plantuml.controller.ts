import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import { encodePlantUml, ensureC4Include } from '../c4/plantuml-render.js';

/** O parser global de JSON limita o corpo a 100 kB; mantemos margem abaixo disso. */
const MAX_CONTENT_BYTES = 100_000;
const RENDER_TIMEOUT_MS = 15_000;
const DEFAULT_TEMPLATE = 'https://www.plantuml.com/plantuml/svg/{encoded}';

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

    const url = template.replace('{encoded}', encodePlantUml(ensureC4Include(content)));
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
      const body = await response.text().catch(() => '');
      if (contentType.includes('svg') && body.includes('<svg')) {
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(body);
      }
      return res.status(502).json({ error: `PlantUML server retornou ${response.status}` });
    }

    let svg: string;
    try {
      svg = await response.text();
    } catch {
      return res.status(502).json({ error: 'Falha ao ler a resposta do PlantUML' });
    }
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(svg);
  }
}
