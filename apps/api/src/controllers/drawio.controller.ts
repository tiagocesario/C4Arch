import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { pool } from '../db.js';

export class DrawioController {
  static async export(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const result = await pool.query('SELECT drawio_xml FROM models WHERE id = $1', [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Modelo não encontrado' });
      const xml = result.rows[0].drawio_xml;
      if (!xml) return res.status(404).json({ error: 'Modelo ainda não possui diagrama draw.io' });
      res.setHeader('Content-Type', 'application/xml');
      res.send(xml);
    } catch (err) {
      console.error('[drawio] export error', err);
      res.status(500).json({ error: 'Erro ao exportar draw.io' });
    }
  }

  static async import(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const xml = req.body?.xml as string | undefined;
      if (!xml) return res.status(400).json({ error: 'xml é obrigatório' });
      const result = await pool.query('UPDATE models SET drawio_xml = $1, updated_at = NOW() WHERE id = $2 RETURNING id', [xml, id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Modelo não encontrado' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[drawio] import error', err);
      res.status(500).json({ error: 'Erro ao importar draw.io' });
    }
  }

  static async editor(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const result = await pool.query('SELECT title, drawio_xml FROM models WHERE id = $1', [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Modelo não encontrado' });
      const { title, drawio_xml } = result.rows[0];
      const xml = drawio_xml || `<mxfile host="c4arch" modified="${new Date().toISOString()}" agent="C4Arch" version="1.0"><diagram id="${id}" name="${title}"></diagram></mxfile>`;
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${title} — C4Arch</title></head><body><textarea id="xml" style="width:100%;height:100vh">${xml.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea></body></html>`;
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (err) {
      console.error('[drawio] editor error', err);
      res.status(500).json({ error: 'Erro ao abrir editor draw.io' });
    }
  }
}
