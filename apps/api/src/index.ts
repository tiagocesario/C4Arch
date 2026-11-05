import { app } from './server.js';
import { createServer } from 'http';
import { connectDb, seedDemo } from './db.js';
import { runMigrations } from './db/migrate.js';
import { config } from './config.js';

const start = async () => {
  await connectDb();
  await runMigrations();

  if (config.seedDemo) {
    await seedDemo();
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
