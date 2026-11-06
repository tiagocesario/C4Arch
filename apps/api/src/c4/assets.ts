import { pool } from '../db.js';

/**
 * Apps e serviços são containers do C4 model. No draw.io eles são inseridos
 * como objetos com marcadores estáveis (`c4archAssetId`/`c4archAssetKind`),
 * permitindo que uma edição no catálogo seja propagada para todos os modelos
 * que reutilizam o objeto.
 */
export type AssetKind = 'app' | 'service';

export interface AssetLike {
  id: string;
  org_id: string;
  name: string;
  description?: string | null;
  protocol?: string | null;
  port?: number | null;
  metadata?: unknown;
}

export interface AssetModelDependency {
  id: string;
  org_id: string;
  folder_id: string | null;
  title: string;
  description: string | null;
  status: string;
  c4_type: string;
  c4_scope: string | null;
  created_at: string;
  updated_at: string;
  folder_name: string | null;
  occurrences: number;
  via_elements: boolean;
  via_drawio: boolean;
}

export const ASSET_MARKER_ID = 'c4archAssetId';
export const ASSET_MARKER_KIND = 'c4archAssetKind';
export const ASSET_MARKER_NAME = 'c4archAssetName';

const APP_FILL = '#dae8fc';
const SERVICE_FILL = '#d5e8d4';

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function assetKindLabel(kind: AssetKind): string {
  return kind === 'app' ? 'Aplicação' : 'Serviço';
}

export function assetEndpoint(asset: AssetLike): string {
  const protocol = cleanText(asset.protocol) || 'http';
  return `${protocol}${asset.port ? `:${asset.port}` : ''}`;
}

function assetTechnology(asset: AssetLike): string {
  if (!asset.metadata || typeof asset.metadata !== 'object') return '';
  const metadata = asset.metadata as Record<string, unknown>;
  const technology = metadata.technology ?? metadata.tech;
  return cleanText(technology);
}

/**
 * Rótulo C4 exibido no draw.io. Mantém o tipo explícito ([Container: nome]),
 * a natureza do objeto (Aplicação/Serviço + protocolo) e a descrição curta.
 */
export function assetShapeLabel(kind: AssetKind, asset: AssetLike): string {
  const name = cleanText(asset.name) || 'Sem nome';
  const lines = [`<b>[Container: ${escapeHtml(name)}]</b>`];

  if (kind === 'app') {
    lines.push('Aplicação');
  } else {
    lines.push(`Serviço ${escapeHtml(assetEndpoint(asset))}`);
  }

  const technology = escapeHtml(assetTechnology(asset));
  const description = escapeHtml(cleanText(asset.description));
  const detail = [technology, description].filter(Boolean).join(' — ');
  if (detail) lines.push(detail);

  return lines.join('<br>');
}

/**
 * Rótulos usados pela versão anterior da biblioteca (texto simples). Servem de
 * fallback para diagramas criados antes dos marcadores estáveis.
 */
export function legacyAssetLabels(kind: AssetKind, asset: AssetLike): string[] {
  const name = cleanText(asset.name);
  if (!name) return [];

  let detail = '';
  if (kind === 'app') {
    detail = cleanText(asset.description);
  } else {
    const endpoint = assetEndpoint(asset);
    const description = cleanText(asset.description);
    detail = description ? `${endpoint} — ${description}` : endpoint;
  }

  return detail ? [name, `${name}\n${detail}`] : [name];
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeXmlAttribute(value: string, quote: '"' | "'"): string {
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return quote === '"' ? escaped.replace(/"/g, '&quot;') : escaped.replace(/'/g, '&#39;');
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    attributes[match[1]] = decodeXmlEntities(match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function setAttribute(tag: string, name: string, value: string): string {
  const re = new RegExp(`(\\s${name}\\s*=\\s*)("([^"]*)"|'([^']*)')`, 'i');
  if (re.test(tag)) {
    return tag.replace(re, (_match, prefix: string, _quoted: string, double: string, single: string) => {
      const quote: '"' | "'" = double !== undefined ? '"' : "'";
      return `${prefix}${quote}${escapeXmlAttribute(value, quote)}${quote}`;
    });
  }
  return tag.replace(/\s*>$/, ` ${name}="${escapeXmlAttribute(value, '"')}">`);
}

function removeAttribute(tag: string, name: string): string {
  const re = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'gi');
  return tag.replace(re, '');
}

/** Estilos das shapes antigas: ajudam a evitar falsos positivos no fallback. */
function looksLikeLegacyAsset(attributes: Record<string, string>, kind: AssetKind): boolean {
  const fill = kind === 'app' ? APP_FILL : SERVICE_FILL;
  const style = attributes.style ?? '';
  // Objetos da biblioteca têm `label` no wrapper; mxCells antigos tinham a cor.
  return Boolean(attributes.label) || style.toLowerCase().includes(fill.toLowerCase());
}

function assetTagMatches(
  attributes: Record<string, string>,
  kind: AssetKind,
  id: string,
  legacyLabels: Set<string>
): boolean {
  if (
    attributes[ASSET_MARKER_ID] === id &&
    attributes[ASSET_MARKER_KIND] === kind
  ) {
    return true;
  }
  const label = attributes.label ?? attributes.value ?? '';
  return (
    legacyLabels.has(label) &&
    looksLikeLegacyAsset(attributes, kind)
  );
}

/**
 * Atualiza todos os objetos de um app/serviço em um XML do draw.io. Quando o
 * objeto ainda não tem marcador (diagrama antigo), o marcador é adicionado.
 */
export function syncAssetInXml(
  xml: string,
  kind: AssetKind,
  asset: AssetLike,
  previous?: AssetLike
): { xml: string; occurrences: number } {
  if (!xml) return { xml, occurrences: 0 };

  const newLabel = assetShapeLabel(kind, asset);
  const legacyLabels = new Set([
    ...legacyAssetLabels(kind, previous ?? asset),
    ...legacyAssetLabels(kind, asset),
  ]);
  let occurrences = 0;

  const next = xml.replace(
    /<(object|UserObject|mxCell)\b([^>]*)>/gi,
    (tag: string, _tagName: string, rawAttributes: string) => {
      const attributes = parseAttributes(rawAttributes);
      if (!assetTagMatches(attributes, kind, asset.id, legacyLabels)) return tag;

      occurrences += 1;
      let nextTag = tag;
      if (
        attributes[ASSET_MARKER_ID] !== asset.id ||
        attributes[ASSET_MARKER_KIND] !== kind
      ) {
        nextTag = setAttribute(nextTag, ASSET_MARKER_ID, asset.id);
        nextTag = setAttribute(nextTag, ASSET_MARKER_KIND, kind);
      }
      nextTag = setAttribute(nextTag, ASSET_MARKER_NAME, cleanText(asset.name));

      if (attributes.label !== undefined) {
        nextTag = setAttribute(nextTag, 'label', newLabel);
      } else if (attributes.value !== undefined) {
        nextTag = setAttribute(nextTag, 'value', newLabel);
      }
      return nextTag;
    }
  );

  return { xml: next, occurrences };
}

/** Remove os marcadores de um app/serviço excluído, preservando as shapes. */
export function detachAssetInXml(xml: string, kind: AssetKind, id: string): string {
  if (!xml) return xml;
  return xml.replace(
    /<(object|UserObject|mxCell)\b([^>]*)>/gi,
    (tag: string, _tagName: string, rawAttributes: string) => {
      const attributes = parseAttributes(rawAttributes);
      if (
        attributes[ASSET_MARKER_ID] !== id ||
        attributes[ASSET_MARKER_KIND] !== kind
      ) {
        return tag;
      }
      let nextTag = removeAttribute(tag, ASSET_MARKER_ID);
      nextTag = removeAttribute(nextTag, ASSET_MARKER_KIND);
      nextTag = removeAttribute(nextTag, ASSET_MARKER_NAME);
      return nextTag;
    }
  );
}

export function countAssetRefsInXml(
  xml: string,
  kind: AssetKind,
  asset: AssetLike
): number {
  if (!xml) return 0;

  const labels = new Set([
    ...legacyAssetLabels(kind, asset),
    assetShapeLabel(kind, asset),
  ]);
  let count = 0;
  const re = /<(object|UserObject|mxCell)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const attributes = parseAttributes(match[2]);
    if (assetTagMatches(attributes, kind, asset.id, labels)) count += 1;
  }
  return count;
}

async function propagateToDrawio(
  kind: AssetKind,
  asset: AssetLike,
  previous?: AssetLike
): Promise<void> {
  const models = await pool.query<{ id: string; drawio_xml: string | null }>(
    `SELECT id, drawio_xml FROM models
      WHERE org_id = $1 AND drawio_xml IS NOT NULL`,
    [asset.org_id]
  );

  for (const model of models.rows) {
    const current = model.drawio_xml ?? '';
    if (!current) continue;
    const { xml, occurrences } = syncAssetInXml(current, kind, asset, previous);
    if (occurrences === 0 || xml === current) continue;
    await pool.query(
      'UPDATE models SET drawio_xml = $1, updated_at = NOW() WHERE id = $2',
      [xml, model.id]
    );
  }
}

/**
 * Propaga nome/descrição/metadados de um app/serviço para:
 * - `elements` vinculados (app_id/service_id);
 * - `drawio_xml` de todos os modelos da organização que reutilizam a shape.
 */
export async function propagateAssetChange(
  kind: AssetKind,
  asset: AssetLike,
  previous?: AssetLike
): Promise<void> {
  const column = kind === 'app' ? 'app_id' : 'service_id';
  await pool.query(
    `UPDATE elements
        SET title = $1, description = $2, metadata = $3, type = 'container', updated_at = NOW()
      WHERE ${column} = $4`,
    [asset.name, asset.description ?? null, asset.metadata ?? null, asset.id]
  );

  await propagateToDrawio(kind, asset, previous);
}

/** Remove referências persistentes ao app/serviço excluído nos diagramas. */
export async function detachAssetChange(kind: AssetKind, asset: AssetLike): Promise<void> {
  const models = await pool.query<{ id: string; drawio_xml: string | null }>(
    `SELECT id, drawio_xml FROM models
      WHERE org_id = $1 AND drawio_xml IS NOT NULL`,
    [asset.org_id]
  );

  for (const model of models.rows) {
    const current = model.drawio_xml ?? '';
    if (!current || !current.includes(asset.id)) continue;
    const xml = detachAssetInXml(current, kind, asset.id);
    if (xml === current) continue;
    await pool.query(
      'UPDATE models SET drawio_xml = $1, updated_at = NOW() WHERE id = $2',
      [xml, model.id]
    );
  }
}

/** Lista os modelos da organização que contêm o app/serviço. */
export async function listAssetDependencies(
  kind: AssetKind,
  asset: AssetLike
): Promise<AssetModelDependency[]> {
  const column = kind === 'app' ? 'app_id' : 'service_id';

  const [elementRows, modelRows] = await Promise.all([
    pool.query<{ model_id: string; count: number }>(
      `SELECT model_id, COUNT(*)::int AS count
         FROM elements
        WHERE ${column} = $1
        GROUP BY model_id`,
      [asset.id]
    ),
    pool.query<Omit<AssetModelDependency, 'occurrences' | 'via_elements' | 'via_drawio'>>(
      `SELECT m.id, m.org_id, m.folder_id, m.title, m.description, m.status,
              m.c4_type, m.c4_scope, m.created_at, m.updated_at,
              f.name AS folder_name
         FROM models m
         LEFT JOIN folders f ON f.id = m.folder_id
        WHERE m.org_id = $1
        ORDER BY m.updated_at DESC`,
      [asset.org_id]
    ),
  ]);

  const elementsByModel = new Map<string, number>();
  for (const row of elementRows.rows) {
    elementsByModel.set(row.model_id, Number(row.count) || 0);
  }

  // A listagem não devolve o XML (potencialmente grande). A contagem no
  // diagrama é feita em uma consulta separada.
  const xmlRows = await pool.query<{ id: string; drawio_xml: string | null }>(
    `SELECT id, drawio_xml FROM models
      WHERE org_id = $1 AND drawio_xml IS NOT NULL`,
    [asset.org_id]
  );
  const drawioCounts = new Map<string, number>();
  for (const row of xmlRows.rows) {
    const count = countAssetRefsInXml(row.drawio_xml ?? '', kind, asset);
    if (count > 0) drawioCounts.set(row.id, count);
  }

  const dependencies: AssetModelDependency[] = [];
  for (const model of modelRows.rows) {
    const viaElements = elementsByModel.get(model.id) ?? 0;
    const viaDrawioCount = drawioCounts.get(model.id) ?? 0;
    const occurrences = viaElements + viaDrawioCount;
    if (occurrences === 0) continue;
    dependencies.push({
      ...model,
      occurrences,
      via_elements: viaElements > 0,
      via_drawio: viaDrawioCount > 0,
    });
  }

  return dependencies;
}
