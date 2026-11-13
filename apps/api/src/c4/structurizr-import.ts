import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import type { CanonicalElementKind, CanonicalViewType } from './canonical.js';
import { slugify, viewTypeFromC4Type } from './canonical.js';
import { computeAutoLayout } from './autolayout.js';

/**
 * Importação de workspaces do Structurizr (Onda 2, item 8).
 *
 * Suporta o JSON do workspace e o DSL (subconjunto usado na prática: model,
 * person/softwareSystem/container/component, relationships e views). A
 * importação grava o modelo legado (`elements`/`edges`) e o canônico
 * (`model_elements`/`model_relationships`/`model_views`), de modo que DAS,
 * canvas, draw.io e exportação enxerguem o mesmo conteúdo.
 */

export type StructurizrFormat = 'json' | 'dsl';

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

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)
  );
}

function tagsFrom(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && !!item.trim());
  }
  const text = asString(value);
  return text ? text.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function uniqueIdentifier(name: string, used: Set<string>): string {
  const base = slugify(name) || 'element';
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index++}`;
  }
  used.add(candidate);
  return candidate;
}

interface RawRelationship {
  source: string;
  destinationId: string;
  description: string | null;
  technology: string | null;
}

function parseJsonWorkspace(content: string): ImportedWorkspace {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const workspace =
    parsed.workspace && typeof parsed.workspace === 'object'
      ? (parsed.workspace as Record<string, unknown>)
      : parsed;
  const model =
    workspace.model && typeof workspace.model === 'object'
      ? (workspace.model as Record<string, unknown>)
      : {};

  const elements: ImportedElement[] = [];
  const rawRelationships: RawRelationship[] = [];
  const numeric = new Map<string, string>();
  const used = new Set<string>();

  const walk = (
    items: Array<Record<string, unknown>>,
    kind: CanonicalElementKind,
    parentIdentifier: string | null
  ) => {
    for (const item of items) {
      const name = asString(item.name) ?? 'Sem nome';
      let identifier = asString(item.identifier);
      if (!identifier) {
        identifier = uniqueIdentifier(name, used);
      } else if (used.has(identifier)) {
        identifier = uniqueIdentifier(identifier, used);
      } else {
        used.add(identifier);
      }
      if (item.id !== undefined && item.id !== null) {
        numeric.set(String(item.id), identifier);
      }
      elements.push({
        identifier,
        kind,
        name,
        description: asString(item.description),
        technology: asString(item.technology),
        tags: tagsFrom(item.tags),
        url: asString(item.url),
        parentIdentifier,
      });

      for (const relationship of asArray(item.relationships)) {
        const destination = relationship.destinationId;
        if (destination === undefined || destination === null) continue;
        rawRelationships.push({
          source: identifier,
          destinationId: String(destination),
          description: asString(relationship.description),
          technology: asString(relationship.technology),
        });
      }

      if (kind === 'software_system') {
        walk(asArray(item.containers), 'container', identifier);
      } else if (kind === 'container') {
        walk(asArray(item.components), 'component', identifier);
      }
    }
  };

  walk(asArray(model.people), 'person', null);
  walk(asArray(model.softwareSystems), 'software_system', null);
  // Deployment nodes e instâncias não têm equivalente legado; são preservados
  // como elementos canônicos para não perder informação na importação.
  walk(asArray(model.deploymentNodes), 'deployment_node', null);

  const relationships: ImportedRelationship[] = [];
  for (const relationship of rawRelationships) {
    const targetIdentifier = numeric.get(relationship.destinationId);
    if (!targetIdentifier) continue;
    relationships.push({
      sourceIdentifier: relationship.source,
      targetIdentifier,
      description: relationship.description,
      technology: relationship.technology,
    });
  }

  const views: ImportedView[] = [];
  const viewsObject =
    workspace.views && typeof workspace.views === 'object'
      ? (workspace.views as Record<string, unknown>)
      : {};
  const viewGroups: Array<[string, CanonicalViewType, string]> = [
    ['systemLandscapeViews', 'filtered', 'landscape'],
    ['systemContextViews', 'system_context', 'context'],
    ['containerViews', 'container', 'containers'],
    ['componentViews', 'component', 'components'],
    ['dynamicViews', 'dynamic', 'dynamic'],
    ['deploymentViews', 'deployment', 'deployment'],
    ['filteredViews', 'filtered', 'filtered'],
  ];

  for (const [group, type, fallbackKey] of viewGroups) {
    const list = asArray(viewsObject[group]);
    list.forEach((view, index) => {
      const key = asString(view.key) ?? `${fallbackKey}${index > 0 ? index + 1 : ''}`;
      const scopeId = view.softwareSystemId ?? view.containerId ?? view.elementId;
      views.push({
        key,
        type,
        title: asString(view.description) ?? asString(view.key) ?? fallbackKey,
        scopeIdentifier:
          scopeId !== undefined && scopeId !== null ? numeric.get(String(scopeId)) ?? null : null,
      });
    });
  }

  return {
    name: asString(workspace.name),
    description: asString(workspace.description),
    elements,
    relationships,
    views,
  };
}

function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlocks
    .split(/\r?\n/)
    .map((line) => {
      let inString = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"' && line[index - 1] !== '\\') {
          inString = !inString;
        }
        if (!inString && (line.startsWith('//', index) || char === '#')) {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join('\n');
}

const ELEMENT_TYPES: Record<string, CanonicalElementKind> = {
  person: 'person',
  softwaresystem: 'software_system',
  container: 'container',
  component: 'component',
};

const VIEW_TYPES: Record<string, CanonicalViewType> = {
  systemlandscape: 'filtered',
  systemcontext: 'system_context',
  container: 'container',
  component: 'component',
  dynamic: 'dynamic',
  deployment: 'deployment',
  filtered: 'filtered',
  image: 'image',
};

function parseDslWorkspace(content: string): ImportedWorkspace {
  const source = stripComments(content);
  const lines = source.split(/\r?\n/);

  const elements: ImportedElement[] = [];
  const relationships: ImportedRelationship[] = [];
  const views: ImportedView[] = [];
  const used = new Set<string>();
  const elementByIdentifier = new Map<string, ImportedElement>();
  let name: string | null = null;
  let description: string | null = null;
  let viewIndex = 0;

  interface Scope {
    type: 'workspace' | 'model' | 'views' | 'element' | 'view' | 'other';
    identifier?: string;
  }
  const stack: Scope[] = [];

  const currentElement = (): ImportedElement | null => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const scope = stack[index];
      if (scope.type === 'element' && scope.identifier) {
        return elementByIdentifier.get(scope.identifier) ?? null;
      }
    }
    return null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('}')) {
      stack.pop();
      continue;
    }

    const workspaceMatch = /^workspace\b(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?/.exec(line);
    if (workspaceMatch && stack.length === 0) {
      name = workspaceMatch[1] ?? null;
      description = workspaceMatch[2] ?? null;
      if (line.endsWith('{')) stack.push({ type: 'workspace' });
      continue;
    }

    if (/^model\s*\{?$/.test(line)) {
      if (line.endsWith('{')) stack.push({ type: 'model' });
      continue;
    }
    if (/^views\s*\{?$/.test(line)) {
      if (line.endsWith('{')) stack.push({ type: 'views' });
      continue;
    }

    const relationshipMatch =
      /^([A-Za-z0-9_.-]+)\s*->\s*([A-Za-z0-9_.-]+)\s*(?:"([^"]*)")?(?:\s+"([^"]*)")?/.exec(line);
    if (relationshipMatch) {
      relationships.push({
        sourceIdentifier: relationshipMatch[1],
        targetIdentifier: relationshipMatch[2],
        description: relationshipMatch[3] ?? null,
        technology: relationshipMatch[4] ?? null,
      });
      if (line.endsWith('{')) stack.push({ type: 'other' });
      continue;
    }

    const elementMatch =
      /^([A-Za-z0-9_.-]+)\s*=\s*(person|softwareSystem|container|component)\s+"([^"]*)"(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?/i.exec(
        line
      );
    if (elementMatch) {
      const identifier = elementMatch[1];
      const rawType = elementMatch[2].toLowerCase();
      const kind = ELEMENT_TYPES[rawType];
      if (!kind) continue;
      const parent = currentElement();
      const third = elementMatch[4] ?? null;
      const fourth = elementMatch[5] ?? null;
      const fifth = elementMatch[6] ?? null;
      const isContainer = kind === 'container' || kind === 'component';
      const element: ImportedElement = {
        identifier,
        kind,
        name: elementMatch[3] || 'Sem nome',
        description: third,
        technology: isContainer ? fourth : null,
        tags: tagsFrom(isContainer ? fifth : fourth),
        url: null,
        parentIdentifier: parent?.identifier ?? null,
      };
      used.add(identifier);
      elementByIdentifier.set(identifier, element);
      elements.push(element);
      if (line.endsWith('{')) stack.push({ type: 'element', identifier });
      continue;
    }

    const viewMatch =
      /^(systemLandscape|systemContext|container|component|dynamic|deployment|filtered|image)\b(?:\s+([A-Za-z0-9_.-]+|\*))?/.exec(
        line
      );
    if (viewMatch) {
      const rawType = viewMatch[1].toLowerCase();
      const type = VIEW_TYPES[rawType] ?? 'filtered';
      const scope = viewMatch[2] && viewMatch[2] !== '*' ? viewMatch[2] : null;
      viewIndex += 1;
      views.push({
        key: `${rawType}${viewIndex > 1 ? `-${viewIndex}` : ''}`,
        type,
        title: rawType,
        scopeIdentifier: scope,
      });
      if (line.endsWith('{')) stack.push({ type: 'view' });
      continue;
    }

    if (line.endsWith('{')) stack.push({ type: 'other' });
  }

  return {
    name,
    description,
    elements,
    relationships: relationships.filter(
      (relationship) =>
        elementByIdentifier.has(relationship.sourceIdentifier) &&
        elementByIdentifier.has(relationship.targetIdentifier)
    ),
    views,
  };
}

export function detectStructurizrFormat(content: string): StructurizrFormat {
  const trimmed = content.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'dsl';
}

export function parseStructurizrWorkspace(
  content: string,
  format?: StructurizrFormat
): ImportedWorkspace {
  const effectiveFormat = format ?? detectStructurizrFormat(content);
  if (effectiveFormat === 'json') {
    return parseJsonWorkspace(content);
  }
  return parseDslWorkspace(content);
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
  c4Type?: string | null;
  fileName?: string | null;
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
 * Persiste o workspace importado. Em `replace`, o conteúdo anterior do modelo é
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
        source: 'structurizr',
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
          JSON.stringify({ legacyType, order, importIdentifier: element.identifier }),
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
          JSON.stringify({ legacyType: 'depends', source: 'structurizr' }),
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
    if (options.c4Type) {
      await client.query('UPDATE models SET c4_type = $1 WHERE id = $2', [
        options.c4Type,
        modelId,
      ]);
    }
    await client.query('UPDATE models SET updated_at = NOW() WHERE id = $1', [modelId]);

    await client.query('COMMIT');

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
