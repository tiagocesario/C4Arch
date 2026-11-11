import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import {
  computeContentHash,
  computeDasSourceHash,
  diffDasSections,
  normalizeText,
  toCanonicalElement,
  toCanonicalRelationship,
  VIEW_TYPE_LABEL,
  viewTypeFromC4Type,
  type BackfillWarning,
  type CanonicalDasOverride,
  type CanonicalElement,
  type CanonicalElementKind,
  type CanonicalLayoutRow,
  type CanonicalRelationship,
  type CanonicalSnapshot,
  type CanonicalVersion,
  type CanonicalView,
  type CanonicalViewType,
  type LegacyEdgeRow,
  type LegacyElementRow,
  type LegacyModelRow,
} from './canonical.js';
import { extractDiagramLayout } from './diagram-layout.js';
import { parseDiagrams } from './diagrams.js';
import { generateDAS, loadDasAssets } from './das.js';

/**
 * Backfill do modelo canônico (M2).
 *
 * O legado continua sendo a fonte de leitura. Este módulo copia `elements`,
 * `edges`, `models.c4_type`/`diagrams`, posições do XML, versões e o DAS
 * editado para as tabelas canônicas. A resposta das APIs não muda.
 */

export interface LegacyVersionInput {
  id: string;
  version: number;
  snapshot: unknown;
  created_by?: string | null;
  content_hash?: string | null;
}

export interface BuildSnapshotInput {
  model: LegacyModelRow;
  parentModel?: LegacyModelRow | null;
  elements: LegacyElementRow[];
  edges: LegacyEdgeRow[];
  versions?: LegacyVersionInput[];
  existingVersionHashes?: string[];
  dasGenerated?: string | null;
  /**
   * Quando `false`, o layout não é lido do XML draw.io; usa apenas as posições
   * do estado colaborativo. O projetor do M3 usa essa opção para que o Yjs seja
   * a fonte do layout.
   */
  layoutFromXml?: boolean;
}

export interface BackfillOptions {
  dryRun?: boolean;
  includeDas?: boolean;
  prune?: boolean;
}

export interface BackfillResult {
  modelId: string;
  title: string;
  dryRun: boolean;
  applied: boolean;
  stats: CanonicalSnapshot['stats'];
  warnings: BackfillWarning[];
}

export interface BackfillAllResult {
  total: number;
  applied: number;
  failed: number;
  results: BackfillResult[];
  errors: Array<{ modelId: string; error: string }>;
}

const KIND_LEVEL: Record<CanonicalElementKind, number> = {
  person: 0,
  software_system: 1,
  deployment_node: 1,
  infrastructure_node: 1,
  container: 2,
  component: 3,
  container_instance: 4,
  software_system_instance: 4,
};

const PREFERRED_SCOPE_KINDS: Record<CanonicalViewType, CanonicalElementKind[]> = {
  system_context: [],
  container: ['software_system'],
  component: ['container'],
  deployment: ['software_system', 'deployment_node', 'infrastructure_node'],
  dynamic: [],
  filtered: [],
  image: [],
};

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function nameIndex(elements: CanonicalElement[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const element of elements) {
    const key = normalizeName(element.name);
    const ids = index.get(key) ?? [];
    ids.push(element.id);
    index.set(key, ids);
  }
  return index;
}

function resolveScope(
  scopeText: string | null,
  elements: CanonicalElement[],
  viewType: CanonicalViewType,
  warnings: BackfillWarning[]
): string | null {
  if (!scopeText || viewType === 'system_context') return null;

  const normalized = normalizeName(scopeText);
  const candidates = elements.filter(
    (element) =>
      normalizeName(element.name) === normalized ||
      normalizeName(element.identifier) === normalized
  );

  if (candidates.length === 0) {
    warnings.push({
      code: 'SCOPE_UNRESOLVED',
      message: `Escopo "${scopeText}" não corresponde a nenhum elemento do modelo.`,
    });
    return null;
  }

  const preferredKinds = PREFERRED_SCOPE_KINDS[viewType];
  if (preferredKinds.length > 0) {
    const preferred = candidates.filter((element) => preferredKinds.includes(element.kind));
    if (preferred.length === 1) return preferred[0].id;
    if (preferred.length > 1) {
      warnings.push({
        code: 'SCOPE_AMBIGUOUS',
        message: `Escopo "${scopeText}" corresponde a ${preferred.length} elementos; mantido NULL.`,
      });
      return null;
    }
    warnings.push({
      code: 'SCOPE_KIND_MISMATCH',
      message: `Escopo "${scopeText}" não corresponde a um elemento compatível com a view ${viewType}.`,
    });
    return null;
  }

  if (candidates.length === 1) return candidates[0].id;

  warnings.push({
    code: 'SCOPE_AMBIGUOUS',
    message: `Escopo "${scopeText}" corresponde a ${candidates.length} elementos; mantido NULL.`,
  });
  return null;
}

function hasGeometry(
  row: CanonicalLayoutRow
): row is CanonicalLayoutRow & { x: number; y: number; width: number; height: number } {
  return (
    row.x !== null &&
    row.y !== null &&
    row.width !== null &&
    row.height !== null &&
    row.width > 0 &&
    row.height > 0
  );
}

function contains(
  parent: CanonicalLayoutRow & { x: number; y: number; width: number; height: number },
  child: CanonicalLayoutRow & { x: number; y: number; width: number; height: number }
): boolean {
  const tolerance = 0.5;
  return (
    parent.x <= child.x + tolerance &&
    parent.y <= child.y + tolerance &&
    parent.x + parent.width >= child.x + child.width - tolerance &&
    parent.y + parent.height >= child.y + child.height - tolerance
  );
}

/**
 * Inferência conservadora de hierarquia por contenção geométrica: o menor
 * shape que contém o outro e tem nível C4 imediatamente superior vira pai.
 */
function inferParents(
  layout: CanonicalLayoutRow[],
  elements: CanonicalElement[],
  primaryViewKey: string
): void {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const rows = layout.filter(
    (row): row is CanonicalLayoutRow & { element_id: string; x: number; y: number; width: number; height: number } =>
      row.viewKey === primaryViewKey && row.element_id !== null && hasGeometry(row)
  );

  for (const child of rows) {
    const childElement = byId.get(child.element_id);
    if (!childElement || childElement.parent_element_id) continue;

    let best: { id: string; area: number } | null = null;
    for (const parent of rows) {
      if (parent.element_id === child.element_id) continue;
      const parentElement = byId.get(parent.element_id);
      if (!parentElement) continue;
      if (KIND_LEVEL[parentElement.kind] >= KIND_LEVEL[childElement.kind]) continue;
      if (!contains(parent, child)) continue;

      const area = parent.width * parent.height;
      if (!best || area < best.area) {
        best = { id: parentElement.id, area };
      }
    }

    if (best) childElement.parent_element_id = best.id;
  }
}

function buildViews(
  model: LegacyModelRow,
  elements: CanonicalElement[],
  parentModel: LegacyModelRow | null | undefined,
  warnings: BackfillWarning[]
): CanonicalView[] {
  const primaryType = model.c4_type || 'container';
  const entries: Array<{ c4Type: string }> = [{ c4Type: primaryType }];
  const seen = new Set([primaryType]);

  for (const diagram of parseDiagrams(model.diagrams)) {
    if (seen.has(diagram.c4Type)) continue;
    seen.add(diagram.c4Type);
    entries.push({ c4Type: diagram.c4Type });
  }

  const scopeText = normalizeText(model.c4_scope) ?? normalizeText(parentModel?.c4_scope);

  return entries.map(({ c4Type }) => {
    const type = viewTypeFromC4Type(c4Type);
    return {
      model_id: model.id,
      key: c4Type,
      type,
      scope_element_id: resolveScope(scopeText, elements, type, warnings),
      title: `${model.title} — ${VIEW_TYPE_LABEL[type]}`,
      description: `Migrada do diagrama legado "${c4Type}".`,
      include: [{ kind: '*' }],
      exclude: [],
      auto_layout: false,
    };
  });
}

function buildVersions(input: BuildSnapshotInput): CanonicalVersion[] {
  const seen = new Set(input.existingVersionHashes ?? []);
  const versions: CanonicalVersion[] = [];

  for (const version of input.versions ?? []) {
    const hash = computeContentHash(version.snapshot);
    let contentHash = version.content_hash ?? null;
    let duplicate = false;

    if (!contentHash) {
      if (seen.has(hash)) {
        duplicate = true;
      } else {
        contentHash = hash;
        seen.add(hash);
      }
    }

    versions.push({
      id: version.id,
      version: version.version,
      content_hash: contentHash,
      author_id: version.created_by ?? null,
      duplicate,
    });
  }

  return versions;
}

export function buildCanonicalSnapshot(input: BuildSnapshotInput): CanonicalSnapshot {
  const { model } = input;
  const warnings: BackfillWarning[] = [];

  const elements = input.elements.map((element) => toCanonicalElement(element));
  const byId = new Map(elements.map((element) => [element.id, element]));

  const relationships: CanonicalRelationship[] = [];
  let skippedRelationships = 0;
  for (const edge of input.edges) {
    if (edge.from_id === edge.to_id) {
      skippedRelationships += 1;
      warnings.push({
        code: 'RELATIONSHIP_SELF',
        entityId: edge.id,
        message: 'Relação aponta para o próprio elemento e foi ignorada (restrição canônica).',
      });
      continue;
    }
    if (!byId.has(edge.from_id) || !byId.has(edge.to_id)) {
      skippedRelationships += 1;
      warnings.push({
        code: 'RELATIONSHIP_DANGLING',
        entityId: edge.id,
        message: 'Relação referencia elemento inexistente e foi ignorada.',
      });
      continue;
    }
    relationships.push(toCanonicalRelationship(edge));
  }

  const views = buildViews(model, elements, input.parentModel, warnings);
  const primaryViewKey = views[0]?.key ?? (model.c4_type || 'container');

  // Layout a partir do XML (ou apenas do estado, no projetor).
  const layout: CanonicalLayoutRow[] = [];
  const byName = nameIndex(elements);
  const positionedInPrimary = new Set<string>();
  const diagrams =
    input.layoutFromXml === false
      ? []
      : [
          { c4Type: primaryViewKey, xml: model.drawio_xml ?? null },
          ...parseDiagrams(model.diagrams)
            .filter((diagram) => diagram.c4Type !== primaryViewKey)
            .map((diagram) => ({ c4Type: diagram.c4Type, xml: diagram.drawioXml ?? null })),
        ];

  for (const diagram of diagrams) {
    for (const shape of extractDiagramLayout(diagram.xml)) {
      let elementId: string | null =
        shape.elementRef && byId.has(shape.elementRef) ? shape.elementRef : null;

      if (!elementId && shape.name) {
        const matches = byName.get(normalizeName(shape.name)) ?? [];
        if (matches.length === 1) elementId = matches[0];
      }

      if (elementId && diagram.c4Type === primaryViewKey) {
        positionedInPrimary.add(elementId);
      }

      layout.push({
        viewKey: diagram.c4Type,
        element_id: elementId,
        object_key: elementId ? null : shape.objectKey,
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
        style: shape.style,
      });
    }
  }

  // Posições explícitas do editor relacional na view primária.
  for (const element of input.elements) {
    if (positionedInPrimary.has(element.id)) continue;
    if (element.position_x === null || element.position_x === undefined) continue;
    if (element.position_y === null || element.position_y === undefined) continue;
    layout.push({
      viewKey: primaryViewKey,
      element_id: element.id,
      object_key: null,
      x: element.position_x,
      y: element.position_y,
      width: null,
      height: null,
      style: { source: 'legacy' },
    });
  }

  inferParents(layout, elements, primaryViewKey);

  let overrides: CanonicalDasOverride[] = [];
  if (model.das_content) {
    if (input.dasGenerated) {
      overrides = diffDasSections(input.dasGenerated, model.das_content).overrides;
    } else {
      overrides = [{ section_key: 'document', content: model.das_content, mode: 'replace' }];
    }
  }

  const versions = buildVersions(input);

  const contentHash = computeContentHash({
    model: {
      id: model.id,
      title: model.title,
      description: model.description ?? null,
      c4_type: model.c4_type ?? null,
      c4_scope: model.c4_scope ?? null,
    },
    elements,
    relationships,
    views,
    layout,
  });

  const dasSourceHash = computeDasSourceHash(contentHash, overrides);

  return {
    modelId: model.id,
    elements,
    relationships,
    views,
    layout,
    overrides,
    versions,
    contentHash,
    dasSourceHash,
    warnings,
    stats: {
      elements: elements.length,
      relationships: relationships.length,
      views: views.length,
      layout: layout.length,
      overrides: overrides.length,
      versions: versions.length,
      duplicateVersions: versions.filter((version) => version.duplicate).length,
      skippedRelationships,
    },
  };
}

export async function loadLegacyBundle(
  client: PoolClient,
  modelId: string,
  options: BackfillOptions = {}
): Promise<BuildSnapshotInput> {
  const modelResult = await client.query('SELECT * FROM models WHERE id = $1', [modelId]);
  const model = modelResult.rows[0] as LegacyModelRow | undefined;
  if (!model) throw new Error(`Modelo ${modelId} não encontrado`);

  const parentModel = model.parent_id
    ? ((await client.query('SELECT * FROM models WHERE id = $1', [model.parent_id]))
        .rows[0] as LegacyModelRow | undefined) ?? null
    : null;

  // Consultas sequenciais no mesmo client: o pg não suporta concorrência em um
  // único client e a transação do backfill precisa de uma visão consistente.
  const elements = await client.query(
    'SELECT * FROM elements WHERE model_id = $1 ORDER BY "order", title',
    [modelId]
  );
  const edges = await client.query('SELECT * FROM edges WHERE model_id = $1 ORDER BY created_at', [
    modelId,
  ]);
  const versions = await client.query(
    `SELECT id, version, snapshot, created_by, content_hash
       FROM model_versions
      WHERE model_id = $1
      ORDER BY version, created_at`,
    [modelId]
  );
  const folder = model.folder_id
    ? await client.query('SELECT name FROM folders WHERE id = $1', [model.folder_id])
    : { rows: [] as Array<{ name?: string }> };

  const legacyElements = elements.rows as LegacyElementRow[];
  const legacyEdges = edges.rows as LegacyEdgeRow[];
  const legacyVersions = versions.rows as LegacyVersionInput[];

  let dasGenerated: string | null = null;
  if (options.includeDas !== false) {
    const assets = await loadDasAssets(model.org_id);
    dasGenerated = generateDAS(
      {
        id: model.id,
        title: model.title,
        description: model.description,
        status: model.status ?? undefined,
        c4_type: model.c4_type ?? undefined,
        c4_scope: model.c4_scope,
        folder_id: model.folder_id,
        org_id: model.org_id,
      },
      legacyElements,
      legacyEdges,
      folder.rows[0]?.name ?? null,
      model.drawio_xml ?? null,
      parseDiagrams(model.diagrams),
      assets
    );
  }

  return {
    model,
    parentModel,
    elements: legacyElements,
    edges: legacyEdges,
    versions: legacyVersions,
    existingVersionHashes: legacyVersions
      .map((version) => version.content_hash)
      .filter((hash): hash is string => Boolean(hash)),
    dasGenerated,
  };
}

export async function applyCanonicalSnapshot(
  client: PoolClient,
  snapshot: CanonicalSnapshot,
  options: { prune?: boolean } = {}
): Promise<void> {
  const prune = options.prune !== false;
  const elementIds = snapshot.elements.map((element) => element.id);
  const relationshipIds = snapshot.relationships.map((relationship) => relationship.id);
  const viewKeys = snapshot.views.map((view) => view.key);

  if (prune) {
    await client.query(
      'DELETE FROM model_relationships WHERE model_id = $1 AND id <> ALL($2::uuid[])',
      [snapshot.modelId, relationshipIds]
    );
    await client.query(
      'DELETE FROM model_elements WHERE model_id = $1 AND id <> ALL($2::uuid[])',
      [snapshot.modelId, elementIds]
    );
    await client.query(
      'DELETE FROM model_views WHERE model_id = $1 AND key <> ALL($2::text[])',
      [snapshot.modelId, viewKeys]
    );
  }

  // Elementos primeiro sem pai; o vínculo é aplicado depois para respeitar a FK
  // independentemente da ordem de inserção.
  for (const element of snapshot.elements) {
    await client.query(
      `INSERT INTO model_elements
         (id, model_id, parent_element_id, identifier, kind, name, description,
          technology, url, tags, properties, app_id, service_id)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         parent_element_id = NULL,
         identifier = EXCLUDED.identifier,
         kind = EXCLUDED.kind,
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         technology = EXCLUDED.technology,
         url = EXCLUDED.url,
         tags = EXCLUDED.tags,
         properties = EXCLUDED.properties,
         app_id = EXCLUDED.app_id,
         service_id = EXCLUDED.service_id,
         updated_at = NOW()`,
      [
        element.id,
        element.model_id,
        element.identifier,
        element.kind,
        element.name,
        element.description,
        element.technology,
        element.url,
        element.tags,
        JSON.stringify(element.properties),
        element.app_id,
        element.service_id,
      ]
    );
  }

  for (const element of snapshot.elements) {
    if (!element.parent_element_id) continue;
    if (!elementIds.includes(element.parent_element_id)) continue;
    await client.query(
      'UPDATE model_elements SET parent_element_id = $1 WHERE id = $2 AND model_id = $3',
      [element.parent_element_id, element.id, snapshot.modelId]
    );
  }

  for (const relationship of snapshot.relationships) {
    await client.query(
      `INSERT INTO model_relationships
         (id, model_id, source_id, target_id, description, technology, tags, properties)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         source_id = EXCLUDED.source_id,
         target_id = EXCLUDED.target_id,
         description = EXCLUDED.description,
         technology = EXCLUDED.technology,
         tags = EXCLUDED.tags,
         properties = EXCLUDED.properties,
         updated_at = NOW()`,
      [
        relationship.id,
        relationship.model_id,
        relationship.source_id,
        relationship.target_id,
        relationship.description,
        relationship.technology,
        relationship.tags,
        JSON.stringify(relationship.properties),
      ]
    );
  }

  const viewIds = new Map<string, string>();
  for (const view of snapshot.views) {
    const result = await client.query<{ id: string; key: string }>(
      `INSERT INTO model_views
         (model_id, key, type, scope_element_id, title, description, include, exclude, auto_layout)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
       ON CONFLICT (model_id, key) DO UPDATE SET
         type = EXCLUDED.type,
         scope_element_id = EXCLUDED.scope_element_id,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         include = EXCLUDED.include,
         exclude = EXCLUDED.exclude,
         auto_layout = EXCLUDED.auto_layout,
         updated_at = NOW()
       RETURNING id, key`,
      [
        view.model_id,
        view.key,
        view.type,
        view.scope_element_id,
        view.title,
        view.description,
        JSON.stringify(view.include),
        JSON.stringify(view.exclude),
        view.auto_layout,
      ]
    );
    viewIds.set(result.rows[0].key, result.rows[0].id);
  }

  await client.query(
    `DELETE FROM model_view_layout
      USING model_views
      WHERE model_view_layout.view_id = model_views.id
        AND model_views.model_id = $1
        AND model_views.key = ANY($2::text[])`,
    [snapshot.modelId, viewKeys]
  );

  for (const row of snapshot.layout) {
    const viewId = viewIds.get(row.viewKey);
    if (!viewId) continue;
    if (!row.element_id && !row.object_key) continue;
    if (row.element_id && !elementIds.includes(row.element_id)) continue;

    await client.query(
      `INSERT INTO model_view_layout
         (view_id, element_id, object_key, x, y, width, height, style)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        viewId,
        row.element_id,
        row.element_id ? null : row.object_key,
        row.x,
        row.y,
        row.width,
        row.height,
        JSON.stringify(row.style),
      ]
    );
  }

  for (const override of snapshot.overrides) {
    await client.query(
      `INSERT INTO model_das_overrides (model_id, section_key, content, mode)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (model_id, section_key) DO NOTHING`,
      [snapshot.modelId, override.section_key, override.content, override.mode]
    );
  }

  for (const version of snapshot.versions) {
    await client.query(
      `UPDATE model_versions
          SET content_hash = COALESCE(content_hash, $3),
              author_id = COALESCE(author_id, $4),
              kind = COALESCE(kind, 'auto')
        WHERE id = $1 AND model_id = $2`,
      [version.id, snapshot.modelId, version.content_hash, version.author_id]
    );
  }

  const actualOverrides = await client.query<{
    section_key: string;
    content: string | null;
    mode: CanonicalDasOverride['mode'];
  }>(
    `SELECT section_key, content, mode
       FROM model_das_overrides
      WHERE model_id = $1
      ORDER BY section_key`,
    [snapshot.modelId]
  );

  await client.query(
    'UPDATE models SET das_override_count = $1, das_source_hash = $2 WHERE id = $3',
    [
      actualOverrides.rows.length,
      computeDasSourceHash(snapshot.contentHash, actualOverrides.rows),
      snapshot.modelId,
    ]
  );
}

export async function backfillModel(
  modelId: string,
  options: BackfillOptions = {}
): Promise<BackfillResult> {
  const client = await pool.connect();
  try {
    const bundle = await loadLegacyBundle(client, modelId, options);
    const snapshot = buildCanonicalSnapshot(bundle);

    if (!options.dryRun) {
      await client.query('BEGIN');
      try {
        await applyCanonicalSnapshot(client, snapshot, { prune: options.prune });
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    return {
      modelId,
      title: bundle.model.title,
      dryRun: Boolean(options.dryRun),
      applied: !options.dryRun,
      stats: snapshot.stats,
      warnings: snapshot.warnings,
    };
  } finally {
    client.release();
  }
}

export async function backfillAll(options: BackfillOptions = {}): Promise<BackfillAllResult> {
  const models = await pool.query<{ id: string }>('SELECT id FROM models ORDER BY created_at');
  const results: BackfillResult[] = [];
  const errors: Array<{ modelId: string; error: string }> = [];

  for (const row of models.rows) {
    try {
      results.push(await backfillModel(row.id, options));
    } catch (err) {
      errors.push({
        modelId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    total: models.rows.length,
    applied: results.filter((result) => result.applied).length,
    failed: errors.length,
    results,
    errors,
  };
}
