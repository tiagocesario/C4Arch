import { pool } from '../db.js';
import { runMigrations } from '../db/migrate.js';
import { shadowModel } from '../c4/shadow.js';
import { projectModel } from '../c4/projector.js';
import { flags } from '../flags.js';

/**
 * Reconciliação diária do M5.
 *
 * Compara legado × canônico para todos os modelos e, quando `model_state`
 * existe, também projeta o estado durável. Imprime um resumo por modelo e
 * retorna código 1 se houver divergências, para uso em cron/CI.
 */
const main = async () => {
  await runMigrations();

  const models = await pool.query<{ id: string; title: string }>(
    'SELECT id, title FROM models ORDER BY title'
  );

  let divergent = 0;
  let failed = 0;
  for (const model of models.rows) {
    try {
      const shadow = await shadowModel(model.id);
      const projection =
        flags.projectorShadow !== 'off' ? await projectModel(model.id, { mode: 'shadow' }) : null;

      const status = shadow.ok && (!projection || projection.ok) ? 'ok' : 'divergente';
      if (status === 'divergente') divergent += 1;
      console.log(
        `[reconcile] ${model.title} (${model.id}): ${status}` +
          ` (elementos=${shadow.expected.elements}, relações=${shadow.expected.relationships})` +
          (projection ? ` projeção=${projection.ok ? 'ok' : 'divergente'}` : '')
      );
      if (!shadow.ok) {
        for (const divergence of shadow.divergences.slice(0, 5)) {
          console.log(`  - ${divergence.kind} ${divergence.entityId ?? divergence.viewKey ?? ''}`);
        }
      }
    } catch (err) {
      failed += 1;
      console.error(`[reconcile] falha no modelo ${model.id}`, err);
    }
  }

  console.log(
    `[reconcile] total=${models.rows.length} divergentes=${divergent} falhas=${failed}`
  );
  await pool.end();
  process.exit(divergent > 0 || failed > 0 ? 1 : 0);
};

main().catch((err) => {
  console.error('[reconcile] falha fatal', err);
  process.exit(1);
});
