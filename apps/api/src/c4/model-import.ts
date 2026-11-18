import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import type { CanonicalElementKind, CanonicalViewType } from './canonical.js';
import { viewTypeFromC4Type } from './canonical.js';
import { computeAutoLayout } from './autolayout.js';
import { loadModelGraph } from './model-graph.js';
import { renderDrawio } from './exporters.js';
import { computeStateContentHash, encodeModelState, stateVectorOf } from './state.js';

/**
 * Persistência de diagramas importados.
 *
 * O parser (PlantUML) produz um `ImportedWorkspace` independente de formato; a
 * importação grava o modelo legado (`elements`/`edges`) e o canônico
 * (`model_elements`/`model_relationships`/`model_views`), de modo que DAS,
 * canvas, draw.io e exportação enxerguem o mesmo conteúdo.
 */

export interface ImportedElement {
  identifier: string;
  kind: CanonicalElementKind;
  name: string;
  description: string | null;
  technology: string | null;
  tags: string[];
  url: string | null;
  parentIdentifier: string | null;
}

export interface ImportedRelationship {
  sourceIdentifier: string;
  targetIdentifier: string;
  description: string | null;
  technology: string | null;
}

export interface ImportedView {
  key: string;
  type: CanonicalViewType;
  title: string | null;
  scopeIdentifier: string | null;
}

export interface ImportedWorkspace {
  name: string | null;
  description: string | null;
  elements: ImportedElement[];
  relationships: ImportedRelationship[];
  views: ImportedView[];
}

const LEGACY_TYPE_BY_KIND: Record<CanonicalElementKind, string> = {
  person: 'actor',
  software_system: 'system',
  container: 'container',
  component: 'component',
  deployment_node: 'system',
  infrastructure_node: 'system',
  container_instance: 'container',
  software_system_instance: 'system',
};

export interface ImportOptions {
  mode?: 'replace' | 'merge';
  title?: string | null;
  description?: string | null;
  c4Type?: string | null;
}

export interface ImportResult {
  modelId: string;
  mode: 'replace' | 'merge';
  elements: number;
  relationships: number;
  views: number;
  skippedRelationships: number;
}

/**
 * Gera o XML draw.io inicial a partir do grafo já persistido. Sem ele, o
 * preview e o editor draw.io abriam vazios para modelos importados (o XML só
 * era gravado após uma edição manual no editor).
 */
export async function persistDrawioArtifact(modelId: string): Promise<void> {
  try {
    const graph = await loadModelGraph(modelId);
    if (!graph || graph.elements.length === 0) return;
    const xml = renderDrawio(graph);
    await pool.query('UPDATE models SET drawio_xml = $1, updated_at = NOW() WHERE id = $2', [
      xml,
      modelId,
    ]);
  } catch (error) {
    // O desenho é derivável do grafo; uma falha aqui não deve desfazer a
    // importação, que já foi confirmada na transação.
    console.error('[imports] falha ao gerar XML draw.io inicial:', error);
  }
}

/**
 * Invalida o estado colaborativo durável (`model_state`) depois de uma
 * substituição autoritativa do modelo (importação/aplicação de PlantUML).
 *
 * O realtime hidrata o Yjs a partir de `model_state`. Se o snapshot antigo
 * permanecer, o editor reabre com o desenho anterior e o projetor pode
 * sobrescrever o conteúdo recém-aplicado no próximo flush. Sem a linha, o
 * próximo `join` volta a hidratar do modelo canônico.
 */
export async function invalidateCollaborativeState(modelId: string): Promise<void> {
  try {
    await pool.query('DELETE FROM model_state WHERE model_id = $1', [modelId]);
  } catch (error) {
    // O canônico já foi confirmado; a invalidação é uma salvaguarda.
    console.error('[imports] falha ao invalidar model_state:', error);
  }
}

/**
 * Sincroniza o snapshot colaborativo durável com o modelo recém-aplicado.
 *
 * A aplicação de PlantUML é uma substituição autoritativa: além do Postgres,
 * o `model_state` precisa representar o mesmo grafo. Sem isso, uma sessão Yjs
 * antiga pode reidratar o desenho anterior e sobrescrever a alteração salva.
 * Se a sincronização falhar, remover o estado antigo ainda evita uma
 * hidratação obsoleta.
 */
export async function syncCollaborativeState(modelId: string): Promise<void> {
  try {
    const graph = await loadModelGraph(modelId);
    if (!graph) throw new Error('Modelo não encontrado');

    const decoded = {
      elements: graph.elements.map((element) => ({
        id: element.id,
        type: element.type,
        title: element.title,
        description: element.description,
        metadata: element.metadata,
        position_x: element.position_x,
        position_y: element.position_y,
        order: element.order,
      })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        from_id: edge.from_id,
        to_id: edge.to_id,
        label: edge.label,
        type: edge.type,
      })),
    };
    const state = encodeModelState(decoded);
    const stateVector = stateVectorOf(state);
    const contentHash = computeStateContentHash(decoded);

    await pool.query(
      `INSERT INTO model_state
         (model_id, state, state_vector, content_hash, revision, updated_by)
       VALUES ($1, $2, $3, $4, 1, NULL)
       ON CONFLICT (model_id) DO UPDATE SET
         state = EXCLUDED.state,
         state_vector = EXCLUDED.state_vector,
         content_hash = EXCLUDED.content_hash,
         revision = model_state.revision + 1,
         updated_at = NOW(),
         updated_by = NULL`,
      [modelId, Buffer.from(state), Buffer.from(stateVector), contentHash]
    );
  } catch (error) {
    console.error('[imports] falha ao sincronizar model_state:', error);
    await invalidateCollaborativeState(modelId);
  }
}

/**
 * Persiste o diagrama importado. Em `replace`, o conteúdo anterior do modelo é
 * removido; em `merge`, elementos são casados por `identifier` e atualizados.
 */
export async function importWorkspaceIntoModel(
  modelId: string,
  workspace: ImportedWorkspace,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const mode = options.mode ?? 'replace';
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const modelResult = await client.query<{
      id: string;
      c4_type: string | null;
      title: string | null;
    }>('SELECT id, c4_type, title FROM models WHERE id = $1 FOR UPDATE', [modelId]);
    if (modelResult.rows.length === 0) {
      throw new Error('Modelo não encontrado');
    }
    const model = modelResult.rows[0];

    if (mode === 'replace') {
      await client.query('DELETE FROM edges WHERE model_id = $1', [modelId]);
      await client.query('DELETE FROM elements WHERE model_id = $1', [modelId]);
      await client.query('DELETE FROM model_relationships WHERE model_id = $1', [modelId]);
      await client.query('DELETE FROM model_views WHERE model_id = $1', [modelId]);
      await client.query('DELETE FROM model_elements WHERE model_id = $1', [modelId]);
    }

    const existing = new Map<string, string>();
    if (mode === 'merge') {
      const rows = await client.query<{ id: string; identifier: string }>(
        'SELECT id, identifier FROM model_elements WHERE model_id = $1',
        [modelId]
      );
      for (const row of rows.rows) existing.set(row.identifier, row.id);
    }

    const idByIdentifier = new Map<string, string>();
    let order = 0;

    for (const element of workspace.elements) {
      const id = existing.get(element.identifier) ?? randomUUID();
      idByIdentifier.set(element.identifier, id);
      const legacyType = LEGACY_TYPE_BY_KIND[element.kind] ?? 'component';
      const metadata = {
        technology: element.technology,
        tags: element.tags.length > 0 ? element.tags : undefined,
        importIdentifier: element.identifier,
        source: 'plantuml',
      };

      await client.query(
        `INSERT INTO elements (id, model_id, type, title, description, metadata, position_x, position_y, "order")
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 0, 0, $7)
         ON CONFLICT (id) DO UPDATE SET
           type = EXCLUDED.type,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           metadata = EXCLUDED.metadata,
           "order" = EXCLUDED."order",
           updated_at = NOW()`,
        [
          id,
          modelId,
          legacyType,
          element.name,
          element.description,
          JSON.stringify(metadata),
          order++,
        ]
      );

      await client.query(
        `INSERT INTO model_elements
           (id, model_id, parent_element_id, identifier, kind, name, description,
            technology, url, tags, properties)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           identifier = EXCLUDED.identifier,
           kind = EXCLUDED.kind,
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           technology = EXCLUDED.technology,
           url = EXCLUDED.url,
           tags = EXCLUDED.tags,
           properties = EXCLUDED.properties,
           updated_at = NOW()`,
        [
          id,
          modelId,
          element.identifier,
          element.kind,
          element.name,
          element.description,
          element.technology,
          element.url,
          element.tags,
          JSON.stringify({ legacyType, order, importIdentifier: element.identifier, source: 'plantuml' }),
        ]
      );
    }

    // Segundo passe: hierarquia.
    for (const element of workspace.elements) {
      const id = idByIdentifier.get(element.identifier);
      const parentId = element.parentIdentifier
        ? idByIdentifier.get(element.parentIdentifier) ?? null
        : null;
      if (!id || !parentId) continue;
      await client.query('UPDATE model_elements SET parent_element_id = $1 WHERE id = $2', [
        parentId,
        id,
      ]);
    }

    let importedRelationships = 0;
    let skippedRelationships = 0;
    for (const relationship of workspace.relationships) {
      const fromId = idByIdentifier.get(relationship.sourceIdentifier);
      const toId = idByIdentifier.get(relationship.targetIdentifier);
      if (!fromId || !toId || fromId === toId) {
        skippedRelationships += 1;
        continue;
      }
      const edgeId = randomUUID();
      await client.query(
        `INSERT INTO edges (id, model_id, from_id, to_id, label, type)
         VALUES ($1, $2, $3, $4, $5, 'depends')`,
        [edgeId, modelId, fromId, toId, relationship.description ?? '']
      );
      await client.query(
        `INSERT INTO model_relationships
           (id, model_id, source_id, target_id, description, technology, tags, properties)
         VALUES ($1, $2, $3, $4, $5, $6, '{}', $7::jsonb)`,
        [
          edgeId,
          modelId,
          fromId,
          toId,
          relationship.description,
          relationship.technology,
          JSON.stringify({ legacyType: 'depends', source: 'plantuml' }),
        ]
      );
      importedRelationships += 1;
    }

    const effectiveC4Type = options.c4Type ?? model.c4_type ?? 'container';
    const views =
      workspace.views.length > 0
        ? workspace.views
        : [
            {
              key: effectiveC4Type,
              type: viewTypeFromC4Type(effectiveC4Type),
              title: model.title ?? 'Visão principal',
              scopeIdentifier: null,
            },
          ];

    for (const view of views) {
      await client.query(
        `INSERT INTO model_views (model_id, key, type, scope_element_id, title, include, exclude, auto_layout)
         VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, '[]'::jsonb, TRUE)
         ON CONFLICT (model_id, key) DO UPDATE SET
           type = EXCLUDED.type,
           scope_element_id = EXCLUDED.scope_element_id,
           title = EXCLUDED.title,
           auto_layout = TRUE,
           updated_at = NOW()`,
        [
          modelId,
          view.key,
          view.type,
          view.scopeIdentifier ? idByIdentifier.get(view.scopeIdentifier) ?? null : null,
          view.title,
        ]
      );
    }

    // Layout separado: calcula posições e grava tanto no legado (para o canvas
    // atual) quanto em `model_view_layout` (para views/exportação).
    const positions = computeAutoLayout(
      workspace.elements.map((element) => ({
        id: idByIdentifier.get(element.identifier) ?? element.identifier,
        type: LEGACY_TYPE_BY_KIND[element.kind] ?? 'component',
        title: element.name,
      })),
      workspace.relationships
        .map((relationship) => ({
          from: idByIdentifier.get(relationship.sourceIdentifier) ?? '',
          to: idByIdentifier.get(relationship.targetIdentifier) ?? '',
        }))
        .filter((edge) => edge.from && edge.to),
      { direction: 'LR', gapX: 90, gapY: 32 }
    );
    const positionById = new Map(positions.map((position) => [position.id, position]));

    for (const element of workspace.elements) {
      const id = idByIdentifier.get(element.identifier);
      if (!id) continue;
      const position = positionById.get(id);
      if (!position) continue;
      await client.query(
        'UPDATE elements SET position_x = $1, position_y = $2 WHERE id = $3',
        [Math.round(position.x), Math.round(position.y), id]
      );
      await client.query(
        `INSERT INTO model_view_layout (view_id, element_id, object_key, x, y, width, height, style)
         SELECT v.id, $1, NULL, $2, $3, 190, 90, '{"source":"autolayout"}'::jsonb
           FROM model_views v
          WHERE v.model_id = $4
         ON CONFLICT (view_id, element_id) WHERE element_id IS NOT NULL
         DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, width = EXCLUDED.width, height = EXCLUDED.height`,
        [id, position.x, position.y, modelId]
      );
    }

    if (options.title && options.title.trim()) {
      await client.query('UPDATE models SET title = $1 WHERE id = $2', [
        options.title.trim().slice(0, 200),
        modelId,
      ]);
    }
    if (options.description !== undefined) {
      await client.query('UPDATE models SET description = $1 WHERE id = $2', [
        options.description,
        modelId,
      ]);
    }
    if (options.c4Type) {
      await client.query('UPDATE models SET c4_type = $1 WHERE id = $2', [
        options.c4Type,
        modelId,
      ]);
    }
    await client.query('UPDATE models SET updated_at = NOW() WHERE id = $1', [modelId]);

    await client.query('COMMIT');

    // Depois do COMMIT: `loadModelGraph` usa o pool e precisa enxergar o
    // conteúdo persistido para gerar o desenho inicial.
    await persistDrawioArtifact(modelId);
    await syncCollaborativeState(modelId);

    return {
      modelId,
      mode,
      elements: workspace.elements.length,
      relationships: importedRelationships,
      views: views.length,
      skippedRelationships,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
