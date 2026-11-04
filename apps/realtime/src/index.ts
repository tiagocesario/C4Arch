import http from 'http';
import { attachWebsocket, setStorageDir, loadStorageModels } from './sync.js';

const port = Number(process.env.WS_PORT ?? 4001);
const storageDir = process.env.STORAGE_DIR ?? 'storage';
setStorageDir(storageDir);

const server = http.createServer();
attachWebsocket(server);
loadStorageModels(storageDir);
server.listen(port, () => {
  console.log(`[realtime] WebSocket Yjs rodando na porta ${port}`);
});

process.on('SIGTERM', () => {
  console.log('[realtime] recebido SIGTERM, encerrando...');
  server.close(() => console.log('[realtime] encerrado.'));
});

process.on('SIGINT', () => {
  console.log('[realtime] recebido SIGINT, encerrando...');
  server.close(() => console.log('[realtime] encerrado.'));
});
