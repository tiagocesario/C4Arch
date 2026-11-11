import { writeFile } from 'node:fs/promises';
import { pool } from '../db.js';
import { runMigrations } from '../db/migrate.js';
import { backfillAll, backfillModel, type BackfillAllResult } from '../c4/backfill.js';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  await runMigrations();

  const dryRun = process.argv.includes('--dry-run');
  const modelId = readArg('model');
  const reportPath = readArg('report');

  let result: BackfillAllResult;
  if (modelId) {
    const single = await backfillModel(modelId, { dryRun });
    result = {
      total: 1,
      applied: single.applied ? 1 : 0,
      failed: 0,
      results: [single],
      errors: [],
    };
  } else {
    result = await backfillAll({ dryRun });
  }

  const json = JSON.stringify(result, null, 2);
  if (reportPath) await writeFile(reportPath, `${json}\n`, 'utf8');
  console.log(json);

  if (result.failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[backfill] falha', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
