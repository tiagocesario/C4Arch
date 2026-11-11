import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { pool } from '../db.js';
import { flags } from '../flags.js';
import { computeStateContentHash, decodeModelState, stateVectorOf } from '../c4/state.js';
import { projectModel } from '../c4/projector.js';
import { isValidUuid } from '../auth/access.js';

/**
 * Rotas internas de `model_state`, usadas pelo realtime e pelo worker.
 *
 * A autenticação é um token de serviço (`API_TOKEN_REALTIME`). Sem token
 * configurado o router nem é montado, para não expor escrita de estado por
 * acidente.
 */

function tokenMatches(provided: string): boolean {
  const expected = config.internalToken;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyInternalToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers['x-internal-token'];
  const authorization = req.headers.authorization;
  const provided =
    (typeof header === 'string' ? header : '') ||
    (typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '');

  if (!config.internalToken) {
    return res.status(404).json({ error: 'Rota interna desabilitada' });
  }
  if (!tokenMatches(provided)) {
    return res.status(403).json({ error: 'Token interno inválido' });
  }
  return next();
}

function decodeBodyState(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const buffer = Buffer.from(value, 'base64');
    return buffer.length > 0 ? new Uint8Array(buffer) : null;
  } catch {
    return null;
  }
}

// O realtime pode fazer flush a cada 2s. Em sombra, comparar o modelo inteiro
// nessa frequência seria caro; `on` aplica sempre para manter o canônico em dia.
const PROJECTION_THROTTLE_MS = 30_000;
const lastProjectionAt = new Map<string, number>();

export const InternalController = {
  async putState(req: Request, res: Response) {
    const { id } = req.params;
    if (!isValidUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });

    const { state, stateVector, actorId } = req.body as {
      state?: unknown;
      stateVector?: unknown;
      actorId?: unknown;
    };
    const bytes = decodeBodyState(state);
    if (!bytes) return res.status(400).json({ error: 'state base64 inválido' });

    let decoded;
    try {
      decoded = decodeModelState(bytes);
    } catch (err) {
      return res
        .status(400)
        .json({ error: err instanceof Error ? err.message : 'estado Yjs inválido' });
    }

    const vector = decodeBodyState(stateVector) ?? stateVectorOf(bytes);
    const contentHash = computeStateContentHash(decoded);
    const actor = typeof actorId === 'string' && isValidUuid(actorId) ? actorId : null;

    try {
      const result = await pool.query<{ revision: string; updated_at: string }>(
        `INSERT INTO model_state
           (model_id, state, state_vector, content_hash, revision, updated_by)
         VALUES ($1, $2, $3, $4, 1, $5)
         ON CONFLICT (model_id) DO UPDATE SET
           state = EXCLUDED.state,
           state_vector = EXCLUDED.state_vector,
           content_hash = EXCLUDED.content_hash,
           revision = model_state.revision + 1,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by
         RETURNING revision, updated_at`,
        [id, Buffer.from(bytes), Buffer.from(vector), contentHash, actor]
      );

      const row = result.rows[0];
      res.json({
        modelId: id,
        contentHash,
        revision: Number(row.revision),
        updatedAt: row.updated_at,
      });

      // O projetor roda depois da resposta para não atrasar o flush do
      // realtime. Em `shadow` apenas compara; em `on` aplica o snapshot.
      if (flags.projectorShadow !== 'off') {
        const mode = flags.projectorShadow === 'on' ? 'on' : 'shadow';
        const last = lastProjectionAt.get(id) ?? 0;
        if (mode === 'on' || Date.now() - last >= PROJECTION_THROTTLE_MS) {
          lastProjectionAt.set(id, Date.now());
          void projectModel(id, { mode }).catch((err) => {
            console.error(`[internal] falha ao projetar modelo ${id}`, err);
          });
        }
      }
      return;
    } catch (err) {
      console.error('[internal] putState error', err);
      return res.status(500).json({ error: 'Erro ao gravar estado do modelo' });
    }
  },

  async getState(req: Request, res: Response) {
    const { id } = req.params;
    if (!isValidUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });

    try {
      const result = await pool.query<{
        state: Buffer;
        state_vector: Buffer | null;
        content_hash: string;
        revision: string;
        updated_at: string;
      }>(
        `SELECT state, state_vector, content_hash, revision, updated_at
           FROM model_state
          WHERE model_id = $1`,
        [id]
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Estado não encontrado' });

      const bytes = new Uint8Array(row.state);
      const decoded = decodeModelState(bytes);
      return res.json({
        modelId: id,
        state: Buffer.from(bytes).toString('base64'),
        stateVector: row.state_vector
          ? Buffer.from(row.state_vector).toString('base64')
          : Buffer.from(stateVectorOf(bytes)).toString('base64'),
        contentHash: row.content_hash,
        revision: Number(row.revision),
        updatedAt: row.updated_at,
        elements: decoded.elements,
        edges: decoded.edges,
      });
    } catch (err) {
      console.error('[internal] getState error', err);
      return res.status(500).json({ error: 'Erro ao carregar estado do modelo' });
    }
  },
};
