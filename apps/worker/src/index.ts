import pg from 'pg';
import dotenv from 'dotenv';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { describeFlags, flags } from './flags.js';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

const PLACEHOLDER_PASSWORDS = new Set([
  'change-me',
  'change-me-please',
  'change-me-to-a-random-password',
  'postgres',
  'password',
  'admin123',
]);

function readDbPassword(): string {
  const password = process.env.DB_PASSWORD ?? '';
  if (password) {
    if (isProduction && PLACEHOLDER_PASSWORDS.has(password.toLowerCase())) {
      throw new Error('DB_PASSWORD usa um valor de exemplo/placeholder; defina uma senha forte em produção.');
    }
    return password;
  }
  if (isProduction) {
    throw new Error('DB_PASSWORD é obrigatório em produção.');
  }
  console.warn('[worker] DB_PASSWORD não configurado; usando valor de desenvolvimento.');
  return 'change-me-please';
}

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'c4arch',
  user: process.env.DB_USER ?? 'c4arch',
  password: readDbPassword(),
  max: 5,
});

const storageDir = process.env.STORAGE_DIR ?? join(process.cwd(), 'storage');

const apiUrl = (process.env.API_URL ?? 'http://api:4000').replace(/\/$/, '');
const apiToken = process.env.API_TOKEN_REALTIME ?? process.env.API_TOKEN ?? '';
const VERSION_HASH_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_VERSION_RETENTION = 30;

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
  return JSON.stringify(sort(value));
}

function snapshotHash(data: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(data)).digest('hex')}`;
}

async function apiGetState(
  modelId: string
): Promise<{ contentHash: string; elements: unknown[]; edges: unknown[] } | null> {
  if (!apiToken) return null;
  try {
    const response = await fetch(
      `${apiUrl}/api/internal/models/${encodeURIComponent(modelId)}/state`,
      { headers: { 'X-Internal-Token': apiToken } }
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      contentHash?: unknown;
      elements?: unknown;
      edges?: unknown;
    };
    if (typeof body.contentHash !== 'string') return null;
    return {
      contentHash: body.contentHash,
      elements: Array.isArray(body.elements) ? body.elements : [],
      edges: Array.isArray(body.edges) ? body.edges : [],
    };
  } catch {
    return null;
  }
}

async function insertVersionByHash(
  modelId: string,
  contentHash: string,
  snapshot: unknown
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO model_version_counters(model_id, version)
       VALUES ($1, 0)
       ON CONFLICT (model_id) DO NOTHING`,
      [modelId]
    );
    const versionResult = await client.query(
      `UPDATE model_version_counters
          SET version = version + 1
        WHERE model_id = $1
        RETURNING version`,
      [modelId]
    );
    const version = versionResult.rows[0].version as number;

    const inserted = await client.query(
      `INSERT INTO model_versions (model_id, version, snapshot, content_hash, kind)
       VALUES ($1, $2, $3::jsonb, $4, 'auto')
       ON CONFLICT (model_id, content_hash) WHERE content_hash IS NOT NULL DO NOTHING
       RETURNING id`,
      [modelId, version, JSON.stringify(snapshot), contentHash]
    );

    // Retenção: mantém as 30 versões automáticas mais recentes por modelo.
    await client.query(
      `DELETE FROM model_versions
        WHERE model_id = $1
          AND kind = 'auto'
          AND id NOT IN (
            SELECT id FROM model_versions
             WHERE model_id = $1 AND kind = 'auto'
             ORDER BY created_at DESC
             LIMIT $2
          )`,
      [modelId, AUTO_VERSION_RETENTION]
    );
    await client.query('COMMIT');

    if (inserted.rows.length > 0) {
      console.log(`[worker] versão por hash ${modelId} (v${version}) ${contentHash.slice(0, 19)}…`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * VERSION_HASH=on: cria versão só quando o conteúdo muda, no máximo a cada
 * 5 minutos. A fonte é o `model_state` gravado pelo realtime.
 */
async function syncVersionsByHash(): Promise<void> {
  const states = await pool.query<{ model_id: string; content_hash: string; updated_at: Date }>(
    'SELECT model_id, content_hash, updated_at FROM model_state ORDER BY updated_at DESC'
  );

  for (const state of states.rows) {
    try {
      const last = await pool.query<{ content_hash: string | null; created_at: Date }>(
        `SELECT content_hash, created_at FROM model_versions
          WHERE model_id = $1 AND kind = 'auto'
          ORDER BY created_at DESC LIMIT 1`,
        [state.model_id]
      );
      const previous = last.rows[0];
      if (previous?.content_hash === state.content_hash) continue;
      if (
        previous &&
        Date.now() - new Date(previous.created_at).getTime() < VERSION_HASH_INTERVAL_MS
      ) {
        continue;
      }

      const logical = await apiGetState(state.model_id);
      if (!logical) continue;
      await insertVersionByHash(state.model_id, logical.contentHash, {
        modelId: state.model_id,
        elements: logical.elements,
        edges: logical.edges,
      });
    } catch (err) {
      console.error(`[worker] falha ao versionar modelo ${state.model_id}`, err);
    }
  }
}

async function syncSnapshotsShadow(): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(storageDir);
  } catch {
    return;
  }
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(join(storageDir, file), 'utf8');
      const data = JSON.parse(raw) as { modelId?: string };
      if (!data.modelId) continue;
      console.log(
        `[worker] sombra modelo ${data.modelId}: hash=${snapshotHash(data).slice(0, 19)}…`
      );
    } catch {
      continue;
    }
  }
}

async function runMigrations() {
  const queries = [
    `CREATE TABLE IF NOT EXISTS model_versions (
      model_id UUID NOT NULL,
      version INTEGER NOT NULL,
      snapshot JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS model_version_counters (
      model_id UUID PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 0
    )`,
    `DELETE FROM model_versions a
       USING model_versions b
      WHERE a.model_id = b.model_id
        AND a.version = b.version
        AND a.ctid < b.ctid`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_model_versions_model_version
       ON model_versions(model_id, version)`,
    `INSERT INTO model_version_counters(model_id, version)
     SELECT model_id, MAX(version)
       FROM model_versions
      GROUP BY model_id
     ON CONFLICT (model_id) DO UPDATE
       SET version = GREATEST(model_version_counters.version, EXCLUDED.version)`,
    `CREATE TABLE IF NOT EXISTS integrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      synced_at TIMESTAMPTZ
    )`,
  ];
  for (const q of queries) {
    await pool.query(q);
  }
  console.log('[worker] migrations aplicadas');
}

async function syncSnapshots() {
  let entries: string[];
  try {
    entries = await fs.readdir(storageDir);
  } catch {
    return;
  }
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    const p = join(storageDir, file);
    const startedAt = Date.now();
    let raw: string;
    let data: { modelId?: string };
    try {
      raw = await fs.readFile(p, 'utf8');
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!data.modelId) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // A versão é incrementada em uma linha de contador com lock de escrita,
      // evitando a corrida de COUNT(*) + 1 entre instâncias do worker.
      await client.query(
        `INSERT INTO model_version_counters(model_id, version)
         VALUES ($1, 0)
         ON CONFLICT (model_id) DO NOTHING`,
        [data.modelId]
      );
      const versionResult = await client.query(
        `UPDATE model_version_counters
            SET version = version + 1
          WHERE model_id = $1
          RETURNING version`,
        [data.modelId]
      );
      const v = versionResult.rows[0].version as number;
      await client.query(
        'INSERT INTO model_versions(model_id, version, snapshot) VALUES ($1,$2,$3)',
        [data.modelId, v, JSON.stringify(data)]
      );
      await client.query('COMMIT');
      console.log(
        `[worker] sincronizado modelo ${data.modelId} (v${v}) ` +
          `snapshot=${Buffer.byteLength(raw, 'utf8')}B duração=${Date.now() - startedAt}ms`
      );
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback failure
      }
      console.error('[worker] erro ao sincronizar', data.modelId, err);
    } finally {
      client.release();
    }
  }
}

(async () => {
  console.log('[worker] flags da Onda 1:', JSON.stringify(describeFlags()));
  // M6: o schema (model_versions, model_version_counters) é criado pela API.
  // O worker não executa mais migrações.

  const runCycle = async () => {
    if (flags.versionHash === 'on') {
      await syncVersionsByHash();
      return;
    }
    if (flags.versionHash === 'shadow') {
      await syncSnapshotsShadow();
    }
    await syncSnapshots();
  };

  await runCycle();
  setInterval(() => {
    runCycle().catch((err) => {
      console.error('[worker] erro na sincronização periódica', err);
    });
  }, 30000);
  console.log('[worker] pronto, aguardando snapshots');
})().catch((err) => {
  console.error('[worker] falha ao iniciar:', err);
  process.exit(1);
});
