import { pool } from '../db.js';

export const schemaQueries = [
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
      c4_type      TEXT NOT NULL DEFAULT 'container',
      c4_scope     TEXT,
      parent_id    UUID REFERENCES models(id) ON DELETE CASCADE,
      drawio_xml   TEXT,
      diagrams     JSONB NOT NULL DEFAULT '[]'::jsonb,
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

    `CREATE TABLE IF NOT EXISTS access_groups (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      base_role   TEXT NOT NULL CHECK (base_role IN ('owner','editor','viewer')),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (org_id, name)
    )`,

    `CREATE TABLE IF NOT EXISTS access_group_members (
      group_id  UUID NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
      user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS login_domain_rules (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      domain     TEXT NOT NULL,
      role       TEXT NOT NULL CHECK (role IN ('viewer','editor','owner')) DEFAULT 'viewer',
      enabled    BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (org_id, domain)
    )`,

    // ── Onda 1 / M1: modelo canônico, views, estado e overrides ────────────
    `CREATE TABLE IF NOT EXISTS model_elements (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id          UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      parent_element_id UUID REFERENCES model_elements(id) ON DELETE CASCADE,
      identifier        TEXT NOT NULL,
      kind              TEXT NOT NULL CHECK (kind IN (
                          'person','software_system','container','component',
                          'deployment_node','infrastructure_node',
                          'container_instance','software_system_instance')),
      name              TEXT NOT NULL,
      description       TEXT,
      technology        TEXT,
      url               TEXT,
      tags              TEXT[] NOT NULL DEFAULT '{}',
      properties        JSONB NOT NULL DEFAULT '{}'::jsonb,
      app_id            UUID REFERENCES apps(id) ON DELETE SET NULL,
      service_id        UUID REFERENCES services(id) ON DELETE SET NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (model_id, identifier)
    )`,

    `CREATE TABLE IF NOT EXISTS model_relationships (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id    UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      source_id   UUID NOT NULL REFERENCES model_elements(id) ON DELETE CASCADE,
      target_id   UUID NOT NULL REFERENCES model_elements(id) ON DELETE CASCADE,
      description TEXT,
      technology  TEXT,
      tags        TEXT[] NOT NULL DEFAULT '{}',
      properties  JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (source_id <> target_id)
    )`,

    `CREATE TABLE IF NOT EXISTS model_views (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id         UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      key              TEXT NOT NULL,
      type             TEXT NOT NULL CHECK (type IN (
                         'system_context','container','component','dynamic',
                         'deployment','filtered','image')),
      scope_element_id UUID REFERENCES model_elements(id) ON DELETE SET NULL,
      title            TEXT,
      description      TEXT,
      include          JSONB NOT NULL DEFAULT '[]'::jsonb,
      exclude          JSONB NOT NULL DEFAULT '[]'::jsonb,
      auto_layout      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (model_id, key)
    )`,

    `CREATE TABLE IF NOT EXISTS model_view_layout (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      view_id    UUID NOT NULL REFERENCES model_views(id) ON DELETE CASCADE,
      element_id UUID REFERENCES model_elements(id) ON DELETE CASCADE,
      object_key TEXT,
      x          DOUBLE PRECISION,
      y          DOUBLE PRECISION,
      width      DOUBLE PRECISION,
      height     DOUBLE PRECISION,
      style      JSONB NOT NULL DEFAULT '{}'::jsonb
    )`,

    `CREATE TABLE IF NOT EXISTS model_state (
      model_id     UUID PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
      state        BYTEA NOT NULL,
      state_vector BYTEA,
      content_hash TEXT NOT NULL,
      revision     BIGINT NOT NULL DEFAULT 0,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by   UUID REFERENCES users(id) ON DELETE SET NULL
    )`,

    `CREATE TABLE IF NOT EXISTS model_das_overrides (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id    UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      section_key TEXT NOT NULL,
      content     TEXT,
      mode        TEXT NOT NULL DEFAULT 'replace'
                  CHECK (mode IN ('replace','append','hide')),
      updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (model_id, section_key)
    )`,

    `CREATE INDEX IF NOT EXISTS idx_model_elements_model
       ON model_elements(model_id)`,
    `CREATE INDEX IF NOT EXISTS idx_model_elements_parent
       ON model_elements(parent_element_id)`,
    `CREATE INDEX IF NOT EXISTS idx_model_elements_kind
       ON model_elements(model_id, kind)`,
    `CREATE INDEX IF NOT EXISTS idx_model_relationships_model
       ON model_relationships(model_id)`,
    `CREATE INDEX IF NOT EXISTS idx_model_relationships_source
       ON model_relationships(source_id)`,
    `CREATE INDEX IF NOT EXISTS idx_model_relationships_target
       ON model_relationships(target_id)`,
    `CREATE INDEX IF NOT EXISTS idx_model_views_model
       ON model_views(model_id)`,
    `CREATE INDEX IF NOT EXISTS idx_model_views_scope
       ON model_views(scope_element_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_model_view_layout_element
       ON model_view_layout(view_id, element_id)
       WHERE element_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_model_view_layout_object
       ON model_view_layout(view_id, object_key)
       WHERE object_key IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_model_das_overrides_model
       ON model_das_overrides(model_id)`,
];

export const schemaAlters = [
    `ALTER TABLE models ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL`,
    `ALTER TABLE models ADD COLUMN IF NOT EXISTS drawio_xml TEXT`,
    `ALTER TABLE models ADD COLUMN IF NOT EXISTS c4_type TEXT NOT NULL DEFAULT 'container'`,
    `ALTER TABLE models ADD COLUMN IF NOT EXISTS c4_scope TEXT`,
    `ALTER TABLE models ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES models(id) ON DELETE CASCADE`,
    `ALTER TABLE models ADD COLUMN IF NOT EXISTS diagrams JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE models ADD COLUMN IF NOT EXISTS das_content TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_models_parent_id ON models(parent_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_models_group_c4type ON models (COALESCE(parent_id, id), c4_type)`,
    `CREATE INDEX IF NOT EXISTS idx_models_c4_type ON models(c4_type)`,
    `ALTER TABLE elements ADD COLUMN IF NOT EXISTS app_id UUID REFERENCES apps(id) ON DELETE SET NULL`,
    `ALTER TABLE elements ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'folders_org_name_key') THEN ALTER TABLE folders ADD CONSTRAINT folders_org_name_key UNIQUE (org_id, name); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apps_org_name_key') THEN ALTER TABLE apps ADD CONSTRAINT apps_org_name_key UNIQUE (org_id, name); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_org_name_key') AND NOT EXISTS (SELECT 1 FROM services GROUP BY org_id, name HAVING count(*) > 1) THEN ALTER TABLE services ADD CONSTRAINT services_org_name_key UNIQUE (org_id, name); END IF; END $$`,

    // ── Onda 1 / M1: metadados de DAS e versionamento por conteúdo ─────────
    `ALTER TABLE models ADD COLUMN IF NOT EXISTS das_generated_at TIMESTAMPTZ`,
    `ALTER TABLE models ADD COLUMN IF NOT EXISTS das_source_hash TEXT`,
    `ALTER TABLE models ADD COLUMN IF NOT EXISTS das_override_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS content_hash TEXT`,
    `ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS author_id UUID REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS label TEXT`,
    `ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'auto' CHECK (kind IN ('auto','manual','restore','import'))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_model_versions_hash
       ON model_versions(model_id, content_hash)
       WHERE content_hash IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_model_versions_model_created
       ON model_versions(model_id, created_at DESC)`,
];

export async function runMigrations() {
  for (const q of schemaQueries) {
    await pool.query(q);
  }

  for (const q of schemaAlters) {
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
