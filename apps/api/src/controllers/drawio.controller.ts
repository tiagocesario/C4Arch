import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { signDrawioToken } from '../auth/tokens.js';
import { getModelAccess } from '../auth/access.js';
import { pool } from '../db.js';

const MAX_XML_LENGTH = 100_000;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXmlAttribute(value: unknown): string {
  return escapeHtml(value);
}

export class DrawioController {
  /** Emite um token escopado de 5 minutos para abrir o editor no navegador. */
  static async token(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const token = signDrawioToken(req.user!.id, req.user!.email, id);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ token, expiresIn: 300 });
    } catch (err) {
      console.error('[drawio] token error', err);
      return res.status(500).json({ error: 'Erro ao autorizar draw.io' });
    }
  }

  static async export(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const result = await pool.query('SELECT drawio_xml FROM models WHERE id = $1', [id]);
      const xml = result.rows[0]?.drawio_xml;
      if (!xml) {
        return res.status(404).json({ error: 'Modelo ainda não possui diagrama draw.io' });
      }

      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="model.xml"');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(xml);
    } catch (err) {
      console.error('[drawio] export error', err);
      return res.status(500).json({ error: 'Erro ao exportar draw.io' });
    }
  }

  static async import(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const xml = req.body?.xml as unknown;

    if (typeof xml !== 'string' || !xml.trim()) {
      return res.status(400).json({ error: 'xml é obrigatório' });
    }
    if (xml.length > MAX_XML_LENGTH) {
      return res.status(413).json({ error: 'XML muito grande' });
    }
    if (!xml.trimStart().startsWith('<')) {
      return res.status(400).json({ error: 'XML inválido' });
    }

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      await pool.query('UPDATE models SET drawio_xml = $1, updated_at = NOW() WHERE id = $2', [
        xml,
        id,
      ]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[drawio] import error', err);
      return res.status(500).json({ error: 'Erro ao importar draw.io' });
    }
  }

  static async editor(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const result = await pool.query('SELECT title, drawio_xml FROM models WHERE id = $1', [id]);
      const { title, drawio_xml } = result.rows[0];
      const xml =
        drawio_xml ||
        `<mxfile host="c4arch" modified="${new Date().toISOString()}" agent="C4Arch" version="1.0"><diagram id="${escapeXmlAttribute(id)}" name="${escapeXmlAttribute(title)}"></diagram></mxfile>`;

      const pageId = `c4arch-${id}`;
      const drawioUrl = `https://embed.diagrams.net/?pages=1&client=sketch21&ui=&property=1&mode=free&startPage=1&page-id=${encodeURIComponent(pageId)}&zoom=100&fonts=default&nav=1&highlight=0&curid=&theme=default&diagram=${encodeURIComponent(xml.replace(/\n/g, ''))}`;
      const safeTitle = escapeHtml(title ?? 'Modelo');

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="referrer" content="no-referrer"/>
  <title>${safeTitle} — C4Arch</title>
  <style>
    body { display:flex; flex-direction:column; height:100vh; margin:0; background:#0f1115; color:#e8eaed; font-family: sans-serif; }
    header { padding:8px 12px; border-bottom:1px solid #2a2f3a; }
    header h1 { margin:0; font-size:16px; }
    .controls { display:flex; gap:8px; margin-top:8px; }
    .controls a { padding:6px 10px; background:#2a2f3a; color:#e8eaed; border:none; border-radius:6px; cursor:pointer; text-decoration:none; font-size:13px; }
    .drawio-frame { flex:1; background:#000; border:none; }
  </style>
</head>
<body>
  <header>
    <h1>${safeTitle}</h1>
    <div class="controls">
      <a href="${escapeHtml(drawioUrl)}" target="_blank" rel="noopener noreferrer">Abrir draw.io</a>
      <a href="data:text/xml;charset=utf-8,${encodeURIComponent(xml)}" download="model.xml">Exportar XML</a>
    </div>
  </header>
  <iframe class="drawio-frame" src="${escapeHtml(drawioUrl)}" title="Draw.io diagram"></iframe>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; frame-src https://embed.diagrams.net; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      );
      return res.send(html);
    } catch (err) {
      console.error('[drawio] editor error', err);
      return res.status(500).json({ error: 'Erro ao abrir editor draw.io' });
    }
  }
}
