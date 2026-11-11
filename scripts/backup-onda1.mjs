#!/usr/bin/env node
/**
 * Backup pré-M1 da Onda 1.
 *
 * Uso:
 *   node scripts/backup-onda1.mjs
 *
 * Requer o stack Docker em execução (`docker compose up -d`). Gera:
 *   backups/<timestamp>/db.dump          (pg_dump custom format)
 *   backups/<timestamp>/storage.tar.gz   (snapshots do volume do realtime)
 *   backups/<timestamp>/manifest.json
 *
 * O backup é validado pelo cabeçalho `PGDMP` e pelo tamanho dos arquivos.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(root, 'backups', stamp);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw new Error(`${command} não pôde ser executado: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.toString('utf8')?.trim();
    throw new Error(`${command} ${args.join(' ')} falhou (${result.status}): ${stderr || 'sem detalhes'}`);
  }
  return result.stdout;
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function main() {
  mkdirSync(outDir, { recursive: true });

  console.log(`[backup] destino: ${outDir}`);

  console.log('[backup] gerando dump do PostgreSQL...');
  const dbDump = run('docker', [
    'compose',
    'exec',
    '-T',
    'db',
    'sh',
    '-c',
    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc',
  ]);

  const dbHeader = dbDump.subarray(0, 5).toString('ascii');
  if (dbHeader !== 'PGDMP') {
    throw new Error(`dump do PostgreSQL inválido (cabeçalho "${dbHeader}", esperado "PGDMP")`);
  }
  const dbFile = join(outDir, 'db.dump');
  writeFileSync(dbFile, dbDump);
  console.log(`[backup] db.dump: ${dbDump.length} bytes`);

  let storageBytes = 0;
  let storageStatus = 'ok';
  try {
    console.log('[backup] compactando snapshots do realtime...');
    const storage = run('docker', [
      'compose',
      'exec',
      '-T',
      'realtime',
      'tar',
      '-czf',
      '-',
      '-C',
      '/app/storage',
      '.',
    ]);
    const storageFile = join(outDir, 'storage.tar.gz');
    writeFileSync(storageFile, storage);
    storageBytes = storage.length;
    console.log(`[backup] storage.tar.gz: ${storageBytes} bytes`);
  } catch (err) {
    storageStatus = `falhou: ${err.message}`;
    console.warn(`[backup] aviso: ${storageStatus}`);
  }

  const manifest = {
    kind: 'pre-m1',
    createdAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    database: { file: 'db.dump', bytes: dbDump.length, format: 'pg_dump -Fc' },
    storage: { file: 'storage.tar.gz', bytes: storageBytes, status: storageStatus },
    notes: 'Backup obrigatório antes do M1 (schema canônico). Ver docs/M0-CHECKLIST.md.',
  };
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log('[backup] concluído.');
  console.log(JSON.stringify(manifest, null, 2));
}

try {
  main();
} catch (err) {
  console.error('[backup] falhou:', err.message);
  process.exit(1);
}
