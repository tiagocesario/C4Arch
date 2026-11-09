import { app } from './server.js';
import { createServer } from 'http';
import { connectDb, seedDemo } from './db.js';
import { runMigrations } from './db/migrate.js';
import { regenerateAllDAS } from './c4/das.js';
import { backfillCatalogFromModels } from './c4/catalog-import.js';
import { config } from './config.js';

const start = async () => {
  await connectDb();
  await runMigrations();

  if (config.seedDemo) {
    await seedDemo();
  }

  // Aplica o DAS enriquecido a todos os modelos existentes (novos e antigos).
  try {
    const changed = await regenerateAllDAS();
    if (changed > 0) {
      console.log(`[api] DAS regenerado para ${changed} modelo(s) existente(s)`);
    }
  } catch (err) {
    console.error('[api] Falha ao regenerar DAS dos modelos existentes', err);
  }

  // Modelos importados antes da criação do catálogo automático passam a
  // aparecer em Apps/Serviços. A operação é idempotente.
  try {
    const catalog = await backfillCatalogFromModels();
    if (catalog.created.apps > 0 || catalog.created.services > 0) {
      console.log(
        `[api] Catálogo preenchido a partir de ${catalog.models} modelo(s): ` +
          `${catalog.created.apps} app(s), ${catalog.created.services} serviço(s)`
      );
    }
  } catch (err) {
    console.error('[api] Falha ao preencher o catálogo a partir dos modelos', err);
  }

  const server = createServer(app);
  const port = Number(process.env.PORT ?? 4000);

  server.listen(port, () => {
    console.log(`[api] C4Arch API rodando na porta ${port}`);
    if (config.seedDemo) {
      console.warn('[api] Seed de demonstração habilitado (SEED_DEMO=true). Não use em produção.');
    }
  });

  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const signal of signals) {
    process.on(signal, () => {
      console.log(`[api] Recebido ${signal}, encerrando...`);
      server.close(() => process.exit(0));
    });
  }
};

start().catch((err) => {
  console.error('[api] Falha ao iniciar:', err);
  process.exit(1);
});
