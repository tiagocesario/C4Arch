import { createHash } from 'node:crypto';
import type { C4ModelType } from './model-types.js';

/**
 * Mapeadores puros entre o modelo legado (`elements`/`edges`/`models`) e o
 * modelo canônico (`model_elements`/`model_relationships`/`model_views`).
 *
 * Nada aqui acessa o banco: o objetivo é manter o backfill e a comparação em
 * sombra testáveis sem Postgres e com o mesmo resultado em qualquer execução.
 */

export type CanonicalElementKind =
  | 'person'
  | 'software_system'
  | 'container'
  | 'component'
  | 'deployment_node'
  | 'infrastructure_node'
  | 'container_instance'
  | 'software_system_instance';

export type CanonicalViewType =
  | 'system_context'
  | 'container'
  | 'component'
  | 'dynamic'
  | 'deployment'
  | 'filtered'
  | 'image';

export type DasOverrideMode = 'replace' | 'append' | 'hide';

export interface LegacyElementRow {
  id: string;
  model_id: string;
  app_id?: string | null;
  service_id?: string | null;
  type: string;
  title: string;
  description?: string | null;
  metadata?: unknown;
  position_x?: number | null;
  position_y?: number | null;
  order?: number | null;
}

export interface LegacyEdgeRow {
  id: string;
  model_id: string;
  from_id: string;
  to_id: string;
  label?: string | null;
  type: string;
}

export interface LegacyModelRow {
  id: string;
  org_id: string;
  folder_id?: string | null;
  title: string;
  description?: string | null;
  status?: string | null;
  c4_type?: string | null;
  c4_scope?: string | null;
  parent_id?: string | null;
  drawio_xml?: string | null;
  diagrams?: unknown;
  das_content?: string | null;
}

export interface CanonicalElement {
  id: string;
  model_id: string;
  parent_element_id: string | null;
  identifier: string;
  kind: CanonicalElementKind;
  name: string;
  description: string | null;
  technology: string | null;
  url: string | null;
  tags: string[];
  properties: Record<string, unknown>;
  app_id: string | null;
  service_id: string | null;
}

export interface CanonicalRelationship {
  id: string;
  model_id: string;
  source_id: string;
  target_id: string;
  description: string | null;
  technology: string | null;
  tags: string[];
  properties: Record<string, unknown>;
}

export interface CanonicalView {
  model_id: string;
  key: string;
  type: CanonicalViewType;
  scope_element_id: string | null;
  title: string | null;
  description: string | null;
  include: unknown[];
  exclude: unknown[];
  auto_layout: boolean;
}

export interface CanonicalLayoutRow {
  viewKey: string;
  element_id: string | null;
  object_key: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  style: Record<string, unknown>;
}

export interface CanonicalDasOverride {
  section_key: string;
  content: string | null;
  mode: DasOverrideMode;
}

export interface CanonicalVersion {
  id: string;
  version: number;
  content_hash: string | null;
  author_id: string | null;
  duplicate: boolean;
}

export interface BackfillWarning {
  code: string;
  message: string;
  entityId?: string;
  viewKey?: string;
}

export interface CanonicalSnapshot {
  modelId: string;
  elements: CanonicalElement[];
  relationships: CanonicalRelationship[];
  views: CanonicalView[];
  layout: CanonicalLayoutRow[];
  overrides: CanonicalDasOverride[];
  versions: CanonicalVersion[];
  contentHash: string;
  dasSourceHash: string;
  warnings: BackfillWarning[];
  stats: {
    elements: number;
    relationships: number;
    views: number;
    layout: number;
    overrides: number;
    versions: number;
    duplicateVersions: number;
    skippedRelationships: number;
  };
}

const LEGACY_KIND_MAP: Record<string, CanonicalElementKind> = {
  actor: 'person',
  system: 'software_system',
  container: 'container',
  component: 'component',
};

const VIEW_TYPE_MAP: Record<C4ModelType, CanonicalViewType> = {
  'system-context': 'system_context',
  container: 'container',
  component: 'component',
  // O schema canônico não tem um tipo de view "code". A view é preservada pela
  // chave (`code`) e projetada como componente.
  code: 'component',
  'system-landscape': 'filtered',
  dynamic: 'dynamic',
  deployment: 'deployment',
};

export const VIEW_TYPE_LABEL: Record<CanonicalViewType, string> = {
  system_context: 'Contexto do sistema',
  container: 'Containers',
  component: 'Componentes',
  dynamic: 'Dinâmico',
  deployment: 'Implantação',
  filtered: 'Filtrada',
  image: 'Imagem',
};

export function elementKindFromLegacy(type: string): CanonicalElementKind {
  return LEGACY_KIND_MAP[type] ?? 'component';
}

export function viewTypeFromC4Type(c4Type: string | null | undefined): CanonicalViewType {
  if (!c4Type) return 'container';
  return VIEW_TYPE_MAP[c4Type as C4ModelType] ?? 'filtered';
}

export function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Slug estável usado no `identifier` canônico. */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'element';
}

/**
 * O UUID entra no identificador para que dois elementos com o mesmo nome no
 * mesmo modelo continuem distintos e o backfill seja idempotente.
 */
export function buildIdentifier(name: string, id: string): string {
  return `${slugify(name)}-${id.slice(0, 8).toLowerCase()}`;
}

export interface ExtractedMetadata {
  technology: string | null;
  url: string | null;
  tags: string[];
  properties: Record<string, unknown>;
}

function extractTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function extractElementMetadata(metadata: unknown): ExtractedMetadata {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { technology: null, url: null, tags: [], properties: {} };
  }

  const record = { ...(metadata as Record<string, unknown>) };
  const rawTechnology = record.technology ?? record.tech;
  const technology =
    typeof rawTechnology === 'string' ? normalizeText(rawTechnology) : null;
  const url = typeof record.url === 'string' ? normalizeText(record.url) : null;
  const tags = extractTags(record.tags);

  delete record.technology;
  delete record.tech;
  delete record.url;
  delete record.tags;

  return { technology, url, tags, properties: record };
}

export function toCanonicalElement(
  row: LegacyElementRow,
  parentElementId: string | null = null
): CanonicalElement {
  const metadata = extractElementMetadata(row.metadata);
  const properties = { ...metadata.properties };
  if (!('legacyType' in properties)) properties.legacyType = row.type;

  return {
    id: row.id,
    model_id: row.model_id,
    parent_element_id: parentElementId,
    identifier: buildIdentifier(row.title, row.id),
    kind: elementKindFromLegacy(row.type),
    name: row.title.trim(),
    description: normalizeText(row.description),
    technology: metadata.technology,
    url: metadata.url,
    tags: metadata.tags,
    properties,
    app_id: row.app_id ?? null,
    service_id: row.service_id ?? null,
  };
}

/**
 * Extrai uma tecnologia entre colchetes no rótulo da relação, como
 * `"Chama [HTTP]"` → `"HTTP"`.
 */
export function extractTechnologyFromLabel(label: string | null | undefined): string | null {
  if (typeof label !== 'string') return null;
  const matches = [...label.matchAll(/\[([^\]]+)\]/g)];
  if (matches.length === 0) return null;
  return normalizeText(matches[matches.length - 1][1]);
}

export function toCanonicalRelationship(row: LegacyEdgeRow): CanonicalRelationship {
  const label = normalizeText(row.label);
  return {
    id: row.id,
    model_id: row.model_id,
    source_id: row.from_id,
    target_id: row.to_id,
    description: label,
    technology: extractTechnologyFromLabel(label),
    tags: [],
    properties: { legacyType: row.type },
  };
}

/** JSON determinístico: chaves ordenadas em todos os níveis. */
export function stableStringify(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') {
      const record = input as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, sort(record[key])])
      );
    }
    return input;
  };
  return JSON.stringify(sort(value));
}

export function computeContentHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

export function computeDasSourceHash(
  modelContentHash: string,
  overrides: CanonicalDasOverride[],
  templateVersion = '0.3.0'
): string {
  const overridesHash = computeContentHash(
    [...overrides].sort((a, b) => a.section_key.localeCompare(b.section_key))
  );
  return computeContentHash({
    model: modelContentHash,
    overrides: overridesHash,
    templateVersion,
  });
}

export interface DasSection {
  key: string;
  level: number;
  heading: string;
  content: string;
  hasChildren: boolean;
}

/**
 * Divide o DAS em seções numeradas (`## 6. ...`, `### 6.1 ...`). A chave é o
 * número estável usado em `model_das_overrides`.
 */
export function parseDasSections(markdown: string): DasSection[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const starts: Array<{ index: number; key: string; level: number; heading: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{2,3})\s+(\d+(?:\.\d+)*)\.?\s+(.+)$/.exec(lines[index].trim());
    if (!match) continue;
    starts.push({
      index,
      key: match[2],
      level: match[1].length,
      heading: lines[index].trim(),
    });
  }

  return starts.map((start, position) => {
    const next = starts[position + 1];
    const content = lines
      .slice(start.index, next ? next.index : lines.length)
      .join('\n')
      .trim();
    return {
      key: start.key,
      level: start.level,
      heading: start.heading,
      content,
      hasChildren: Boolean(next && next.level > start.level),
    };
  });
}

// Seções voláteis: data/hora da geração e histórico. Nunca viram override.
const VOLATILE_SECTIONS = new Set(['1', '10']);

export interface DasDiff {
  overrides: CanonicalDasOverride[];
  changedKeys: string[];
}

function normalizeSection(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

/**
 * Compara o DAS editado (`das_content`) com o DAS gerado pelo template atual e
 * produz overrides apenas nas seções folha que realmente divergem.
 *
 * Se o texto não tiver seções reconhecíveis, preserva o documento inteiro como
 * override `document` (fallback previsto na ADR-0023).
 */
export function diffDasSections(generated: string, legacy: string): DasDiff {
  if (normalizeSection(generated) === normalizeSection(legacy)) {
    return { overrides: [], changedKeys: [] };
  }

  const generatedSections = parseDasSections(generated);
  if (generatedSections.length === 0) {
    return {
      overrides: [{ section_key: 'document', content: legacy, mode: 'replace' }],
      changedKeys: ['document'],
    };
  }

  const legacyByKey = new Map(parseDasSections(legacy).map((section) => [section.key, section]));
  const overrides: CanonicalDasOverride[] = [];

  for (const section of generatedSections) {
    if (VOLATILE_SECTIONS.has(section.key) || section.hasChildren) continue;
    const legacySection = legacyByKey.get(section.key);
    if (!legacySection) continue;
    if (normalizeSection(section.content) === normalizeSection(legacySection.content)) {
      continue;
    }
    overrides.push({
      section_key: section.key,
      content: legacySection.content,
      mode: 'replace',
    });
  }

  return { overrides, changedKeys: overrides.map((override) => override.section_key) };
}
