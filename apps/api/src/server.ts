import express from 'express';
import cors from 'cors';
import { connectDb } from './db.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '100kb' }));

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

app.use('/api/auth', authRouter);
app.use('/api/orgs', orgsRouter);
app.use('/api/models', modelsRouter);
app.use('/api/models', elementsRouter);
app.use('/api/models', edgesRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/apps', appsRouter);
app.use('/api/services', servicesRouter);
app.use('/api/models', drawioRouter);

app.get('/', (_req, res) => {
  res.json({ name: 'C4Arch API', status: 'ok', version: '0.1.0' });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api] Unhandled error:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

export { app };
