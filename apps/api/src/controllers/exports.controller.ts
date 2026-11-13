import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import { getModelAccess } from '../auth/access.js';
import { loadModelGraph } from '../c4/model-graph.js';
import {
  EXPORT_FORMATS,
  exportModel,
  type ExportFormat,
  type ExportOptions,
} from '../c4/exporters.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FORMAT_SET = new Set<string>(EXPORT_FORMATS.map((item) => item.format));

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function parseOptions(req: AuthenticatedRequest): ExportOptions {
  const theme = req.query.theme === 'dark' ? 'dark' : 'light';
  const legend = req.query.legend !== '0' && req.query.legend !== 'false';
  return { theme, legend };
}

export class ExportController {
  /** Lista os formatos suportados (para o painel de exportação da UI). */
  static async formats(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      return res.json({
        modelId: id,
        formats: EXPORT_FORMATS.map((item) => ({
          format: item.format,
          label: item.label,
          contentType: item.contentType,
          extension: item.extension,
          url: `/api/models/${id}/export/${item.format}`,
          previewUrl:
            item.format === 'svg' || item.format === 'png'
              ? `/api/models/${id}/preview?format=${item.format}`
              : null,
        })),
      });
    } catch (err) {
      console.error('[exports] formats error', err);
      return res.status(500).json({ error: 'Erro ao listar formatos' });
    }
  }

  /** Exporta o modelo no formato pedido. */
  static async export(req: AuthenticatedRequest, res: Response) {
    const { id, format } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    if (!FORMAT_SET.has(format)) {
      return res.status(400).json({ error: 'Formato de exportação inválido' });
    }

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const graph = await loadModelGraph(id);
      if (!graph) return res.status(404).json({ error: 'Modelo não encontrado' });

      const result = exportModel(graph, format as ExportFormat, parseOptions(req));
      const disposition = req.query.download === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `${disposition}; filename="${result.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-C4Arch-Export-Source', graph.source);
      return res.send(result.body);
    } catch (err) {
      console.error('[exports] export error', err);
      return res.status(500).json({ error: 'Erro ao exportar modelo' });
    }
  }

  /** Preview server-side (SVG/PNG) para embed e publicação. */
  static async preview(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    const format = req.query.format === 'png' ? 'png' : 'svg';

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      const graph = await loadModelGraph(id);
      if (!graph) return res.status(404).json({ error: 'Modelo não encontrado' });

      const result = exportModel(graph, format, parseOptions(req));
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `inline; filename="${result.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(result.body);
    } catch (err) {
      console.error('[exports] preview error', err);
      return res.status(500).json({ error: 'Erro ao gerar preview' });
    }
  }
}
