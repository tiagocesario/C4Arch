import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { pool } from '../db.js';

/**
 * Idempotência de escrita (Onda 3, item 15).
 *
 * Ativada pelo header `Idempotency-Key` em métodos mutantes. A chave é escopada
 * pelo token do chamador e guarda a resposta JSON original, permitindo repetir
 * a requisição após timeout sem duplicar efeitos (por exemplo, comentários,
 * importações e restaurações).
 */

const MAX_KEY_LENGTH = 200;
const STALE_PROCESSING_MS = 5 * 60 * 1000;

function stableStringify(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') {
      const record = input as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, sort(record[key])])
      );
    }
    return input;
  };
  return JSON.stringify(sort(value) ?? null);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function scopeOf(req: Request): string {
  const authorization = req.headers.authorization ?? '';
  const forwarded = req.headers['x-forwarded-for'];
  const address = typeof forwarded === 'string' ? forwarded : req.ip ?? '';
  return hash(`${authorization}|${address}`).slice(0, 32);
}

function requestHash(req: Request): string {
  return hash(stableStringify({ method: req.method, path: req.originalUrl, body: req.body ?? null }));
}

interface IdempotencyRow {
  request_hash: string;
  status: 'processing' | 'completed';
  response_status: number | null;
  response_body: unknown;
  created_at: string;
}

export async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

  const rawKey = req.headers['idempotency-key'];
  const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  if (!key) return next();
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    return res.status(400).json({
      error: 'Idempotency-Key inválida',
      code: 'INVALID_IDEMPOTENCY_KEY',
    });
  }

  const scope = scopeOf(req);
  const fingerprint = requestHash(req);

  try {
    const claim = await pool.query(
      `INSERT INTO idempotency_keys (scope_hash, key, method, path, request_hash, status)
       VALUES ($1, $2, $3, $4, $5, 'processing')
       ON CONFLICT (scope_hash, key) DO NOTHING
       RETURNING key`,
      [scope, key, req.method, req.originalUrl, fingerprint]
    );

    if ((claim.rowCount ?? 0) === 0) {
      const existing = await pool.query<IdempotencyRow>(
        'SELECT request_hash, status, response_status, response_body, created_at FROM idempotency_keys WHERE scope_hash = $1 AND key = $2',
        [scope, key]
      );
      const row = existing.rows[0];
      if (!row) return next();

      if (row.request_hash !== fingerprint) {
        return res.status(409).json({
          error: 'Idempotency-Key reutilizada com uma requisição diferente',
          code: 'IDEMPOTENCY_KEY_CONFLICT',
        });
      }
      if (row.status === 'completed') {
        res.setHeader('Idempotency-Replayed', 'true');
        return res.status(row.response_status ?? 200).json(row.response_body ?? {});
      }

      const age = Date.now() - new Date(row.created_at).getTime();
      if (Number.isFinite(age) && age > STALE_PROCESSING_MS) {
        // A tentativa anterior provavelmente morreu no meio; assume a chave.
        await pool.query(
          `UPDATE idempotency_keys
              SET status = 'processing', request_hash = $1, created_at = NOW()
            WHERE scope_hash = $2 AND key = $3`,
          [fingerprint, scope, key]
        );
        captureResponse(res, scope, key);
        return next();
      }

      return res.status(409).json({
        error: 'Requisição com esta Idempotency-Key ainda está em processamento',
        code: 'IDEMPOTENCY_IN_PROGRESS',
      });
    }

    captureResponse(res, scope, key);
    return next();
  } catch (err) {
    // Nunca bloqueia a requisição por indisponibilidade da tabela de
    // idempotência; o comportamento degradado é o mesmo de não usar o header.
    console.warn('[idempotency] indisponível:', err instanceof Error ? err.message : err);
    return next();
  }
}

function captureResponse(res: Response, scope: string, key: string): void {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    const status = res.statusCode;
    void pool
      .query(
        `UPDATE idempotency_keys
            SET status = 'completed', response_status = $1, response_body = $2::jsonb,
                completed_at = NOW()
          WHERE scope_hash = $3 AND key = $4`,
        [status, JSON.stringify(body ?? {}), scope, key]
      )
      .catch((err) => {
        console.warn('[idempotency] falha ao salvar resposta:', err instanceof Error ? err.message : err);
      });
    return originalJson(body);
  }) as typeof res.json;

  // Rotas que usam `res.send` (exports/downloads) não são mutantes, mas se
  // alguma delas aparecer no futuro a chave é encerrada sem corpo reutilizável.
  res.on('finish', () => {
    if (res.statusCode >= 500) {
      void pool
        .query('DELETE FROM idempotency_keys WHERE scope_hash = $1 AND key = $2', [scope, key])
        .catch(() => undefined);
    }
  });
}
