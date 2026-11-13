import { connectDb, pool } from '../db.js';
import { runMigrations } from '../db/migrate.js';

/**
 * Aplica as migrações versionadas sem subir o servidor.
 *
 *   npm run db:migrate
 *
 * Útil em deploy (job separado) e em pipelines que precisam do schema antes de
 * iniciar API/worker. É idempotente: migrações já registradas são ignoradas.
 */
async function main() {
  await connectDb();
  await runMigrations();
  await pool.end();
}

main().catch((err) => {
  console.error('[db] Falha ao aplicar migrações:', err);
  process.exit(1);
});
