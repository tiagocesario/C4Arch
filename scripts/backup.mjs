#!/usr/bin/env node
/**
 * Backup do C4Arch.
 *
 *   node scripts/backup.mjs [destino]
 *   npm run backup
 *
 * Estratégia:
 * 1. Se `pg_dump` existir, gera um dump custom (restaurável com pg_restore).
 * 2. Caso contrário, exporta todas as tabelas públicas em JSON gzip, na ordem
 *    topológica das dependências, para o restore conseguir reinseri-las.
 *
 * Também copia `storage/` (snapshots do Yjs) quando existir, salvo `--no-storage`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const includeStorage = !process.argv.includes('--no-storage');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = resolve(
  args[0] ?? join(root, 'backups', `c4arch-${stamp}`)
);

const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'c4arch',
  user: process.env.DB_USER ?? 'c4arch',
  password: process.env.DB_PASSWORD ?? 'change-me-please',
};

mkdirSync(destination, { recursive: true });
console.log(`[backup] destino: ${destination}`);

function tryPgDump() {
  const outFile = join(destination, 'c4arch.dump');
  const cliArgs = [
    '--format=custom',
    '--no-owner',
    '--no-acl',
    '--file',
    outFile,
  ];
  if (dbConfig.connectionString) {
    cliArgs.push(dbConfig.connectionString);
  } else {
    cliArgs.push('-h', dbConfig.host, '-p', String(dbConfig.port), '-U', dbConfig.user, '-d', dbConfig.database);
  }
  const env = {
    ...process.env,
    ...(dbConfig.connectionString ? {} : { PGPASSWORD: dbConfig.password }),
  };
  const result = spawnSync(process.env.PG_DUMP ?? 'pg_dump', cliArgs, {
    env,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) return false;
  writeFileSync(
    join(destination, 'manifest.json'),
    JSON.stringify({ format: 'pg_dump-custom', createdAt: new Date().toISOString(), database: dbConfig.database }, null, 2)
  );
  return true;
}

function copyStorage() {
  const storage = join(root, 'storage');
  if (!existsSync(storage)) return 0;
  let count = 0;
  const walk = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) {
      const source = join(from, entry);
      const target = join(to, entry);
      const info = statSync(source);
      if (info.isDirectory()) {
        walk(source, target);
      } else {
        writeFileSync(target, readFileSync(source));
        count += 1;
      }
    }
  };
  walk(storage, join(destination, 'storage'));
  return count;
}

async function logicalDump() {
  const { default: pg } = await import('pg');
  const client = new pg.Client(
    dbConfig.connectionString ? { connectionString: dbConfig.connectionString } : {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
    }
  );
  await client.connect();

  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  );
  const names = tables.rows.map((row) => row.table_name);
  const edges = await client.query(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
  );

  // Ordem topológica: pais antes dos filhos; ciclos são quebrados pela ordem
  // alfabética, já que o restore usa ON CONFLICT DO NOTHING.
  const dependencies = new Map(names.map((name) => [name, new Set()]));
  for (const edge of edges.rows) {
    if (edge.child === edge.parent) continue;
    if (dependencies.has(edge.child) && dependencies.has(edge.parent)) {
      dependencies.get(edge.child).add(edge.parent);
    }
  }
  const ordered = [];
  const remaining = new Set(names);
  while (remaining.size > 0) {
    let progressed = false;
    for (const name of [...remaining].sort()) {
      const deps = dependencies.get(name);
      if ([...deps].every((dep) => !remaining.has(dep) || dep === name)) {
        ordered.push(name);
        remaining.delete(name);
        progressed = true;
      }
    }
    if (!progressed) {
      ordered.push(...[...remaining].sort());
      break;
    }
  }

  const data = {};
  for (const table of ordered) {
    const result = await client.query(`SELECT * FROM "${table}"`);
    data[table] = result.rows;
    console.log(`[backup] ${table}: ${result.rows.length} linha(s)`);
  }
  await client.end();

  writeFileSync(
    join(destination, 'c4arch.json.gz'),
    gzipSync(Buffer.from(JSON.stringify({ format: 'logical-json', createdAt: new Date().toISOString(), tables: ordered, data })))
  );
  writeFileSync(
    join(destination, 'manifest.json'),
    JSON.stringify({ format: 'logical-json', createdAt: new Date().toISOString(), tables: ordered, database: dbConfig.database }, null, 2)
  );
}

let usedPgDump = false;
try {
  usedPgDump = tryPgDump();
} catch (err) {
  console.warn('[backup] pg_dump indisponível:', err instanceof Error ? err.message : err);
}
if (!usedPgDump) {
  console.log('[backup] pg_dump indisponível; usando dump lógico JSON.');
  await logicalDump();
}

if (includeStorage) {
  const files = copyStorage();
  if (files > 0) console.log(`[backup] storage: ${files} arquivo(s)`);
}

console.log('[backup] concluído.');
