import { app } from './server.js';
import { createServer } from 'http';
import { connectDb } from './db.js';
import { runMigrations } from './db/migrate.js';
import { seedDemo } from './db.js';

const start = async () => {
  await connectDb();
  await runMigrations();
  await seedDemo();
  const server = createServer(app);
  const port = Number(process.env.PORT ?? 4000);
  server.listen(port, () => console.log(`[api] C4Arch API rodando na porta ${port}`));
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const s of signals) {
    process.on(s, () => {
      console.log('[api] Recebido SIGTERM/SIGINT, encerrando...');
      server.close(() => process.exit(0));
    });
  }
};
start();
