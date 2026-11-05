import pg from 'pg';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import { join } from 'path';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

function readDbPassword(): string {
  const password = process.env.DB_PASSWORD ?? '';
  if (password) return password;
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
    let data: { modelId?: string };
    try {
      data = JSON.parse(await fs.readFile(p, 'utf8'));
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
      console.log(`[worker] sincronizado modelo ${data.modelId} (v${v})`);
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
  await runMigrations();
  await syncSnapshots();
  setInterval(() => {
    syncSnapshots().catch((err) => {
      console.error('[worker] erro na sincronização periódica', err);
    });
  }, 30000);
  console.log('[worker] pronto, aguardando snapshots');
})().catch((err) => {
  console.error('[worker] falha ao iniciar:', err);
  process.exit(1);
});
