#!/usr/bin/env node
/**
 * Restore de um backup do C4Arch.
 *
 *   node scripts/restore.mjs backups/c4arch-.../c4arch.dump
 *   node scripts/restore.mjs backups/c4arch-.../c4arch.json.gz
 *   npm run restore -- <caminho>
 *
 * Dumps custom usam pg_restore --clean --if-exists; dumps lógicos apagam as
 * tabelas na ordem inversa e reinserem os dados. Ambos podem ser seguidos de
 * `npm run db:migrate`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const input = process.argv[2];
if (!input) {
  console.error('Uso: node scripts/restore.mjs <arquivo.dump|arquivo.json.gz> [--no-storage]');
  process.exit(1);
}
const source = resolve(input);
if (!existsSync(source)) {
  console.error(`[restore] arquivo não encontrado: ${source}`);
  process.exit(1);
}

const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'c4arch',
  user: process.env.DB_USER ?? 'c4arch',
  password: process.env.DB_PASSWORD ?? 'change-me-please',
};

function restoreDump(file) {
  const cliArgs = ['--clean', '--if-exists', '--no-owner', '--no-acl', '--dbname'];
  if (dbConfig.connectionString) {
    cliArgs.push(dbConfig.connectionString);
  } else {
    cliArgs.push(dbConfig.database, '-h', dbConfig.host, '-p', String(dbConfig.port), '-U', dbConfig.user);
  }
  const result = spawnSync(process.env.PG_RESTORE ?? 'pg_restore', [...cliArgs, file], {
    env: {
      ...process.env,
      ...(dbConfig.connectionString ? {} : { PGPASSWORD: dbConfig.password }),
    },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pg_restore retornou ${result.status}`);
}

function quoteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function restoreLogical(file) {
  const parsed = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || !parsed.data) {
    throw new Error('Backup lógico inválido (campo data ausente)');
  }
  const tables = Array.isArray(parsed.tables) ? parsed.tables : Object.keys(parsed.data);
  const { default: pg } = await import('pg');
  const client = new pg.Client(
    dbConfig.connectionString
      ? { connectionString: dbConfig.connectionString }
      : {
          host: dbConfig.host,
          port: dbConfig.port,
          database: dbConfig.database,
          user: dbConfig.user,
          password: dbConfig.password,
        }
  );
  await client.connect();
  try {
    await client.query('BEGIN');
    // Desabilita triggers de FK apenas quando há permissão; se falhar, o
    // restore segue na ordem topológica gravada no backup.
    const relaxed = await client
      .query("SET session_replication_role = replica")
      .then(() => true)
      .catch(() => false);
    for (const table of [...tables].reverse()) {
      if (!parsed.data[table]) continue;
      await client.query(`DELETE FROM ${quoteIdentifier(table)}`);
    }
    for (const table of tables) {
      const rows = parsed.data[table];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const columns = Object.keys(row);
        if (columns.length === 0) continue;
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const values = columns.map((column) => row[column]);
        await client.query(
          `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')})
           VALUES (${placeholders})
           ON CONFLICT DO NOTHING`,
          values
        );
      }
      console.log(`[restore] ${table}: ${rows.length} linha(s)`);
    }
    if (relaxed) await client.query('SET session_replication_role = origin');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

async function restoreStorage(folder) {
  if (!existsSync(folder)) return;
  const target = join(root, 'storage');
  mkdirSync(target, { recursive: true });
  const walk = (from, to) => {
    for (const entry of readdirSync(from)) {
      const sourcePath = join(from, entry);
      const targetPath = join(to, entry);
      const info = statSync(sourcePath);
      if (info.isDirectory()) {
        mkdirSync(targetPath, { recursive: true });
        walk(sourcePath, targetPath);
      } else {
        writeFileSync(targetPath, readFileSync(sourcePath));
      }
    }
  };
  walk(folder, target);
  console.log('[restore] storage restaurado');
}

if (source.endsWith('.json.gz')) {
  await restoreLogical(source);
} else {
  restoreDump(source);
}
if (!process.argv.includes('--no-storage')) {
  await restoreStorage(join(dirname(source), 'storage'));
}
console.log('[restore] concluído. Rode `npm run db:migrate` para garantir o schema atual.');
