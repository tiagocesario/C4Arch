import http from 'http';
import { attachWebsocket, setStorageDir, loadStorageModels, closeAll, setApiBase, startPeriodicFlush } from './sync.js';
import { describeFlags } from './flags.js';

const port = Number(process.env.WS_PORT ?? 4001);
const storageDir = process.env.STORAGE_DIR ?? 'storage';
const allowAnonymous = process.env.WS_ALLOW_ANONYMOUS === 'true';

if (allowAnonymous) {
  console.warn(
    '[security] WS_ALLOW_ANONYMOUS=true: conexões WebSocket sem autenticação. Não use em produção.'
  );
}

setStorageDir(storageDir);
setApiBase(
  process.env.API_URL ?? 'http://api:4000',
  process.env.API_TOKEN_REALTIME ?? process.env.API_TOKEN ?? '',
);

const start = async () => {
  // Carrega os snapshots antes de aceitar conexões: evitar servir um modelo
  // vazio para um cliente que chega durante a inicialização.
  await loadStorageModels(storageDir);

  const server = http.createServer();
  attachWebsocket(server);
  // Flush periódico do estado durável (model_state), além do debounce por
  // alteração. Sem isso, uma sessão longa sem pausa poderia acumular patches.
  startPeriodicFlush();

  server.listen(port, () => {
    console.log(`[realtime] WebSocket Yjs rodando na porta ${port}`);
    console.log('[realtime] flags da Onda 1:', JSON.stringify(describeFlags()));
  });

  const shutdown = async (signal: string) => {
    console.log(`[realtime] recebido ${signal}, encerrando...`);
    await closeAll();
    server.close(() => {
      console.log('[realtime] encerrado.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
};

start().catch((err) => {
  console.error('[realtime] falha ao iniciar:', err);
  process.exit(1);
});
