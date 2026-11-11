import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import {
  applyCanonicalSnapshot,
  buildCanonicalSnapshot,
  type BuildSnapshotInput,
} from './backfill.js';
import type { CanonicalSnapshot, LegacyModelRow } from './canonical.js';
import { computeStateContentHash, decodeModelState, type DecodedState } from './state.js';
import {
  compareSnapshots,
  formatShadowSummary,
  loadCanonicalSnapshot,
  type Divergence,
} from './shadow.js';
import {
  recordProjectionDivergence,
  recordProjectionError,
  recordProjectionRun,
} from '../observability/metrics.js';

/**
 * Projetor idempotente do M3.
 *
 * Lê o estado colaborativo durável (`model_state`), converte para o snapshot
 * canônico esperado e:
 *
 * - em `shadow`, compara com as tabelas canônicas atuais sem escrever;
 * - em `on`, aplica o snapshot (o projetor passa a ser o escritor).
 *
 * O legado (`elements`/`edges`) não é tocado: a virada de leitura continua no
 * M5. O layout vem do Yjs, não do XML draw.io.
 */

export type ProjectorMode = 'shadow' | 'on';

export interface ProjectionOptions {
  mode?: ProjectorMode;
  /** Reprojetar mesmo que o hash do estado não tenha mudado. */
  force?: boolean;
}

export interface ProjectionReport {
  modelId: string;
  mode: ProjectorMode;
  skipped: boolean;
  reason?: string;
  applied: boolean;
  ok: boolean;
  contentHash: string | null;
  expected: CanonicalSnapshot['stats'];
  actual: CanonicalSnapshot['stats'];
  divergences: Divergence[];
  warnings: string[];
}

export interface ProjectAllResult {
  total: number;
  applied: number;
  divergent: number;
  skipped: number;
  failed: number;
  reports: ProjectionReport[];
  errors: Array<{ modelId: string; error: string }>;
}

interface StateRow {
  state: Buffer;
  revision: string | number;
  content_hash: string;
}

/**
 * O projetor cuida de elementos, relações, views e layout. Overrides e versões
 * têm fluxos próprios (DAS e worker) e não devem gerar divergência aqui.
 */
function compareProjected(
  expected: CanonicalSnapshot,
  actual: CanonicalSnapshot
): Divergence[] {
  return compareSnapshots(expected, actual).filter(
    (divergence) =>
      !divergence.kind.startsWith('OVERRIDE') && !divergence.kind.startsWith('VERSION')
  );
}

function emptyStats(): CanonicalSnapshot['stats'] {
  return {
    elements: 0,
    relationships: 0,
    views: 0,
    layout: 0,
    overrides: 0,
    versions: 0,
    duplicateVersions: 0,
    skippedRelationships: 0,
  };
}

function snapshotFromDecoded(
  model: LegacyModelRow,
  decoded: DecodedState
): CanonicalSnapshot {
  const input: BuildSnapshotInput = {
    model: {
      ...model,
      // O XML é um artefato de desenho; no projetor o modelo e o layout vêm do
      // estado colaborativo.
      drawio_xml: null,
      das_content: null,
    },
    elements: decoded.elements.map((element) => ({
      ...element,
      model_id: model.id,
    })),
    edges: decoded.edges.map((edge) => ({
      ...edge,
      model_id: model.id,
    })),
    versions: [],
    layoutFromXml: false,
  };

  return buildCanonicalSnapshot(input);
}

/**
 * Preserva a hierarquia já existente quando o estado não trouxe um pai. O Yjs
 * atual não carrega geometria de contenção nem `parentId`, então apagar todos
 * os vínculos a cada projeção seria destrutivo.
 */
async function preserveParents(
  client: PoolClient,
  modelId: string,
  snapshot: CanonicalSnapshot
): Promise<void> {
  const result = await client.query<{ id: string; parent_element_id: string | null }>(
    'SELECT id, parent_element_id FROM model_elements WHERE model_id = $1',
    [modelId]
  );
  const existing = new Map(result.rows.map((row) => [row.id, row.parent_element_id]));
  const ids = new Set(snapshot.elements.map((element) => element.id));

  for (const element of snapshot.elements) {
    if (element.parent_element_id) continue;
    const parent = existing.get(element.id);
    if (parent && ids.has(parent) && parent !== element.id) {
      element.parent_element_id = parent;
    }
  }
}

async function readState(
  client: PoolClient,
  modelId: string
): Promise<{ row: StateRow; model: LegacyModelRow } | null> {
  const stateResult = await client.query<StateRow>(
    'SELECT state, revision, content_hash FROM model_state WHERE model_id = $1',
    [modelId]
  );
  const row = stateResult.rows[0];
  if (!row) return null;

  const modelResult = await client.query<LegacyModelRow>('SELECT * FROM models WHERE id = $1', [
    modelId,
  ]);
  const model = modelResult.rows[0];
  if (!model) return null;
  return { row, model };
}

export async function projectModel(
  modelId: string,
  options: ProjectionOptions = {}
): Promise<ProjectionReport> {
  const mode = options.mode ?? 'shadow';
  const client = await pool.connect();

  try {
    const loaded = await readState(client, modelId);
    if (!loaded) {
      recordProjectionRun(mode, 'skipped');
      return {
        modelId,
        mode,
        skipped: true,
        reason: 'sem model_state',
        applied: false,
        ok: true,
        contentHash: null,
        expected: emptyStats(),
        actual: emptyStats(),
        divergences: [],
        warnings: [],
      };
    }

    const stateBytes = new Uint8Array(loaded.row.state);
    const decoded = decodeModelState(stateBytes);
    const contentHash = computeStateContentHash(decoded);
    const expected = snapshotFromDecoded(loaded.model, decoded);
    await preserveParents(client, modelId, expected);

    if (mode === 'shadow') {
      const actual = await loadCanonicalSnapshot(client, modelId);
      const divergences = compareProjected(expected, actual);
      for (const divergence of divergences) recordProjectionDivergence(divergence.kind);
      const report: ProjectionReport = {
        modelId,
        mode,
        skipped: false,
        applied: false,
        ok: divergences.length === 0,
        contentHash,
        expected: expected.stats,
        actual: actual.stats,
        divergences,
        warnings: expected.warnings.map((warning) => warning.message),
      };
      recordProjectionRun(mode, report.ok ? 'ok' : 'divergent');
      return report;
    }

    await client.query('BEGIN');
    try {
      await applyCanonicalSnapshot(client, expected, { prune: true });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    const actual = await loadCanonicalSnapshot(client, modelId);
    const divergences = compareProjected(expected, actual);
    for (const divergence of divergences) recordProjectionDivergence(divergence.kind);
    const report: ProjectionReport = {
      modelId,
      mode,
      skipped: false,
      applied: true,
      ok: divergences.length === 0,
      contentHash,
      expected: expected.stats,
      actual: actual.stats,
      divergences,
      warnings: expected.warnings.map((warning) => warning.message),
    };
    recordProjectionRun(mode, report.ok ? 'ok' : 'divergent');
    return report;
  } catch (err) {
    recordProjectionError();
    throw err;
  } finally {
    client.release();
  }
}

export async function projectAllModels(
  options: ProjectionOptions = {}
): Promise<ProjectAllResult> {
  const rows = await pool.query<{ model_id: string }>(
    'SELECT model_id FROM model_state ORDER BY updated_at DESC'
  );
  const reports: ProjectionReport[] = [];
  const errors: Array<{ modelId: string; error: string }> = [];

  for (const row of rows.rows) {
    try {
      reports.push(await projectModel(row.model_id, options));
    } catch (err) {
      errors.push({
        modelId: row.model_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    total: rows.rows.length,
    applied: reports.filter((report) => report.applied).length,
    divergent: reports.filter((report) => !report.ok).length,
    skipped: reports.filter((report) => report.skipped).length,
    failed: errors.length,
    reports,
    errors,
  };
}

export function formatProjectionSummary(report: ProjectionReport): string {
  if (report.skipped) {
    return `[projector] modelo ${report.modelId}: ignorado (${report.reason ?? 'sem estado'})`;
  }
  if (report.ok) {
    return (
      `[projector] modelo ${report.modelId}: ${report.mode} ok ` +
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
  return `[projector] modelo ${report.modelId}: ${report.divergences.length} divergência(s) (${summary})`;
}

/** Versão textual do relatório de sombra para logs de startup/CLI. */
export function formatProjectionShadow(report: ProjectionReport): string {
  if (report.ok) return formatProjectionSummary(report);
  return `${formatProjectionSummary(report)}\n${formatShadowSummary({
    modelId: report.modelId,
    checkedAt: new Date().toISOString(),
    ok: report.ok,
    expected: report.expected,
    actual: report.actual,
    divergences: report.divergences,
  })}`;
}
