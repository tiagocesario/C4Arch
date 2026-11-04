import { pool } from '../db.js';

export async function runMigrations() {
  const queries = [
    `CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS organizations (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug       TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS memberships (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role       TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (org_id, user_id)
    )`,

    `CREATE TABLE IF NOT EXISTS folders (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      parent_id  UUID REFERENCES folders(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (org_id, name)
    )`,

    `CREATE TABLE IF NOT EXISTS apps (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      kind        TEXT NOT NULL DEFAULT 'app' CHECK (kind IN ('app','service')),
      metadata    JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (org_id, name)
    )`,

    `CREATE TABLE IF NOT EXISTS services (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      protocol    TEXT NOT NULL DEFAULT 'http',
      port        INTEGER,
      metadata    JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS models (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      folder_id    UUID REFERENCES folders(id) ON DELETE SET NULL,
      title        TEXT NOT NULL,
      description  TEXT,
      status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
      drawio_xml   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS elements (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id   UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      app_id     UUID REFERENCES apps(id) ON DELETE SET NULL,
      service_id UUID REFERENCES services(id) ON DELETE SET NULL,
      type       TEXT NOT NULL CHECK (type IN ('actor','system','container','component')),
      title      TEXT NOT NULL,
      description TEXT,
      metadata   JSONB,
      position_x INTEGER NOT NULL DEFAULT 0,
      position_y INTEGER NOT NULL DEFAULT 0,
      "order"    INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS edges (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id   UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      from_id    UUID NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
      to_id      UUID NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
      label      TEXT,
      type       TEXT NOT NULL CHECK (type IN ('call','http','message','depends')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS comments (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id   UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      element_id UUID REFERENCES elements(id) ON DELETE SET NULL,
      content    TEXT NOT NULL,
      author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved   BOOLEAN NOT NULL DEFAULT FALSE
    )`,

    `CREATE TABLE IF NOT EXISTS model_versions (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id   UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      version    INTEGER NOT NULL,
      snapshot   JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL
    )`,

    `CREATE TABLE IF NOT EXISTS integrations (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL CHECK (kind IN ('drive','gitlab')),
      external_id TEXT,
      synced_at  TIMESTAMPTZ,
      status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','error')),
      error      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS apps (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      kind        TEXT NOT NULL DEFAULT 'app' CHECK (kind IN ('app','service')),
      metadata    JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS services (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      protocol    TEXT NOT NULL DEFAULT 'http',
      port        INTEGER,
      metadata    JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE INDEX IF NOT EXISTS idx_models_org_id ON models(org_id)`,
    `CREATE INDEX IF NOT EXISTS idx_models_folder_id ON models(folder_id)`,
    `CREATE INDEX IF NOT EXISTS idx_elements_model_id ON elements(model_id)`,
    `CREATE INDEX IF NOT EXISTS idx_edges_model_id ON edges(model_id)`,
    `CREATE INDEX IF NOT EXISTS idx_folders_org_id ON folders(org_id)`,
    `CREATE INDEX IF NOT EXISTS idx_apps_org_id ON apps(org_id)`,
    `CREATE INDEX IF NOT EXISTS idx_services_org_id ON services(org_id)`,
  ];

  for (const q of queries) {
    await pool.query(q);
  }

  const alters = [
    `ALTER TABLE models ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL`,
    `ALTER TABLE models ADD COLUMN IF NOT EXISTS drawio_xml TEXT`,
    `ALTER TABLE elements ADD COLUMN IF NOT EXISTS app_id UUID REFERENCES apps(id) ON DELETE SET NULL`,
    `ALTER TABLE elements ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'folders_org_name_key') THEN ALTER TABLE folders ADD CONSTRAINT folders_org_name_key UNIQUE (org_id, name); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apps_org_name_key') THEN ALTER TABLE apps ADD CONSTRAINT apps_org_name_key UNIQUE (org_id, name); END IF; END $$`,
  ];

  for (const q of alters) {
    try {
      await pool.query(q);
    } catch (err) {
      console.error('[db] Migration alter warning:', err);
    }
  }

  console.log('[db] ✓ Migrations aplicadas');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().catch((err) => {
    console.error('[db] Erro na migration:', err);
    process.exit(1);
  });
}
