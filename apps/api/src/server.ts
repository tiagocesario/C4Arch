import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import { metricsMiddleware, renderMetrics } from './observability/metrics.js';

const app = express();

// O draw.io oficial roda em outro domínio e pode buscar a biblioteca de shapes
// diretamente. Essas origens não recebem credenciais; o endpoint da biblioteca
// é somente leitura e exige token escopado.
const DRAWIO_ORIGINS = new Set([
  'https://embed.diagrams.net',
  'https://app.diagrams.net',
  'https://viewer.diagrams.net',
]);

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(metricsMiddleware);
app.use(
  helmet({
    // A página do draw.io precisa incorporar o embed.diagrams.net; a CSP dela
    // é definida explicitamente no controller.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      // Requisições sem Origin (curl, healthcheck, server-to-server) passam.
      if (!origin || config.corsOrigins.includes(origin) || DRAWIO_ORIGINS.has(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  })
);

// Importação de arquivos draw.io e autosave do editor podem enviar XML de
// vários megabytes. Essas rotas recebem um parser próprio, com limite maior,
// antes do parser global. O body-parser marca o corpo como já lido, então o
// parser global de 100 kB não tenta processá-lo novamente.
const LARGE_XML_JSON_LIMIT = '8mb';
const largeXmlJson = express.json({ limit: LARGE_XML_JSON_LIMIT });
// O estado Yjs é binário e trafega em base64; um documento grande pode passar
// de 100kb com folga. A rota é interna e autenticada por token de serviço.
const internalStateJson = express.json({ limit: '16mb' });

app.use((req, res, next) => {
  const isLargeXmlRoute =
    req.method === 'POST' &&
    (req.path === '/api/models/import' ||
      /^\/api\/models\/[^/]+\/drawio\/import\/?$/.test(req.path));
  if (isLargeXmlRoute) {
    return largeXmlJson(req, res, next);
  }
  const isInternalStateRoute =
    req.method === 'PUT' && /^\/api\/internal\/models\/[^/]+\/state\/?$/.test(req.path);
  if (isInternalStateRoute) {
    return internalStateJson(req, res, next);
  }
  return next();
});

app.use(express.json({ limit: '100kb' }));

// Rejeita corpos JSON que não sejam objetos antes que os controllers façam
// destructuring (null/array quebrariam com TypeError e virariam HTTP 500).
app.use((req, res, next) => {
  if (
    req.body !== undefined &&
    (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body))
  ) {
    return res.status(400).json({ error: 'Corpo da requisição deve ser um objeto JSON' });
  }
  return next();
});

// Healthcheck para Docker/Compose. Verifica também o banco.
app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ status: 'ok' });
  } catch {
    return res.status(503).json({ status: 'unavailable' });
  }
});

// Métricas no formato Prometheus. Desabilitado por padrão em produção; ligue
// com METRICS_ENABLED=true e exponha apenas na rede interna.
app.get('/metrics', (_req, res) => {
  if (!config.metricsEnabled) {
    return res.status(404).json({ error: 'Recurso não encontrado' });
  }
  res.type('text/plain; version=0.0.4; charset=utf-8').send(renderMetrics());
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // O autosave do draw.io envia alterações com debounce; 300 requisições por
  // 15 min era apertado para uma sessão longa de edição.
  limit: 1200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de autenticação. Tente novamente mais tarde.' },
});

app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Rotas
import authRouter from './routes/auth.routes.js';
import orgsRouter from './routes/orgs.routes.js';
import modelsRouter from './routes/models.routes.js';
import elementsRouter from './routes/elements.routes.js';
import edgesRouter from './routes/edges.routes.js';
import foldersRouter from './routes/folders.routes.js';
import appsRouter from './routes/apps.routes.js';
import servicesRouter from './routes/services.routes.js';
import drawioRouter from './routes/drawio.routes.js';
import groupsRouter from './routes/groups.routes.js';
import internalRouter from './routes/internal.routes.js';

app.use('/api/auth', authRouter);
app.use('/api/orgs', orgsRouter);
app.use('/api/models', modelsRouter);
app.use('/api/models', elementsRouter);
app.use('/api/models', edgesRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/apps', appsRouter);
app.use('/api/services', servicesRouter);
app.use('/api/models', drawioRouter);
app.use('/api/groups', groupsRouter);

// Rotas internas só existem quando há token de serviço configurado.
if (config.internalToken) {
  app.use('/api/internal', internalRouter);
}

app.get('/', (_req, res) => {
  res.json({ name: 'C4Arch API', status: 'ok', version: '0.1.0' });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Recurso não encontrado' });
});

app.use(
  (
    err: { type?: string; status?: number; message?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON inválido' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Corpo da requisição muito grande' });
    }

    const status =
      typeof err?.status === 'number' && err.status >= 400 && err.status < 500
        ? err.status
        : 500;

    if (status === 500) {
      console.error('[api] Unhandled error:', err);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    return res.status(status).json({ error: 'Requisição inválida' });
  }
);

export { app };
