import type { Response } from 'express';
import { pool } from '../db.js';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import { getModelAccess, isWriterRole } from '../auth/access.js';
import { recordAudit } from '../c4/audit.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COMMENT_LENGTH = 5_000;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

interface CommentRow {
  id: string;
  model_id: string;
  element_id: string | null;
  content: string;
  author_id: string;
  author_name: string | null;
  author_email: string | null;
  created_at: string;
  updated_at: string | null;
  resolved: boolean;
  resolved_by: string | null;
}

function mapComment(row: CommentRow) {
  return {
    id: row.id,
    modelId: row.model_id,
    elementId: row.element_id,
    content: row.content,
    author: {
      id: row.author_id,
      name: row.author_name ?? row.author_email ?? 'Usuário',
      email: row.author_email,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolved: row.resolved,
    resolvedBy: row.resolved_by,
  };
}

export class CommentsController {
  static async list(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    const resolvedFilter = req.query.resolved;
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const values: unknown[] = [id];
      let filter = '';
      if (resolvedFilter === 'true' || resolvedFilter === 'false') {
        values.push(resolvedFilter === 'true');
        filter = ' AND c.resolved = $2';
      }

      const result = await pool.query<CommentRow>(
        `SELECT c.*, u.name AS author_name, u.email AS author_email
           FROM comments c
           JOIN users u ON u.id = c.author_id
          WHERE c.model_id = $1${filter}
          ORDER BY c.created_at ASC`,
        values
      );
      return res.json({
        modelId: id,
        comments: result.rows.map(mapComment),
      });
    } catch (err) {
      console.error('[comments] list error', err);
      return res.status(500).json({ error: 'Erro ao listar comentários' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    const body = (req.body ?? {}) as { content?: unknown; elementId?: unknown };
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return res.status(400).json({ error: 'content é obrigatório' });
    if (content.length > MAX_COMMENT_LENGTH) {
      return res.status(413).json({ error: 'Comentário muito longo' });
    }
    if (body.elementId !== undefined && body.elementId !== null && !isUuid(body.elementId)) {
      return res.status(400).json({ error: 'elementId inválido' });
    }

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para comentar neste modelo' });
      }

      if (body.elementId) {
        const element = await pool.query(
          'SELECT id FROM elements WHERE id = $1 AND model_id = $2 UNION SELECT id FROM model_elements WHERE id = $1 AND model_id = $2',
          [body.elementId, id]
        );
        if (element.rows.length === 0) {
          return res.status(404).json({ error: 'Elemento não encontrado neste modelo' });
        }
      }

      const result = await pool.query<CommentRow>(
        `INSERT INTO comments (model_id, element_id, content, author_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *, NULL::text AS author_name, NULL::text AS author_email, NULL::timestamptz AS updated_at, NULL::uuid AS resolved_by`,
        [id, body.elementId ?? null, content, req.user!.id]
      );
      const author = await pool.query<{ name: string | null; email: string | null }>(
        'SELECT name, email FROM users WHERE id = $1',
        [req.user!.id]
      );
      const comment: CommentRow = {
        ...result.rows[0],
        author_name: author.rows[0]?.name ?? null,
        author_email: author.rows[0]?.email ?? null,
      };
      await recordAudit({
        orgId: (model.org_id as string) ?? null,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'comment.create',
        entityType: 'comment',
        entityId: comment.id,
        metadata: { modelId: id, elementId: body.elementId ?? null },
      });
      return res.status(201).json(mapComment(comment));
    } catch (err) {
      console.error('[comments] create error', err);
      return res.status(500).json({ error: 'Erro ao criar comentário' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const { id, commentId } = req.params;
    if (!isUuid(id) || !isUuid(commentId)) {
      return res.status(404).json({ error: 'Comentário não encontrado' });
    }
    const body = (req.body ?? {}) as { content?: unknown; resolved?: unknown };
    const sets: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (body.content !== undefined) {
      if (typeof body.content !== 'string' || !body.content.trim()) {
        return res.status(400).json({ error: 'content inválido' });
      }
      if (body.content.trim().length > MAX_COMMENT_LENGTH) {
        return res.status(413).json({ error: 'Comentário muito longo' });
      }
      sets.push(`content = $${index++}`);
      values.push(body.content.trim());
    }
    if (body.resolved !== undefined) {
      if (typeof body.resolved !== 'boolean') {
        return res.status(400).json({ error: 'resolved deve ser booleano' });
      }
      sets.push(`resolved = $${index++}`);
      values.push(body.resolved);
      sets.push(`resolved_by = $${index++}`);
      values.push(body.resolved ? req.user!.id : null);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar comentários' });
      }

      const existing = await pool.query<{ author_id: string }>(
        'SELECT author_id FROM comments WHERE id = $1 AND model_id = $2',
        [commentId, id]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Comentário não encontrado' });
      }
      const isOwner = model.member_role === 'owner';
      if (existing.rows[0].author_id !== req.user!.id && !isOwner) {
        return res.status(403).json({ error: 'Apenas o autor ou um owner pode editar o comentário' });
      }

      values.push(commentId, id);
      const result = await pool.query<CommentRow>(
        `UPDATE comments SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${index} AND model_id = $${index + 1}
          RETURNING *, (SELECT name FROM users WHERE id = comments.author_id) AS author_name,
                    (SELECT email FROM users WHERE id = comments.author_id) AS author_email`,
        values
      );
      return res.json(mapComment(result.rows[0]));
    } catch (err) {
      console.error('[comments] update error', err);
      return res.status(500).json({ error: 'Erro ao atualizar comentário' });
    }
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    const { id, commentId } = req.params;
    if (!isUuid(id) || !isUuid(commentId)) {
      return res.status(404).json({ error: 'Comentário não encontrado' });
    }
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para excluir comentários' });
      }
      const existing = await pool.query<{ author_id: string }>(
        'SELECT author_id FROM comments WHERE id = $1 AND model_id = $2',
        [commentId, id]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Comentário não encontrado' });
      }
      if (existing.rows[0].author_id !== req.user!.id && model.member_role !== 'owner') {
        return res.status(403).json({ error: 'Apenas o autor ou um owner pode excluir o comentário' });
      }
      await pool.query('DELETE FROM comments WHERE id = $1 AND model_id = $2', [commentId, id]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[comments] remove error', err);
      return res.status(500).json({ error: 'Erro ao excluir comentário' });
    }
  }
}
