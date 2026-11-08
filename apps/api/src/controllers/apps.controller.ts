import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { getOrgResourceAccess, getOrgRole, isOrgMember, isValidUuid, isWriterRole } from '../auth/access.js';
import {
  detachAssetChange,
  listAssetDependencies,
  propagateAssetChange,
  type AssetLike,
} from '../c4/assets.js';

export class AppController {
  static async list(req: AuthenticatedRequest, res: Response) {
    const { orgId } = req.query as { orgId?: string };
    if (!isValidUuid(orgId)) return res.status(400).json({ error: 'orgId inválido' });

    try {
      if (!(await isOrgMember(req.user!.id, orgId))) {
        return res.status(403).json({ error: 'Sem acesso a esta organização' });
      }
      const result = await pool.query(
        `SELECT * FROM apps WHERE org_id = $1 ORDER BY name ASC`,
        [orgId]
      );
      return res.json(result.rows);
    } catch (err) {
      console.error('[apps] list error', err);
      return res.status(500).json({ error: 'Erro ao listar aplicações' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const { orgId, name, description, kind, metadata } = req.body as {
      orgId?: string;
      name?: string;
      description?: string | null;
      kind?: 'app' | 'service';
      metadata?: Record<string, unknown> | null;
    };
    const cleanName = typeof name === 'string' ? name.trim() : '';

    if (!isValidUuid(orgId) || !cleanName) {
      return res.status(400).json({ error: 'orgId e name são obrigatórios' });
    }
    if (cleanName.length > 120) {
      return res.status(400).json({ error: 'name muito longo' });
    }
    if (kind !== undefined && kind !== 'app' && kind !== 'service') {
      return res.status(400).json({ error: 'kind inválido' });
    }

    try {
      const role = await getOrgRole(req.user!.id, orgId);
      if (!isWriterRole(role)) {
        return res.status(403).json({ error: 'Sem permissão de escrita nesta organização' });
      }
      const result = await pool.query(
        `INSERT INTO apps (org_id, name, description, kind, metadata)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [orgId, cleanName, description ?? null, kind ?? 'app', metadata ?? null]
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('[apps] create error', err);
      return res.status(500).json({ error: 'Erro ao criar aplicação' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { name, description, kind, metadata } = req.body as {
      name?: string;
      description?: string | null;
      kind?: 'app' | 'service';
      metadata?: Record<string, unknown> | null;
    };

    try {
      const app = await getOrgResourceAccess('apps', req.user!.id, id);
      if (!app) return res.status(404).json({ error: 'Aplicação não encontrada' });
      if (!isWriterRole(app.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar esta aplicação' });
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      let index = 1;

      if (name !== undefined) {
        const cleanName = typeof name === 'string' ? name.trim() : '';
        if (!cleanName || cleanName.length > 120) {
          return res.status(400).json({ error: 'name inválido' });
        }
        sets.push(`name = $${index++}`);
        values.push(cleanName);
      }
      if (description !== undefined) {
        sets.push(`description = $${index++}`);
        values.push(description);
      }
      if (kind !== undefined) {
        if (kind !== 'app' && kind !== 'service') {
          return res.status(400).json({ error: 'kind inválido' });
        }
        sets.push(`kind = $${index++}`);
        values.push(kind);
      }
      if (metadata !== undefined) {
        sets.push(`metadata = $${index++}`);
        values.push(metadata);
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      values.push(id);
      const result = await pool.query(
        `UPDATE apps SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${index} RETURNING *`,
        values
      );
      const updated = result.rows[0];

      await propagateAssetChange(
        'app',
        updated as unknown as AssetLike,
        app as unknown as AssetLike
      );

      return res.json(updated);
    } catch (err) {
      console.error('[apps] update error', err);
      return res.status(500).json({ error: 'Erro ao atualizar aplicação' });
    }
  }

  /** Modelos que reutilizam esta aplicação (elements e draw.io). */
  static async dependencies(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;

    try {
      const app = await getOrgResourceAccess('apps', req.user!.id, id);
      if (!app) return res.status(404).json({ error: 'Aplicação não encontrada' });

      const dependencies = await listAssetDependencies(
        'app',
        app as unknown as AssetLike
      );
      return res.json(dependencies);
    } catch (err) {
      console.error('[apps] dependencies error', err);
      return res.status(500).json({ error: 'Erro ao listar dependências da aplicação' });
    }
  }

  /** Download do XML da biblioteca c4arch (apps + servicos) para importar no draw.io. */
  static async library(req: AuthenticatedRequest, res: Response) {
    const { orgId } = req.query as { orgId?: string };
    if (!isValidUuid(orgId)) return res.status(400).json({ error: 'orgId inválido' });

    try {
      if (!(await isOrgMember(req.user!.id, orgId))) {
        return res.status(403).json({ error: 'Sem acesso a esta organização' });
      }

      const { buildLibraryXml } = await import('../controllers/drawio.controller.js');
      const xml = await buildLibraryXml(orgId);
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="c4arch-library.xml"');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(xml || '<mxlibrary>[]</mxlibrary>');
    } catch (err) {
      console.error('[apps] library error', err);
      return res.status(500).json({ error: 'Erro ao gerar biblioteca' });
    }
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;

    try {
      const app = await getOrgResourceAccess('apps', req.user!.id, id);
      if (!app) return res.status(404).json({ error: 'Aplicação não encontrada' });
      if (!isWriterRole(app.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para excluir esta aplicação' });
      }

      await detachAssetChange('app', app as unknown as AssetLike);
      await pool.query('DELETE FROM apps WHERE id = $1', [id]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[apps] remove error', err);
      return res.status(500).json({ error: 'Erro ao excluir aplicação' });
    }
  }
}
