import http from 'http';
import { attachWebsocket, setStorageDir, loadStorageModels, closeAll, setApiBase } from './sync.js';

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

  server.listen(port, () => {
    console.log(`[realtime] WebSocket Yjs rodando na porta ${port}`);
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
