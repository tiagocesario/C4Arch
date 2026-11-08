import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { getModelAccess, isWriterRole } from '../auth/access.js';

const ELEMENT_TYPES = new Set(['actor', 'system', 'container', 'component']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Um elemento pode apontar para um app ou serviço da mesma organização (nunca
 * para os dois). Esses vínculos alimentam a lista de dependências dos modelos.
 */
async function validateAssetLink(
  orgId: string,
  appId: string | null | undefined,
  serviceId: string | null | undefined
): Promise<string | null> {
  if (appId != null && serviceId != null) {
    return 'Um elemento não pode referenciar app e serviço ao mesmo tempo';
  }
  if (appId != null) {
    if (!isUuid(appId)) return 'appId inválido';
    const found = await pool.query(
      'SELECT id FROM apps WHERE id = $1 AND org_id = $2',
      [appId, orgId]
    );
    if (found.rows.length === 0) return 'Aplicação não encontrada na organização';
  }
  if (serviceId != null) {
    if (!isUuid(serviceId)) return 'serviceId inválido';
    const found = await pool.query(
      'SELECT id FROM services WHERE id = $1 AND org_id = $2',
      [serviceId, orgId]
    );
    if (found.rows.length === 0) return 'Serviço não encontrado na organização';
  }
  return null;
}

export class ElementController {
  static async list(req: AuthenticatedRequest, res: Response) {
    const { modelId } = req.params;

    try {
      const model = await getModelAccess(req.user!.id, modelId);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const result = await pool.query(
        'SELECT * FROM elements WHERE model_id = $1 ORDER BY "order"',
        [modelId]
      );
      return res.json(result.rows);
    } catch (err) {
      console.error('[elements] list error', err);
      return res.status(500).json({ error: 'Erro ao listar elementos' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const { modelId } = req.params;
    const { title, type, description, metadata, positionX, positionY, order, appId, serviceId } = req.body as {
      title?: string;
      type?: string;
      description?: string | null;
      metadata?: Record<string, unknown> | null;
      positionX?: number;
      positionY?: number;
      order?: number;
      appId?: string | null;
      serviceId?: string | null;
    };

    const cleanTitle = typeof title === 'string' ? title.trim() : '';
    if (!cleanTitle || cleanTitle.length > 200) {
      return res.status(400).json({ error: 'title é obrigatório (máx. 200 caracteres)' });
    }
    if (typeof type !== 'string' || !ELEMENT_TYPES.has(type)) {
      return res.status(400).json({ error: 'type inválido' });
    }
    if ((appId != null || serviceId != null) && type !== 'container') {
      return res.status(400).json({ error: 'appId/serviceId exigem type "container"' });
    }
    if (description !== undefined && description !== null && typeof description !== 'string') {
      return res.status(400).json({ error: 'description inválida' });
    }
    if (
      (positionX !== undefined && !isFiniteNumber(positionX)) ||
      (positionY !== undefined && !isFiniteNumber(positionY)) ||
      (order !== undefined && !isFiniteNumber(order))
    ) {
      return res.status(400).json({ error: 'posição/ordem inválidas' });
    }

    try {
      const model = await getModelAccess(req.user!.id, modelId);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const linkError = await validateAssetLink(String(model.org_id), appId, serviceId);
      if (linkError) return res.status(400).json({ error: linkError });

      const element = await pool.query(
        `INSERT INTO elements (model_id, app_id, service_id, title, type, description, metadata, position_x, position_y, "order")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          modelId,
          appId ?? null,
          serviceId ?? null,
          cleanTitle,
          type,
          description ?? null,
          metadata ?? null,
          positionX ?? 0,
          positionY ?? 0,
          order ?? 0,
        ]
      );
      return res.status(201).json(element.rows[0]);
    } catch (err) {
      console.error('[elements] create error', err);
      return res.status(500).json({ error: 'Erro ao criar elemento' });
    }
  }

  static async get(req: AuthenticatedRequest, res: Response) {
    const { modelId, elementId } = req.params;
    if (!isUuid(elementId)) return res.status(404).json({ error: 'Elemento não encontrado' });

    try {
      const model = await getModelAccess(req.user!.id, modelId);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const result = await pool.query(
        `SELECT * FROM elements WHERE id = $1 AND model_id = $2`,
        [elementId, modelId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Elemento não encontrado' });
      }
      return res.json(result.rows[0]);
    } catch (err) {
      console.error('[elements] get error', err);
      return res.status(500).json({ error: 'Erro ao carregar elemento' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const { modelId, elementId } = req.params;
    if (!isUuid(elementId)) return res.status(404).json({ error: 'Elemento não encontrado' });
    const { title, type, description, metadata, positionX, positionY, order, appId, serviceId } = req.body as {
      title?: string;
      type?: string;
      description?: string | null;
      metadata?: Record<string, unknown> | null;
      positionX?: number;
      positionY?: number;
      order?: number;
      appId?: string | null;
      serviceId?: string | null;
    };

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) {
        return res.status(400).json({ error: 'title inválido' });
      }
    }
    if (type !== undefined && (typeof type !== 'string' || !ELEMENT_TYPES.has(type))) {
      return res.status(400).json({ error: 'type inválido' });
    }
    if ((appId != null || serviceId != null) && type !== undefined && type !== 'container') {
      return res.status(400).json({ error: 'appId/serviceId exigem type "container"' });
    }
    if (description !== undefined && description !== null && typeof description !== 'string') {
      return res.status(400).json({ error: 'description inválida' });
    }
    if (
      (positionX !== undefined && !isFiniteNumber(positionX)) ||
      (positionY !== undefined && !isFiniteNumber(positionY)) ||
      (order !== undefined && !isFiniteNumber(order))
    ) {
      return res.status(400).json({ error: 'posição/ordem inválidas' });
    }

    try {
      const model = await getModelAccess(req.user!.id, modelId);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const linkError = await validateAssetLink(String(model.org_id), appId, serviceId);
      if (linkError) return res.status(400).json({ error: linkError });
      const linkingAsset = appId != null || serviceId != null;

      const sets: string[] = [];
      const values: unknown[] = [];
      let index = 1;

      if (title !== undefined) {
        sets.push(`title = $${index++}`);
        values.push(title.trim());
      }
      if (type !== undefined) {
        sets.push(`type = $${index++}`);
        values.push(type);
      } else if (linkingAsset) {
        sets.push(`type = 'container'`);
      }
      if (description !== undefined) {
        sets.push(`description = $${index++}`);
        values.push(description);
      }
      if (metadata !== undefined) {
        sets.push(`metadata = $${index++}`);
        values.push(metadata);
      }
      if (appId !== undefined) {
        sets.push(`app_id = $${index++}`);
        values.push(appId);
        if (appId !== null) {
          sets.push(`service_id = NULL`);
        }
      }
      if (serviceId !== undefined) {
        sets.push(`service_id = $${index++}`);
        values.push(serviceId);
        if (serviceId !== null) {
          sets.push(`app_id = NULL`);
        }
      }
      if (positionX !== undefined) {
        sets.push(`position_x = $${index++}`);
        values.push(positionX);
      }
      if (positionY !== undefined) {
        sets.push(`position_y = $${index++}`);
        values.push(positionY);
      }
      if (order !== undefined) {
        sets.push(`"order" = $${index++}`);
        values.push(order);
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      values.push(elementId, modelId);
      const result = await pool.query(
        `UPDATE elements SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${index} AND model_id = $${index + 1} RETURNING *`,
        values
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Elemento não encontrado' });
      }
      return res.json(result.rows[0]);
    } catch (err) {
      console.error('[elements] update error', err);
      return res.status(500).json({ error: 'Erro ao atualizar elemento' });
    }
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    const { modelId, elementId } = req.params;
    if (!isUuid(elementId)) return res.status(404).json({ error: 'Elemento não encontrado' });

    try {
      const model = await getModelAccess(req.user!.id, modelId);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const result = await pool.query(
        `DELETE FROM elements WHERE id = $1 AND model_id = $2 RETURNING id`,
        [elementId, modelId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Elemento não encontrado' });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error('[elements] remove error', err);
      return res.status(500).json({ error: 'Erro ao excluir elemento' });
    }
  }
}
