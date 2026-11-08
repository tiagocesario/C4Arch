import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { getModelAccess, isValidUuid, isWriterRole } from '../auth/access.js';

const EDGE_TYPES = new Set(['call', 'http', 'message', 'depends']);

async function elementsBelongToModel(modelId: string, ids: string[]): Promise<boolean> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return true;
  const result = await pool.query(
    'SELECT id FROM elements WHERE model_id = $1 AND id = ANY($2::uuid[])',
    [modelId, uniqueIds]
  );
  return result.rows.length === uniqueIds.length;
}

export class EdgeController {
  static async list(req: AuthenticatedRequest, res: Response) {
    const { modelId } = req.params;

    try {
      const model = await getModelAccess(req.user!.id, modelId);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const result = await pool.query(
        `SELECT e.*, from_elem.title AS source_title, to_elem.title AS target_title
           FROM edges e
           JOIN elements from_elem ON from_elem.id = e.from_id
           JOIN elements to_elem ON to_elem.id = e.to_id
          WHERE e.model_id = $1
          ORDER BY e.created_at`,
        [modelId]
      );
      return res.json(result.rows);
    } catch (err) {
      console.error('[edges] list error', err);
      return res.status(500).json({ error: 'Erro ao listar conexões' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const { modelId } = req.params;
    const { fromId, toId, label, type } = req.body as {
      fromId?: string;
      toId?: string;
      label?: string | null;
      type?: string;
    };

    if (typeof fromId !== 'string' || !isValidUuid(fromId) || typeof toId !== 'string' || !isValidUuid(toId)) {
      return res.status(400).json({ error: 'fromId e toId são obrigatórios' });
    }
    if (type !== undefined && (typeof type !== 'string' || !EDGE_TYPES.has(type))) {
      return res.status(400).json({ error: 'type inválido' });
    }
    if (label !== undefined && label !== null && typeof label !== 'string') {
      return res.status(400).json({ error: 'label inválido' });
    }
    if (typeof label === 'string' && label.length > 500) {
      return res.status(400).json({ error: 'label muito longo' });
    }

    try {
      const model = await getModelAccess(req.user!.id, modelId);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      if (!(await elementsBelongToModel(modelId, [fromId, toId]))) {
        return res.status(400).json({ error: 'Elementos não pertencem a este modelo' });
      }

      const edge = await pool.query(
        `INSERT INTO edges (model_id, from_id, to_id, label, type)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [modelId, fromId, toId, label ?? '', type ?? 'call']
      );
      return res.status(201).json(edge.rows[0]);
    } catch (err) {
      console.error('[edges] create error', err);
      return res.status(500).json({ error: 'Erro ao criar conexão' });
    }
  }

  static async get(req: AuthenticatedRequest, res: Response) {
    const { modelId, edgeId } = req.params;
    if (!isValidUuid(edgeId)) return res.status(404).json({ error: 'Conexão não encontrada' });

    try {
      const model = await getModelAccess(req.user!.id, modelId);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const result = await pool.query(
        `SELECT e.*, from_elem.title AS source_title, to_elem.title AS target_title
           FROM edges e
           JOIN elements from_elem ON from_elem.id = e.from_id
           JOIN elements to_elem ON to_elem.id = e.to_id
          WHERE e.id = $1 AND e.model_id = $2`,
        [edgeId, modelId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Conexão não encontrada' });
      }
      return res.json(result.rows[0]);
    } catch (err) {
      console.error('[edges] get error', err);
      return res.status(500).json({ error: 'Erro ao carregar conexão' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const { modelId, edgeId } = req.params;
    if (!isValidUuid(edgeId)) return res.status(404).json({ error: 'Conexão não encontrada' });
    const { fromId, toId, label, type } = req.body as {
      fromId?: string;
      toId?: string;
      label?: string | null;
      type?: string;
    };

    if (fromId !== undefined && (typeof fromId !== 'string' || !isValidUuid(fromId))) {
      return res.status(400).json({ error: 'fromId inválido' });
    }
    if (toId !== undefined && (typeof toId !== 'string' || !isValidUuid(toId))) {
      return res.status(400).json({ error: 'toId inválido' });
    }
    if (type !== undefined && (typeof type !== 'string' || !EDGE_TYPES.has(type))) {
      return res.status(400).json({ error: 'type inválido' });
    }
    if (label !== undefined && label !== null && typeof label !== 'string') {
      return res.status(400).json({ error: 'label inválido' });
    }
    if (typeof label === 'string' && label.length > 500) {
      return res.status(400).json({ error: 'label muito longo' });
    }

    try {
      const model = await getModelAccess(req.user!.id, modelId);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const referenced = [fromId, toId].filter((value): value is string => Boolean(value));
      if (!(await elementsBelongToModel(modelId, referenced))) {
        return res.status(400).json({ error: 'Elementos não pertencem a este modelo' });
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      let index = 1;

      if (fromId !== undefined) {
        sets.push(`from_id = $${index++}`);
        values.push(fromId);
      }
      if (toId !== undefined) {
        sets.push(`to_id = $${index++}`);
        values.push(toId);
      }
      if (label !== undefined) {
        sets.push(`label = $${index++}`);
        values.push(label);
      }
      if (type !== undefined) {
        sets.push(`type = $${index++}`);
        values.push(type);
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      values.push(edgeId, modelId);
      const result = await pool.query(
        `UPDATE edges SET ${sets.join(', ')}
          WHERE id = $${index} AND model_id = $${index + 1} RETURNING *`,
        values
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Conexão não encontrada' });
      }
      return res.json(result.rows[0]);
    } catch (err) {
      console.error('[edges] update error', err);
      return res.status(500).json({ error: 'Erro ao atualizar conexão' });
    }
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    const { modelId, edgeId } = req.params;
    if (!isValidUuid(edgeId)) return res.status(404).json({ error: 'Conexão não encontrada' });

    try {
      const model = await getModelAccess(req.user!.id, modelId);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const result = await pool.query(
        `DELETE FROM edges WHERE id = $1 AND model_id = $2 RETURNING id`,
        [edgeId, modelId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Conexão não encontrada' });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error('[edges] remove error', err);
      return res.status(500).json({ error: 'Erro ao excluir conexão' });
    }
  }
}
