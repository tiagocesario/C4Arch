import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import { metricsMiddleware, renderMetrics } from './observability/metrics.js';
import { requestContext } from './observability/http.js';
import { idempotencyMiddleware } from './security/idempotency.js';
import { buildOpenApiDocument, renderDocsHtml } from './openapi.js';
import { ApiError, errorBody } from './errors.js';

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
app.use(requestContext);
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
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Idempotency-Replayed', 'Content-Disposition'],
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
      req.path === '/api/models/import/structurizr' ||
      /^\/api\/models\/[^/]+\/import\/structurizr\/?$/.test(req.path) ||
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

// Idempotência opcional para métodos mutantes. Fica depois do parser para
// hashear o corpo e antes das rotas para capturar a resposta JSON.
app.use('/api', idempotencyMiddleware);

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

// Contrato OpenAPI e documentação interativa.
app.get('/api/openapi.json', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json(buildOpenApiDocument());
});
app.get('/api/docs', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.type('text/html; charset=utf-8').send(renderDocsHtml());
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
import auditRouter from './routes/audit.routes.js';
import internalRouter from './routes/internal.routes.js';
import exportsRouter from './routes/exports.routes.js';
import importsRouter from './routes/imports.routes.js';
import viewsRouter from './routes/views.routes.js';
import commentsRouter from './routes/comments.routes.js';

app.use('/api/auth', authRouter);
app.use('/api/orgs', orgsRouter);
// Importação Structurizr precisa vir antes do CRUD de modelos para que
// `/api/models/import/structurizr` não caia em `/:id`.
app.use('/api/models', importsRouter);
app.use('/api/models', modelsRouter);
app.use('/api/models', elementsRouter);
app.use('/api/models', edgesRouter);
app.use('/api/models', exportsRouter);
app.use('/api/models', viewsRouter);
app.use('/api/models', commentsRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/apps', appsRouter);
app.use('/api/services', servicesRouter);
app.use('/api/models', drawioRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/audit', auditRouter);

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
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    const candidate = err as {
      type?: string;
      status?: number;
      message?: string;
      statusCode?: number;
    };

    if (candidate?.type === 'entity.parse.failed') {
      return res.status(400).json(errorBody('INVALID_JSON', 'JSON inválido'));
    }
    if (candidate?.type === 'entity.too.large') {
      return res.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'Corpo da requisição muito grande'));
    }
    if (err instanceof ApiError) {
      return res.status(err.status).json(errorBody(err.code, err.message, err.details));
    }

    const status =
      typeof candidate?.status === 'number' && candidate.status >= 400 && candidate.status < 500
        ? candidate.status
        : typeof candidate?.statusCode === 'number' &&
            candidate.statusCode >= 400 &&
            candidate.statusCode < 500
          ? candidate.statusCode
          : 500;

    if (status === 500) {
      console.error('[api] Unhandled error:', err);
      return res.status(500).json(errorBody('INTERNAL_ERROR', 'Erro interno do servidor'));
    }

    return res.status(status).json(errorBody('BAD_REQUEST', candidate?.message ?? 'Requisição inválida'));
  }
);

export { app };
