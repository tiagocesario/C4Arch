// Servidor estático mínimo para o build do frontend.
//
// Substitui o pacote `serve` (que trazia dependências vulneráveis) por um
// servidor Node sem dependências externas. Serve `dist` com fallback de SPA,
// headers de segurança e cache adequado para assets com hash.

import { createReadStream, promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';

const port = Number(process.env.PORT ?? 3000);
const root = resolve(process.env.STATIC_DIR ?? 'dist');
const indexFile = join(root, 'index.html');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self' http: https: ws: wss:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
}

function sendError(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(message);
}

function isInsideRoot(filePath) {
  const rel = relative(root, filePath);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep));
}

async function resolveFile(pathname) {
  const rel = pathname.replace(/^\/+/, '');
  let filePath = resolve(root, rel);

  if (!isInsideRoot(filePath)) return null;

  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) return { filePath, stat };
    if (stat.isDirectory()) {
      filePath = join(filePath, 'index.html');
      const indexStat = await fs.stat(filePath);
      if (indexStat.isFile() && isInsideRoot(filePath)) {
        return { filePath, stat: indexStat };
      }
    }
  } catch {
    // Cai no fallback de SPA abaixo.
  }

  // Rotas do React (sem extensão) usam o index.html; assets ausentes dão 404.
  if (extname(pathname)) return null;

  try {
    const stat = await fs.stat(indexFile);
    if (stat.isFile()) return { filePath: indexFile, stat };
  } catch {
    // sem index
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendError(res, 405, 'Method Not Allowed');
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      return sendError(res, 400, 'Bad Request');
    }

    if (pathname.includes('\0')) {
      return sendError(res, 400, 'Bad Request');
    }

    const found = await resolveFile(pathname);
    if (!found) {
      return sendError(res, 404, 'Not Found');
    }

    const { filePath, stat } = found;
    const extension = extname(filePath).toLowerCase();
    const isHtml = extension === '.html';

    setSecurityHeaders(res);
    res.setHeader('Content-Type', MIME_TYPES[extension] ?? 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    res.setHeader(
      'Cache-Control',
      isHtml ? 'no-store' : 'public, max-age=31536000, immutable'
    );

    if (req.method === 'HEAD') {
      res.statusCode = 200;
      return res.end();
    }

    res.statusCode = 200;
    const stream = createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) sendError(res, 500, 'Internal Server Error');
      else res.destroy();
    });
    stream.pipe(res);
  } catch (err) {
    console.error('[web] erro ao servir requisição:', err);
    if (!res.headersSent) sendError(res, 500, 'Internal Server Error');
    else res.destroy();
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[web] C4Arch servindo ${root} na porta ${port}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[web] recebido ${signal}, encerrando...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
