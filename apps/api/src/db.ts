import pg from 'pg';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'c4arch',
  user: process.env.DB_USER ?? 'c4arch',
  password: process.env.DB_PASSWORD ?? 'change-me-please',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export async function connectDb() {
  try {
    const client = await pool.connect();
    console.log('[db] Conectado ao PostgreSQL');
    client.release();
  } catch (err) {
    console.error('[db] Falha na conexao com o PostgreSQL:', err);
    process.exit(1);
  }
}

export { pool };

export async function seedDemo() {
  const client = await pool.connect();
  try {
    const modelCnt = (await client.query('SELECT COUNT(*)::int AS n FROM models')).rows[0].n;
    if (modelCnt > 0) return;

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('admin123', salt, 64).toString('hex');
    const passwordHash = `${salt}${hash}`;

    const userRes = await client.query(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      ['admin@example.com', 'Administrador', passwordHash]
    );
    let user = userRes.rows[0];
    if (!user) {
      user = (await client.query('SELECT id FROM users WHERE email = $1', ['admin@example.com'])).rows[0];
    }
    if (!user) return;

    const orgRes = await client.query(
      `INSERT INTO organizations (slug, name)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      ['demo', 'Demo']
    );
    let org = orgRes.rows[0];
    if (!org) {
      org = (await client.query('SELECT id FROM organizations WHERE slug = $1', ['demo'])).rows[0];
    }
    if (!org) return;

    await client.query(
      `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [org.id, user.id]
    );

    const folderRes = await client.query(
      `INSERT INTO folders (org_id, name, parent_id)
       VALUES ($1, $2, NULL)
       ON CONFLICT (org_id, name) DO NOTHING
       RETURNING id`,
      [org.id, 'Demo']
    );
    const folder = folderRes.rows[0];

    const modelRes = await client.query(
      `INSERT INTO models (org_id, folder_id, title, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [org.id, folder?.id, 'Modelo C4 - Demo', 'draft']
    );
    const model = modelRes.rows[0];
    if (!model) return;
    const modelId = model.id;

    const elements = [
      { id: randomUUID(), title: 'Usuário Atuador', type: 'actor', description: '', positionX: 120, positionY: 120, order: 0 },
      { id: randomUUID(), title: 'Sistema', type: 'system', description: '', positionX: 420, positionY: 120, order: 1 },
      { id: randomUUID(), title: 'Container Web', type: 'container', description: '', positionX: 120, positionY: 360, order: 2 },
      { id: randomUUID(), title: 'Editor de Componentes', type: 'component', description: '', positionX: 420, positionY: 360, order: 3 },
    ];
    for (const el of elements) {
      await client.query(
        `INSERT INTO elements (model_id, id, type, title, description, position_x, position_y, "order")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [modelId, el.id, el.type, el.title, el.description, el.positionX, el.positionY, el.order]
      );
    }
    const edge = (await client.query(
      `INSERT INTO edges (model_id, from_id, to_id, label, type) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [modelId, elements[0].id, elements[1].id, 'Demo', 'call'])
    ).rows[0];

    const appRes = await client.query(
      `INSERT INTO apps (org_id, name, description, kind) VALUES ($1, $2, $3, $4) RETURNING id`,
      [org.id, 'Frontend Web', 'Aplicação React do C4Arch', 'app']
    );
    const app = appRes.rows[0];
    if (app) {
      await client.query(
        `INSERT INTO elements (model_id, app_id, type, title, description, position_x, position_y, "order")
         VALUES ($1,$2,'container','Frontend Web','Renderização do editor',660,120,4)`,
        [modelId, app.id]
      );
    }

    const serviceRes = await client.query(
      `INSERT INTO services (org_id, name, description, protocol, port) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [org.id, 'API REST', 'Backend Node.js + Express', 'http', 4000]
    );
    const service = serviceRes.rows[0];
    if (service) {
      await client.query(
        `INSERT INTO elements (model_id, service_id, type, title, description, position_x, position_y, "order")
         VALUES ($1,$2,'system','API REST','Node.js + Express',660,360,5)`,
        [modelId, service.id]
      );
    }

    const dir = process.env.STORAGE_DIR ?? join(process.cwd(), 'storage');
    await fs.mkdir(dir, { recursive: true });
    const elems = (await client.query(
      `SELECT id, type, title, description, metadata, position_x AS positionX, position_y AS positionY, "order"
       FROM elements WHERE model_id=$1 ORDER BY "order"`,
      [modelId]
    )).rows;
    const edges = (await client.query(
      `SELECT id, from_id, to_id, label, type FROM edges WHERE model_id=$1`,
      [modelId]
    )).rows;
    await fs.writeFile(join(dir, modelId + '.json'), JSON.stringify({ modelId, elements: elems, edges }, null, 2), 'utf8');
  } finally {
    client.release();
  }
}
