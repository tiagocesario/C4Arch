const { Pool } = require('pg');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { promises: fs } = require('fs');
const { join } = require('path');

(async () => {
  const pool = new Pool({host:'localhost',port:5432,database:'c4arch',user:'c4arch',password:'change-me-please'});
  const client = await pool.connect();
  try {
    const modelCnt = (await client.query('SELECT COUNT(*)::int AS n FROM models')).rows[0].n;
    if (modelCnt > 0) { console.log('seed skip'); return; }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('admin123', salt, 64).toString('hex');
    const passwordHash = salt + hash;
    const userRes = await client.query('INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING RETURNING id', ['admin@example.com','Administrador',passwordHash]);
    const user = userRes.rows[0];
    if (!user) { console.log('user exists'); return; }
    const orgRes = await client.query('INSERT INTO organizations (slug, name) VALUES ($1,$2) ON CONFLICT (slug) DO NOTHING RETURNING id', ['demo','Demo']);
    const org = orgRes.rows[0];
    if (!org) { console.log('org exists'); return; }
    await client.query('INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (org_id, user_id) DO NOTHING', [org.id, user.id, 'owner']);
    const folderRes = await client.query('INSERT INTO folders (org_id, name, parent_id) VALUES ($1,$2,$3) ON CONFLICT (org_id, name) DO NOTHING RETURNING id', [org.id, 'Demo', null]);
    const folder = folderRes.rows[0];
    const modelRes = await client.query('INSERT INTO models (org_id, folder_id, title, status) VALUES ($1,$2,$3,$4) RETURNING id', [org.id, folder?.id, 'Modelo C4 - Demo', 'draft']);
    const model = modelRes.rows[0];
    if (!model) return;
    const modelId = model.id;
    const elements = [
      {id: randomUUID(), title:'Usuário Atuador', type:'actor', description:'', positionX:120, positionY:120, order:0},
      {id: randomUUID(), title:'Sistema', type:'system', description:'', positionX:420, positionY:120, order:1},
      {id: randomUUID(), title:'Container Web', type:'container', description:'', positionX:120, positionY:360, order:2},
      {id: randomUUID(), title:'Editor de Componentes', type:'component', description:'', positionX:420, positionY:360, order:3},
    ];
    for (const el of elements) {
      await client.query('INSERT INTO elements (model_id, id, type, title, description, position_x, position_y, "order") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [modelId, el.id, el.type, el.title, el.description, el.positionX, el.positionY, el.order]);
    }
    await client.query('INSERT INTO edges (model_id, from_id, to_id, label, type) VALUES ($1,$2,$3,$4,$5)', [modelId, elements[0].id, elements[1].id, 'Demo', 'call']);
    const appRes = await client.query('INSERT INTO apps (org_id, name, description, kind) VALUES ($1,$2,$3,$4) RETURNING id', [org.id, 'Frontend Web', 'Aplicação React do C4Arch', 'app']);
    const app = appRes.rows[0];
    if (app) {
      await client.query('INSERT INTO elements (model_id, app_id, type, title, description, position_x, position_y, "order") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [modelId, app.id, 'container', 'Frontend Web', 'Renderização do editor', 660, 120, 4]);
    }
    const serviceRes = await client.query('INSERT INTO services (org_id, name, description, protocol, port) VALUES ($1,$2,$3,$4,$5) RETURNING id', [org.id, 'API REST', 'Backend Node.js + Express', 'http', 4000]);
    const service = serviceRes.rows[0];
    if (service) {
      await client.query('INSERT INTO elements (model_id, service_id, type, title, description, position_x, position_y, "order") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [modelId, service.id, 'system', 'API REST', 'Node.js + Express', 660, 360, 5]);
    }
    console.log('seed ok');
  } finally {
    client.release();
    await pool.end();
  }
})();
