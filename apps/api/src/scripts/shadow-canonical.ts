import { writeFile } from 'node:fs/promises';
import { pool } from '../db.js';
import { runMigrations } from '../db/migrate.js';
import {
  formatShadowSummary,
  shadowAllModels,
  shadowModel,
  type ShadowAllResult,
} from '../c4/shadow.js';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  await runMigrations();

  const modelId = readArg('model');
  const reportPath = readArg('report');
  const failOnDivergence = process.argv.includes('--fail-on-divergence');

  let result: ShadowAllResult;
  if (modelId) {
    const report = await shadowModel(modelId);
    result = {
      total: 1,
      ok: report.ok ? 1 : 0,
      divergent: report.ok ? 0 : 1,
      failed: 0,
      reports: [report],
      errors: [],
    };
  } else {
    result = await shadowAllModels();
  }

  const lines = result.reports.map(formatShadowSummary);
  if (lines.length > 0) console.log(lines.join('\n'));
  for (const error of result.errors) {
    console.error(`[shadow] modelo ${error.modelId}: ${error.error}`);
  }

  if (reportPath) {
    await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }

  if (result.failed > 0 || (failOnDivergence && result.divergent > 0)) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('[shadow] falha', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
