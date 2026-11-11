import { pool } from '../db.js';
import { canonicalModelHasData, loadCanonicalElements, loadCanonicalEdges } from './canonical-access.js';
import { flags } from '../flags.js';

/**
 * Inspections / saúde da arquitetura (Onda 2, item 6).
 *
 * Analisa um modelo e devolve uma lista de problemas (descrições ausentes,
 * relações órfãs, views vazias, tecnologias faltantes, etc.) para que o
 * frontend possa exibi-los e o usuário corrigir.
 */

export type InspectionSeverity = 'error' | 'warning' | 'info';

export interface InspectionIssue {
  code: string;
  severity: InspectionSeverity;
  message: string;
  entityId?: string;
  viewKey?: string;
}

export interface InspectionReport {
  modelId: string;
  totalIssues: number;
  bySeverity: Record<InspectionSeverity, number>;
  issues: InspectionIssue[];
}

export async function inspectModel(modelId: string): Promise<InspectionReport> {
  const issues: InspectionIssue[] = [];

  const model = await pool.query<{ id: string; title: string; c4_type: string | null }>(
    'SELECT id, title, c4_type FROM models WHERE id = $1',
    [modelId]
  );
  if (model.rows.length === 0) {
    return { modelId, totalIssues: 0, bySeverity: { error: 0, warning: 0, info: 0 }, issues: [] };
  }

  const useCanonical = flags.canonicalModel === 'on' && (await canonicalModelHasData(modelId));

  const elements = useCanonical
    ? await loadCanonicalElements(modelId)
    : (await pool.query<{
        id: string;
        type: string;
        title: string;
        description: string | null;
        metadata: unknown;
      }>('SELECT id, type, title, description, metadata FROM elements WHERE model_id = $1', [
        modelId,
      ])).rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        description: row.description,
        metadata: row.metadata,
        app_id: null,
        service_id: null,
        position_x: 0,
        position_y: 0,
        order: 0,
      }));

  const edges = useCanonical
    ? await loadCanonicalEdges(modelId)
    : (await pool.query<{
        id: string;
        from_id: string;
        to_id: string;
        label: string | null;
        type: string;
      }>('SELECT id, from_id, to_id, label, type FROM edges WHERE model_id = $1', [modelId]))
        .rows.map((row) => ({
          id: row.id,
          model_id: modelId,
          from_id: row.from_id,
          to_id: row.to_id,
          label: row.label ?? '',
          type: row.type,
        }));

  const elementIds = new Set(elements.map((element) => element.id));
  const elementTitles = new Map(elements.map((element) => [element.id, element.title]));

  // Elementos sem descrição.
  for (const element of elements) {
    if (!element.description || !String(element.description).trim()) {
      issues.push({
        code: 'MISSING_DESCRIPTION',
        severity: 'warning',
        message: `Elemento "${element.title}" não tem descrição.`,
        entityId: element.id,
      });
    }
    const metadata = (element.metadata ?? {}) as Record<string, unknown>;
    if (
      (element.type === 'container' || element.type === 'system') &&
      !metadata.technology &&
      !metadata.tech
    ) {
      issues.push({
        code: 'MISSING_TECHNOLOGY',
        severity: 'info',
        message: `Elemento "${element.title}" não declara tecnologia.`,
        entityId: element.id,
      });
    }
  }

  // Nomes duplicados.
  const titleCount = new Map<string, number>();
  for (const element of elements) {
    const key = (element.title ?? '').trim().toLowerCase();
    if (!key) continue;
    titleCount.set(key, (titleCount.get(key) ?? 0) + 1);
  }
  for (const [title, count] of titleCount) {
    if (count > 1) {
      issues.push({
        code: 'DUPLICATE_NAME',
        severity: 'warning',
        message: `Existem ${count} elementos com o nome "${title}".`,
      });
    }
  }

  // Relações órfãs ou com pontas inexistentes.
  for (const edge of edges) {
    if (!elementIds.has(edge.from_id) || !elementIds.has(edge.to_id)) {
      issues.push({
        code: 'DANGLING_RELATIONSHIP',
        severity: 'error',
        message: `Relação referencia elemento inexistente.`,
        entityId: edge.id,
      });
      continue;
    }
    if (edge.from_id === edge.to_id) {
      issues.push({
        code: 'SELF_RELATIONSHIP',
        severity: 'error',
        message: `Relação aponta para o próprio elemento "${elementTitles.get(edge.from_id)}".`,
        entityId: edge.id,
      });
    }
    if (!edge.label || !String(edge.label).trim()) {
      issues.push({
        code: 'MISSING_RELATIONSHIP_LABEL',
        severity: 'info',
        message: `Relação entre "${elementTitles.get(edge.from_id)}" e "${elementTitles.get(edge.to_id)}" não tem rótulo.`,
        entityId: edge.id,
      });
    }
  }

  // Views vazias (canônico).
  if (useCanonical) {
    const views = await pool.query<{ key: string }>(
      'SELECT key FROM model_views WHERE model_id = $1',
      [modelId]
    );
    for (const view of views.rows) {
      const layoutCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM model_view_layout l
           JOIN model_views v ON v.id = l.view_id
          WHERE v.model_id = $1 AND v.key = $2`,
        [modelId, view.key]
      );
      if (Number(layoutCount.rows[0]?.count ?? 0) === 0) {
        issues.push({
          code: 'EMPTY_VIEW',
          severity: 'warning',
          message: `A view "${view.key}" não possui elementos posicionados.`,
          viewKey: view.key,
        });
      }
    }
  } else {
    // Legado: view vazia se não houver diagramas.
    const diagramCount = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM models WHERE id = $1 AND (drawio_xml IS NOT NULL OR diagrams IS NOT NULL)',
      [modelId]
    );
    if (Number(diagramCount.rows[0]?.count ?? 0) === 0 && elements.length > 0) {
      issues.push({
        code: 'NO_DIAGRAMS',
        severity: 'info',
        message: 'O modelo não possui diagramas draw.io.',
      });
    }
  }

  const bySeverity: Record<InspectionSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) bySeverity[issue.severity] += 1;

  return {
    modelId,
    totalIssues: issues.length,
    bySeverity,
    issues,
  };
}
