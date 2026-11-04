const WebSocket = require('ws');
const WS_URL = 'ws://localhost:4001/ws';
const MODEL_ID = '5b5583ce-bdf1-4fc3-8541-1e8fc8291910'; // demo model
let closed = false;
console.log('[ws] connecting...');
const ws = new WebSocket(WS_URL);
ws.on('open', () => {
  console.log('[ws] connected');
  ws.send(JSON.stringify({ type: 'join', modelId: MODEL_ID }));
});
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  console.log('[ws] RECV type=' + msg.type, '| modelId:', msg.modelId);
  const els = msg.model && Array.isArray(msg.model.elements) ? msg.model.elements : [];
  console.log('[ws]   elements count:', els.length);
  if (els.length) {
    els.forEach((e, i) => console.log('     -', i, e.type, e.title, 'at', e.positionX, e.positionY));
  }
  closed = true;
  ws.close();
});
ws.on('error', (e) => { console.log('[ws] error', e.message); });
setTimeout(() => { if (!closed) { ws.close(); } process.exit(0); }, 4000);
