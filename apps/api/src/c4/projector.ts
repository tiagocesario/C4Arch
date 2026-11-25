import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import {
  applyCanonicalSnapshot,
  buildCanonicalSnapshot,
  type BuildSnapshotInput,
} from './backfill.js';
import type {
  CanonicalLayoutRow,
  CanonicalSnapshot,
  CanonicalView,
  LegacyModelRow,
} from './canonical.js';
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
 * O Yjs carrega apenas elementos/arestas, não views nem layout por view. Sem
 * esta mesclagem, `applyCanonicalSnapshot(..., { prune: true })` apagava todas
 * as views importadas do PlantUML e o layout delas, deixando somente a view
 * primária sintética. Views existentes são preservadas; para a view primária,
 * o snapshot derivado continua sendo a fonte do layout.
 */
export function preserveExistingViews(
  snapshot: CanonicalSnapshot,
  existing: Pick<CanonicalSnapshot, 'views' | 'layout'>
): void {
  const derivedKeys = new Set(snapshot.views.map((view) => view.key));
  const existingByKey = new Map(existing.views.map((view) => [view.key, view]));

  // Prefere a definição persistida quando a chave já existe: o snapshot
  // derivado usa um título/descrição sintéticos que não devem sobrescrever a
  // configuração original importada.
  snapshot.views = snapshot.views.map((view) => {
    const current = existingByKey.get(view.key);
    return current ? { ...(current as CanonicalView), model_id: snapshot.modelId } : view;
  });

  const preservedKeys = new Set<string>();
  for (const view of existing.views) {
    if (derivedKeys.has(view.key)) continue;
    snapshot.views.push({ ...(view as CanonicalView), model_id: snapshot.modelId });
    preservedKeys.add(view.key);
  }

  for (const row of existing.layout) {
    if (!preservedKeys.has(row.viewKey)) continue;
    snapshot.layout.push({ ...(row as CanonicalLayoutRow) });
  }

  snapshot.stats.views = snapshot.views.length;
  snapshot.stats.layout = snapshot.layout.length;
}

/**
 * Preserva detalhes canônicos que o Yjs não carrega (identificador, URL, tags,
 * tecnologia das relações e hierarquia). O estado colaborativo só transporta
 * tipo, título, descrição, metadados e posição; sem esta mesclagem, cada flush
 * do editor apagaria a tecnologia das relações e renomearia os identificadores
 * importados do PlantUML.
 */
export interface ExistingElementDetails {
  id: string;
  parent_element_id?: string | null;
  identifier?: string | null;
  url?: string | null;
  tags?: string[] | null;
}

export interface ExistingRelationshipDetails {
  id: string;
  technology?: string | null;
  tags?: string[] | null;
}

/**
 * Mescla os detalhes canônicos no snapshot derivado do Yjs. Função pura para
 * poder ser testada sem banco; a leitura das linhas fica em
 * `loadCanonicalDetails`.
 */
export function preserveCanonicalDetails(
  snapshot: CanonicalSnapshot,
  existingElements: ExistingElementDetails[],
  existingRelationships: ExistingRelationshipDetails[]
): void {
  const elementsById = new Map(existingElements.map((row) => [row.id, row]));
  const ids = new Set(snapshot.elements.map((element) => element.id));

  for (const element of snapshot.elements) {
    const current = elementsById.get(element.id);
    if (!current) continue;

    if (current.identifier && element.identifier !== current.identifier) {
      element.identifier = current.identifier;
    }
    if (!element.url && current.url) element.url = current.url;
    if ((!element.tags || element.tags.length === 0) && current.tags?.length) {
      element.tags = current.tags;
    }

    if (element.parent_element_id) continue;
    const parent = current.parent_element_id;
    if (parent && ids.has(parent) && parent !== element.id) {
      element.parent_element_id = parent;
    }
  }

  const relationshipsById = new Map(
    existingRelationships.map((row) => [row.id, row])
  );

  for (const relationship of snapshot.relationships) {
    const current = relationshipsById.get(relationship.id);
    if (!current) continue;
    if (!relationship.technology && current.technology) {
      relationship.technology = current.technology;
    }
    if (
      (!relationship.tags || relationship.tags.length === 0) &&
      current.tags?.length
    ) {
      relationship.tags = current.tags;
    }
  }
}

async function loadCanonicalDetails(
  client: PoolClient,
  modelId: string,
  snapshot: CanonicalSnapshot
): Promise<void> {
  const elementRows = await client.query<ExistingElementDetails>(
    `SELECT id, parent_element_id, identifier, url, tags
       FROM model_elements
      WHERE model_id = $1`,
    [modelId]
  );
  const relationshipRows = await client.query<ExistingRelationshipDetails>(
    'SELECT id, technology, tags FROM model_relationships WHERE model_id = $1',
    [modelId]
  );

  preserveCanonicalDetails(snapshot, elementRows.rows, relationshipRows.rows);
}

async function readState(
  client: PoolClient,
  modelId: string,
  lockForProjection = false
): Promise<{ row: StateRow; model: LegacyModelRow } | null> {
  const stateResult = await client.query<StateRow>(
    lockForProjection
      ? 'SELECT state, revision, content_hash FROM model_state WHERE model_id = $1 FOR SHARE'
      : 'SELECT state, revision, content_hash FROM model_state WHERE model_id = $1',
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
  let transactionStarted = false;

  try {
    if (mode === 'on') {
      // O lock compartilhado da linha `model_state` impede uma importação
      // autoritativa de confirmar entre a leitura do snapshot e a projeção.
      // A importação aguarda o commit do projetor e então publica o estado
      // novo, portanto o resultado final continua sendo o diagrama importado.
      await client.query('BEGIN');
      transactionStarted = true;
    }

    const loaded = await readState(client, modelId, mode === 'on');
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

    // Um flush antigo pode chegar ao projetor depois de uma importação/aplicação
    // que já gravou um estado mais novo. Aplicar o snapshot obsoleto desfaria a
    // alteração recém-salva, então confere o hash antes de escrever.
    const currentHash = await client.query<{ content_hash: string }>(
      'SELECT content_hash FROM model_state WHERE model_id = $1',
      [modelId]
    );
    if (currentHash.rows[0]?.content_hash !== contentHash) {
      return {
        modelId,
        mode,
        skipped: true,
        reason: 'estado desatualizado',
        applied: false,
        ok: true,
        contentHash,
        expected: emptyStats(),
        actual: emptyStats(),
        divergences: [],
        warnings: [],
      };
    }

    const expected = snapshotFromDecoded(loaded.model, decoded);
    await loadCanonicalDetails(client, modelId, expected);

    // O estado colaborativo não conhece views/layout das views secundárias:
    // mescla o que já está persistido antes de comparar ou aplicar.
    const actual = await loadCanonicalSnapshot(client, modelId);
    preserveExistingViews(expected, actual);

    if (mode === 'shadow') {
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

    try {
      await applyCanonicalSnapshot(client, expected, { prune: true });
      await client.query('COMMIT');
      transactionStarted = false;
    } catch (err) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      throw err;
    }

    const applied = await loadCanonicalSnapshot(client, modelId);
    const divergences = compareProjected(expected, applied);
    for (const divergence of divergences) recordProjectionDivergence(divergence.kind);
    const report: ProjectionReport = {
      modelId,
      mode,
      skipped: false,
      applied: true,
      ok: divergences.length === 0,
      contentHash,
      expected: expected.stats,
      actual: applied.stats,
      divergences,
      warnings: expected.warnings.map((warning) => warning.message),
    };
    recordProjectionRun(mode, report.ok ? 'ok' : 'divergent');
    return report;
  } catch (err) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => undefined);
      transactionStarted = false;
    }
    recordProjectionError();
    throw err;
  } finally {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
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
