import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import {
  computeContentHash,
  computeDasSourceHash,
  normalizeText,
  stableStringify,
  type CanonicalDasOverride,
  type CanonicalElement,
  type CanonicalLayoutRow,
  type CanonicalRelationship,
  type CanonicalSnapshot,
  type CanonicalVersion,
  type CanonicalView,
} from './canonical.js';
import { buildCanonicalSnapshot, loadLegacyBundle } from './backfill.js';
import {
  recordProjectionError,
  recordShadowComparison,
} from '../observability/metrics.js';

/**
 * Leitura em sombra (M2).
 *
 * O caminho legado continua servindo a resposta. Em paralelo, reconstruímos o
 * snapshot canônico esperado a partir do legado e comparamos com o que está
 * gravado nas tabelas canônicas. Divergências viram relatório e métricas.
 */

export type DivergenceKind =
  | 'ELEMENT_MISSING'
  | 'ELEMENT_EXTRA'
  | 'ELEMENT_FIELD'
  | 'RELATIONSHIP_MISSING'
  | 'RELATIONSHIP_EXTRA'
  | 'RELATIONSHIP_FIELD'
  | 'VIEW_MISSING'
  | 'VIEW_EXTRA'
  | 'VIEW_FIELD'
  | 'LAYOUT_MISSING'
  | 'LAYOUT_EXTRA'
  | 'LAYOUT_FIELD'
  | 'OVERRIDE_MISSING'
  | 'OVERRIDE_EXTRA'
  | 'OVERRIDE_FIELD'
  | 'VERSION_MISSING'
  | 'VERSION_EXTRA'
  | 'VERSION_FIELD';

export interface Divergence {
  kind: DivergenceKind;
  entityId?: string;
  viewKey?: string;
  field?: string;
  expected?: unknown;
  actual?: unknown;
}

export interface ShadowReport {
  modelId: string;
  checkedAt: string;
  ok: boolean;
  expected: CanonicalSnapshot['stats'];
  actual: CanonicalSnapshot['stats'];
  divergences: Divergence[];
}

export interface ShadowAllResult {
  total: number;
  ok: number;
  divergent: number;
  failed: number;
  reports: ShadowReport[];
  errors: Array<{ modelId: string; error: string }>;
}

const ELEMENT_FIELDS = [
  'parent_element_id',
  'identifier',
  'kind',
  'name',
  'description',
  'technology',
  'url',
  'tags',
  'properties',
  'app_id',
  'service_id',
] as const;

const RELATIONSHIP_FIELDS = [
  'source_id',
  'target_id',
  'description',
  'technology',
  'tags',
  'properties',
] as const;

const VIEW_FIELDS = [
  'type',
  'scope_element_id',
  'title',
  'description',
  'include',
  'exclude',
  'auto_layout',
] as const;

function normalizeComparable(field: string, value: unknown): unknown {
  if (field === 'tags' && Array.isArray(value)) {
    return [...value].map(String).sort();
  }
  if (
    field === 'description' ||
    field === 'technology' ||
    field === 'url' ||
    field === 'title' ||
    field === 'name'
  ) {
    return normalizeText(typeof value === 'string' ? value : null);
  }
  return value ?? null;
}

function sameValue(field: string, expected: unknown, actual: unknown): boolean {
  return (
    stableStringify(normalizeComparable(field, expected)) ===
    stableStringify(normalizeComparable(field, actual))
  );
}

function sameNumber(expected: number | null, actual: number | null): boolean {
  if (expected === null || actual === null) return expected === actual;
  return Math.abs(expected - actual) < 1e-6;
}

function layoutKey(row: CanonicalLayoutRow): string {
  return row.element_id
    ? `${row.viewKey}|element:${row.element_id}`
    : `${row.viewKey}|object:${row.object_key ?? ''}`;
}

function compareElements(expected: CanonicalElement[], actual: CanonicalElement[]): Divergence[] {
  const divergences: Divergence[] = [];
  const expectedById = new Map(expected.map((element) => [element.id, element]));
  const actualById = new Map(actual.map((element) => [element.id, element]));

  for (const element of expected) {
    if (!actualById.has(element.id)) {
      divergences.push({ kind: 'ELEMENT_MISSING', entityId: element.id });
    }
  }
  for (const element of actual) {
    if (!expectedById.has(element.id)) {
      divergences.push({ kind: 'ELEMENT_EXTRA', entityId: element.id });
    }
  }

  for (const element of expected) {
    const other = actualById.get(element.id);
    if (!other) continue;
    for (const field of ELEMENT_FIELDS) {
      if (!sameValue(field, element[field], other[field])) {
        divergences.push({
          kind: 'ELEMENT_FIELD',
          entityId: element.id,
          field,
          expected: element[field],
          actual: other[field],
        });
      }
    }
  }

  return divergences;
}

function compareRelationships(
  expected: CanonicalRelationship[],
  actual: CanonicalRelationship[]
): Divergence[] {
  const divergences: Divergence[] = [];
  const expectedById = new Map(expected.map((relationship) => [relationship.id, relationship]));
  const actualById = new Map(actual.map((relationship) => [relationship.id, relationship]));

  for (const relationship of expected) {
    if (!actualById.has(relationship.id)) {
      divergences.push({ kind: 'RELATIONSHIP_MISSING', entityId: relationship.id });
    }
  }
  for (const relationship of actual) {
    if (!expectedById.has(relationship.id)) {
      divergences.push({ kind: 'RELATIONSHIP_EXTRA', entityId: relationship.id });
    }
  }

  for (const relationship of expected) {
    const other = actualById.get(relationship.id);
    if (!other) continue;
    for (const field of RELATIONSHIP_FIELDS) {
      if (!sameValue(field, relationship[field], other[field])) {
        divergences.push({
          kind: 'RELATIONSHIP_FIELD',
          entityId: relationship.id,
          field,
          expected: relationship[field],
          actual: other[field],
        });
      }
    }
  }

  return divergences;
}

function compareViews(expected: CanonicalView[], actual: CanonicalView[]): Divergence[] {
  const divergences: Divergence[] = [];
  const expectedByKey = new Map(expected.map((view) => [view.key, view]));
  const actualByKey = new Map(actual.map((view) => [view.key, view]));

  for (const view of expected) {
    if (!actualByKey.has(view.key)) {
      divergences.push({ kind: 'VIEW_MISSING', viewKey: view.key });
    }
  }
  for (const view of actual) {
    if (!expectedByKey.has(view.key)) {
      divergences.push({ kind: 'VIEW_EXTRA', viewKey: view.key });
    }
  }

  for (const view of expected) {
    const other = actualByKey.get(view.key);
    if (!other) continue;
    for (const field of VIEW_FIELDS) {
      if (!sameValue(field, view[field], other[field])) {
        divergences.push({
          kind: 'VIEW_FIELD',
          viewKey: view.key,
          field,
          expected: view[field],
          actual: other[field],
        });
      }
    }
  }

  return divergences;
}

function compareLayout(
  expected: CanonicalLayoutRow[],
  actual: CanonicalLayoutRow[]
): Divergence[] {
  const divergences: Divergence[] = [];
  const expectedByKey = new Map(expected.map((row) => [layoutKey(row), row]));
  const actualByKey = new Map(actual.map((row) => [layoutKey(row), row]));

  for (const row of expected) {
    const key = layoutKey(row);
    if (!actualByKey.has(key)) {
      divergences.push({
        kind: 'LAYOUT_MISSING',
        viewKey: row.viewKey,
        entityId: row.element_id ?? row.object_key ?? undefined,
      });
    }
  }
  for (const row of actual) {
    const key = layoutKey(row);
    if (!expectedByKey.has(key)) {
      divergences.push({
        kind: 'LAYOUT_EXTRA',
        viewKey: row.viewKey,
        entityId: row.element_id ?? row.object_key ?? undefined,
      });
    }
  }

  for (const row of expected) {
    const other = actualByKey.get(layoutKey(row));
    if (!other) continue;
    const numericFields: Array<keyof Pick<CanonicalLayoutRow, 'x' | 'y' | 'width' | 'height'>> = [
      'x',
      'y',
      'width',
      'height',
    ];
    for (const field of numericFields) {
      if (!sameNumber(row[field], other[field])) {
        divergences.push({
          kind: 'LAYOUT_FIELD',
          viewKey: row.viewKey,
          entityId: row.element_id ?? row.object_key ?? undefined,
          field,
          expected: row[field],
          actual: other[field],
        });
      }
    }
    if (!sameValue('style', row.style, other.style)) {
      divergences.push({
        kind: 'LAYOUT_FIELD',
        viewKey: row.viewKey,
        entityId: row.element_id ?? row.object_key ?? undefined,
        field: 'style',
        expected: row.style,
        actual: other.style,
      });
    }
  }

  return divergences;
}

function compareOverrides(
  expected: CanonicalDasOverride[],
  actual: CanonicalDasOverride[]
): Divergence[] {
  const divergences: Divergence[] = [];
  const expectedByKey = new Map(expected.map((override) => [override.section_key, override]));
  const actualByKey = new Map(actual.map((override) => [override.section_key, override]));

  for (const override of expected) {
    if (!actualByKey.has(override.section_key)) {
      divergences.push({ kind: 'OVERRIDE_MISSING', entityId: override.section_key });
    }
  }
  for (const override of actual) {
    if (!expectedByKey.has(override.section_key)) {
      divergences.push({ kind: 'OVERRIDE_EXTRA', entityId: override.section_key });
    }
  }

  for (const override of expected) {
    const other = actualByKey.get(override.section_key);
    if (!other) continue;
    if (!sameValue('content', override.content, other.content)) {
      divergences.push({
        kind: 'OVERRIDE_FIELD',
        entityId: override.section_key,
        field: 'content',
        expected: override.content,
        actual: other.content,
      });
    }
    if (override.mode !== other.mode) {
      divergences.push({
        kind: 'OVERRIDE_FIELD',
        entityId: override.section_key,
        field: 'mode',
        expected: override.mode,
        actual: other.mode,
      });
    }
  }

  return divergences;
}

function compareVersions(
  expected: CanonicalVersion[],
  actual: CanonicalVersion[]
): Divergence[] {
  const divergences: Divergence[] = [];
  const expectedById = new Map(expected.map((version) => [version.id, version]));
  const actualById = new Map(actual.map((version) => [version.id, version]));

  for (const version of expected) {
    if (!actualById.has(version.id)) {
      divergences.push({ kind: 'VERSION_MISSING', entityId: version.id });
    }
  }
  for (const version of actual) {
    if (!expectedById.has(version.id)) {
      divergences.push({ kind: 'VERSION_EXTRA', entityId: version.id });
    }
  }

  for (const version of expected) {
    const other = actualById.get(version.id);
    if (!other) continue;
    if (version.content_hash !== other.content_hash) {
      divergences.push({
        kind: 'VERSION_FIELD',
        entityId: version.id,
        field: 'content_hash',
        expected: version.content_hash,
        actual: other.content_hash,
      });
    }
    if (version.author_id && version.author_id !== other.author_id) {
      divergences.push({
        kind: 'VERSION_FIELD',
        entityId: version.id,
        field: 'author_id',
        expected: version.author_id,
        actual: other.author_id,
      });
    }
  }

  return divergences;
}

export function compareSnapshots(
  expected: CanonicalSnapshot,
  actual: CanonicalSnapshot
): Divergence[] {
  const divergences = [
    ...compareElements(expected.elements, actual.elements),
    ...compareRelationships(expected.relationships, actual.relationships),
    ...compareViews(expected.views, actual.views),
    ...compareLayout(expected.layout, actual.layout),
    ...compareOverrides(expected.overrides, actual.overrides),
    ...compareVersions(expected.versions, actual.versions),
  ];

  return divergences.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      (a.entityId ?? '').localeCompare(b.entityId ?? '') ||
      (a.viewKey ?? '').localeCompare(b.viewKey ?? '') ||
      (a.field ?? '').localeCompare(b.field ?? '')
  );
}

export async function loadCanonicalSnapshot(
  client: PoolClient,
  modelId: string
): Promise<CanonicalSnapshot> {
  // Consultas sequenciais no mesmo client: o pg não suporta concorrência em um
  // único client e a comparação precisa de uma visão consistente.
  const model = await client.query(
    'SELECT id, title, description, c4_type, c4_scope FROM models WHERE id = $1',
    [modelId]
  );
  const elements = await client.query(
    'SELECT * FROM model_elements WHERE model_id = $1 ORDER BY identifier',
    [modelId]
  );
  const relationships = await client.query(
    'SELECT * FROM model_relationships WHERE model_id = $1 ORDER BY id',
    [modelId]
  );
  const views = await client.query('SELECT * FROM model_views WHERE model_id = $1 ORDER BY key', [
    modelId,
  ]);
  const layout = await client.query(
    `SELECT v.key AS view_key, l.element_id, l.object_key, l.x, l.y, l.width, l.height, l.style
       FROM model_view_layout l
       JOIN model_views v ON v.id = l.view_id
      WHERE v.model_id = $1
      ORDER BY v.key, l.element_id NULLS LAST, l.object_key`,
    [modelId]
  );
  const overrides = await client.query(
    `SELECT section_key, content, mode
       FROM model_das_overrides
      WHERE model_id = $1
      ORDER BY section_key`,
    [modelId]
  );
  const versions = await client.query(
    `SELECT id, version, content_hash, author_id, created_by
       FROM model_versions
      WHERE model_id = $1
      ORDER BY version`,
    [modelId]
  );

  const modelRow = model.rows[0] as
    | { id: string; title: string; description: string | null; c4_type: string | null; c4_scope: string | null }
    | undefined;
  if (!modelRow) throw new Error(`Modelo ${modelId} não encontrado`);

  const canonicalElements = elements.rows as CanonicalElement[];
  const canonicalRelationships = relationships.rows as CanonicalRelationship[];
  const canonicalViews = views.rows as CanonicalView[];
  const canonicalLayout: CanonicalLayoutRow[] = (
    layout.rows as Array<{
      view_key: string;
      element_id: string | null;
      object_key: string | null;
      x: number | null;
      y: number | null;
      width: number | null;
      height: number | null;
      style: Record<string, unknown>;
    }>
  ).map((row) => ({
    viewKey: row.view_key,
    element_id: row.element_id,
    object_key: row.object_key,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    style: row.style ?? {},
  }));

  const canonicalOverrides = overrides.rows as CanonicalDasOverride[];
  const canonicalVersions: CanonicalVersion[] = (
    versions.rows as Array<{
      id: string;
      version: number;
      content_hash: string | null;
      author_id: string | null;
      created_by: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    version: row.version,
    content_hash: row.content_hash,
    author_id: row.author_id ?? row.created_by,
    duplicate: row.content_hash === null,
  }));

  const contentHash = computeContentHash({
    model: {
      id: modelRow.id,
      title: modelRow.title,
      description: modelRow.description,
      c4_type: modelRow.c4_type,
      c4_scope: modelRow.c4_scope,
    },
    elements: canonicalElements,
    relationships: canonicalRelationships,
    views: canonicalViews,
    layout: canonicalLayout,
  });

  return {
    modelId,
    elements: canonicalElements,
    relationships: canonicalRelationships,
    views: canonicalViews,
    layout: canonicalLayout,
    overrides: canonicalOverrides,
    versions: canonicalVersions,
    contentHash,
    dasSourceHash: computeDasSourceHash(contentHash, canonicalOverrides),
    warnings: [],
    stats: {
      elements: canonicalElements.length,
      relationships: canonicalRelationships.length,
      views: canonicalViews.length,
      layout: canonicalLayout.length,
      overrides: canonicalOverrides.length,
      versions: canonicalVersions.length,
      duplicateVersions: canonicalVersions.filter((version) => version.duplicate).length,
      skippedRelationships: 0,
    },
  };
}

export async function shadowModel(modelId: string): Promise<ShadowReport> {
  const client = await pool.connect();
  try {
    const bundle = await loadLegacyBundle(client, modelId);
    const expected = buildCanonicalSnapshot(bundle);
    const actual = await loadCanonicalSnapshot(client, modelId);
    const divergences = compareSnapshots(expected, actual);

    const report: ShadowReport = {
      modelId,
      checkedAt: new Date().toISOString(),
      ok: divergences.length === 0,
      expected: expected.stats,
      actual: actual.stats,
      divergences,
    };

    recordShadowComparison(!report.ok, divergences.map((divergence) => divergence.kind));
    return report;
  } catch (err) {
    recordProjectionError();
    throw err;
  } finally {
    client.release();
  }
}

export function formatShadowSummary(report: ShadowReport): string {
  if (report.ok) {
    return (
      `[shadow] modelo ${report.modelId}: ok ` +
      `(elementos=${report.expected.elements}, relações=${report.expected.relationships}, ` +
      `views=${report.expected.views}, layout=${report.expected.layout})`
    );
  }

  const byKind = new Map<string, number>();
  for (const divergence of report.divergences) {
    byKind.set(divergence.kind, (byKind.get(divergence.kind) ?? 0) + 1);
  }
  const summary = [...byKind.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind}=${count}`)
    .join(', ');

  return `[shadow] modelo ${report.modelId}: ${report.divergences.length} divergência(s) (${summary})`;
}

/**
 * Executa a comparação sem nunca alterar a resposta nem derrubar a requisição.
 * Chamado depois de enviar a resposta legada quando `CANONICAL_MODEL=shadow`.
 */
export async function runShadowCheck(modelId: string): Promise<void> {
  try {
    const report = await shadowModel(modelId);
    if (report.ok) {
      console.log(formatShadowSummary(report));
    } else {
      console.warn(formatShadowSummary(report));
    }
  } catch (err) {
    console.error(`[shadow] falha ao comparar modelo ${modelId}`, err);
  }
}

export async function shadowAllModels(): Promise<ShadowAllResult> {
  const models = await pool.query<{ id: string }>('SELECT id FROM models ORDER BY created_at');
  const reports: ShadowReport[] = [];
  const errors: Array<{ modelId: string; error: string }> = [];

  for (const row of models.rows) {
    try {
      reports.push(await shadowModel(row.id));
    } catch (err) {
      errors.push({
        modelId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    total: models.rows.length,
    ok: reports.filter((report) => report.ok).length,
    divergent: reports.filter((report) => !report.ok).length,
    failed: errors.length,
    reports,
    errors,
  };
}
