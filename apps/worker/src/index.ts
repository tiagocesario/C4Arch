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
    try {
      const v = ((await pool.query('SELECT COUNT(*)::int AS n FROM model_versions WHERE model_id=$1', [data.modelId])).rows[0].n) + 1;
      await pool.query('INSERT INTO model_versions(model_id, version, snapshot) VALUES ($1,$2,$3)', [data.modelId, v, JSON.stringify(data)]);
      console.log(`[worker] sincronizado modelo ${data.modelId} (v${v})`);
    } catch (err) {
      console.error('[worker] erro ao sincronizar', data.modelId, err);
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
