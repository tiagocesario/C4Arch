import { pool } from '../db.js';
import { parseDrawio, type DasAsset, type ParsedElement } from './das.js';
import { parseDiagrams } from './diagrams.js';

export type CatalogAssetKind = 'app' | 'service';

/** Item do catálogo que será criado a partir de um diagrama importado. */
export interface CatalogCandidate {
  name: string;
  kind: CatalogAssetKind;
  description: string | null;
  technology: string | null;
}

export interface CatalogImportSummary {
  candidates: number;
  created: { apps: number; services: number };
  skipped: number;
}

const MAX_NAME_LENGTH = 120;

// Nomes genéricos usados pelos templates draw.io (não são componentes reais).
const PLACEHOLDER_NAMES = new Set([
  'container name',
  'system name',
  'component name',
  'element name',
  'nome do container',
  'nome do sistema',
  'nome do componente',
  'nome do elemento',
]);

// Elementos de agrupamento e atores não são apps/serviços do catálogo.
const IGNORED_KIND_RE = /(boundary|scope|person|actor|ator|legenda|legend)/i;

// Tipos explicitamente ligados a serviços. O restante (sistemas, containers,
// componentes, aplicações) entra no catálogo de apps.
const SERVICE_KIND_RE =
  /^(service|serviço|servico|microservice|microsserviço|microsservico|api|endpoint|webhook|worker|job|queue|fila|broker|pub\/sub|publisher|subscriber|topic|tópico|topico)$/i;

function cleanName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function technologyFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const record = metadata as Record<string, unknown>;
  const value = record.technology ?? record.tech;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Decide em qual catálogo o elemento deve entrar.
 *
 * Prioridade: marcador `c4archAssetKind` do draw.io, natureza declarada no
 * rótulo ("Aplicação"/"Serviço"), tipo C4 explícito de serviço e, por fim,
 * apps. Retorna `null` para atores, boundaries e nomes não resolvidos.
 */
export function classifyCatalogElement(element: ParsedElement): CatalogAssetKind | null {
  const name = element.name?.trim();
  if (!name) return null;
  if (/%c4[A-Za-z]+%/.test(name)) return null;
  // Rótulo não resolvido, por exemplo "[Software System]".
  if (/^\[[^\]]+\]$/.test(name)) return null;
  if (PLACEHOLDER_NAMES.has(name.replace(/\s+/g, ' ').trim().toLowerCase())) return null;

  const marker = (element.assetKind ?? '').trim().toLowerCase();
  if (marker === 'app' || marker === 'service') return marker;
  if (element.nature === 'app' || element.nature === 'service') return element.nature;

  const kind = (element.c4Kind ?? '').trim();
  if (!kind) return null;
  // Rótulos genéricos, textos e arestas sem tipo C4 não são componentes.
  if (/^elemento$/i.test(kind)) return null;
  if (IGNORED_KIND_RE.test(kind)) return null;
  if (SERVICE_KIND_RE.test(kind)) return 'service';
  return 'app';
}

/**
 * Converte os elementos extraídos do XML em itens únicos do catálogo. A
 * deduplicação é feita pelo nome normalizado dentro do próprio arquivo;
 * `knownAssetIds` evita recriar itens que já estão vinculados ao catálogo.
 */
export function collectCatalogCandidates(
  elements: ParsedElement[],
  knownAssetIds: Set<string> = new Set()
): CatalogCandidate[] {
  const byName = new Map<string, CatalogCandidate>();

  for (const element of elements) {
    if (element.assetId && knownAssetIds.has(element.assetId)) continue;

    const kind = classifyCatalogElement(element);
    if (!kind) continue;

    const name = cleanName(element.name ?? '');
    if (!name) continue;

    const key = normalizeName(name);
    const description = element.description?.trim() || null;
    const technology = element.technology?.trim() || null;
    const existing = byName.get(key);

    if (existing) {
      // O mesmo elemento aparece em vários diagramas; completa os campos que
      // estiverem vazios no primeiro registro encontrado.
      if (!existing.description && description) existing.description = description;
      if (!existing.technology && technology) existing.technology = technology;
      continue;
    }

    byName.set(key, { name, kind, description, technology });
  }

  return [...byName.values()];
}

interface KnownAssets {
  map: Map<string, DasAsset>;
  ids: Set<string>;
  names: Set<string>;
}

async function loadKnownAssets(orgId: string): Promise<KnownAssets> {
  const [apps, services] = await Promise.all([
    pool.query('SELECT id, name, description, metadata FROM apps WHERE org_id = $1', [orgId]),
    pool.query(
      'SELECT id, name, description, protocol, port, metadata FROM services WHERE org_id = $1',
      [orgId]
    ),
  ]);

  const map = new Map<string, DasAsset>();
  const names = new Set<string>();

  for (const app of apps.rows as {
    id: string;
    name: string;
    description: string | null;
    metadata: unknown;
  }[]) {
    map.set(app.id, {
      id: app.id,
      kind: 'app',
      name: app.name,
      description: app.description,
      technology: technologyFromMetadata(app.metadata),
    });
    names.add(normalizeName(app.name));
  }

  for (const service of services.rows as {
    id: string;
    name: string;
    description: string | null;
    protocol: string | null;
    port: number | null;
    metadata: unknown;
  }[]) {
    const endpoint = `${service.protocol ?? 'http'}${service.port ? `:${service.port}` : ''}`;
    const technology = [technologyFromMetadata(service.metadata), endpoint]
      .filter(Boolean)
      .join(' · ');
    map.set(service.id, {
      id: service.id,
      kind: 'service',
      name: service.name,
      description: service.description,
      technology,
    });
    names.add(normalizeName(service.name));
  }

  return { map, ids: new Set(map.keys()), names };
}

/**
 * Extrai os componentes de um ou mais documentos draw.io e cadastra os que
 * ainda não existem em `apps` (kind = 'app') ou `services`. É idempotente:
 * reimportar o mesmo arquivo não cria duplicatas, e nomes já presentes em
 * qualquer um dos dois catálogos são preservados.
 */
async function importCatalogDocuments(
  orgId: string,
  documents: string[]
): Promise<CatalogImportSummary> {
  const known = await loadKnownAssets(orgId);
  const elements: ParsedElement[] = [];
  for (const document of documents) {
    if (!document || !document.trim()) continue;
    elements.push(...parseDrawio(document, known.map).elements);
  }
  const candidates = collectCatalogCandidates(elements, known.ids);

  const summary: CatalogImportSummary = {
    candidates: candidates.length,
    created: { apps: 0, services: 0 },
    skipped: 0,
  };
  if (candidates.length === 0) return summary;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializa importações concorrentes da mesma organização para que duas
    // requisições não criem o mesmo item ao mesmo tempo.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`catalog:${orgId}`]);

    const [appRows, serviceRows] = await Promise.all([
      client.query('SELECT name FROM apps WHERE org_id = $1', [orgId]),
      client.query('SELECT name FROM services WHERE org_id = $1', [orgId]),
    ]);
    const existingNames = new Set<string>();
    for (const row of [...appRows.rows, ...serviceRows.rows] as { name: string }[]) {
      existingNames.add(normalizeName(row.name));
    }

    for (const candidate of candidates) {
      const key = normalizeName(candidate.name);
      if (existingNames.has(key)) {
        summary.skipped += 1;
        continue;
      }

      const metadata = candidate.technology ? { technology: candidate.technology } : null;

      if (candidate.kind === 'app') {
        const inserted = await client.query(
          `INSERT INTO apps (org_id, name, description, kind, metadata)
           VALUES ($1, $2, $3, 'app', $4)
           ON CONFLICT (org_id, name) DO NOTHING
           RETURNING id`,
          [orgId, candidate.name, candidate.description, metadata]
        );
        if (inserted.rowCount) {
          summary.created.apps += 1;
          existingNames.add(key);
        } else {
          summary.skipped += 1;
        }
      } else {
        const inserted = await client.query(
          `INSERT INTO services (org_id, name, description, protocol, port, metadata)
           SELECT $1, $2, $3, 'http', NULL, $4
            WHERE NOT EXISTS (
              SELECT 1 FROM services WHERE org_id = $1 AND name = $2
            )
           RETURNING id`,
          [orgId, candidate.name, candidate.description, metadata]
        );
        if (inserted.rowCount) {
          summary.created.services += 1;
          existingNames.add(key);
        } else {
          summary.skipped += 1;
        }
      }
    }

    await client.query('COMMIT');
    return summary;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Importa os componentes de um único XML de modelo. */
export async function importCatalogAssets(
  orgId: string,
  xml: string
): Promise<CatalogImportSummary> {
  return importCatalogDocuments(orgId, [xml]);
}

export interface CatalogBackfillSummary {
  organizations: number;
  models: number;
  created: { apps: number; services: number };
  skipped: number;
}

/**
 * Popula o catálogo a partir dos modelos já existentes. Roda no startup para
 * que modelos importados antes da criação do catálogo automático também
 * apareçam em Apps/Serviços. A operação é idempotente.
 */
export async function backfillCatalogFromModels(): Promise<CatalogBackfillSummary> {
  const rows = await pool.query(
    'SELECT org_id, drawio_xml, diagrams FROM models ORDER BY created_at ASC'
  );
  const documentsByOrg = new Map<string, string[]>();

  for (const row of rows.rows as {
    org_id: string;
    drawio_xml: string | null;
    diagrams: unknown;
  }[]) {
    const documents: string[] = [];
    if (row.drawio_xml && row.drawio_xml.trim()) documents.push(row.drawio_xml);
    for (const diagram of parseDiagrams(row.diagrams)) {
      if (diagram.drawioXml && diagram.drawioXml.trim()) documents.push(diagram.drawioXml);
    }
    if (documents.length === 0) continue;
    const current = documentsByOrg.get(row.org_id) ?? [];
    current.push(...documents);
    documentsByOrg.set(row.org_id, current);
  }

  const summary: CatalogBackfillSummary = {
    organizations: documentsByOrg.size,
    models: rows.rows.length,
    created: { apps: 0, services: 0 },
    skipped: 0,
  };

  for (const [orgId, documents] of documentsByOrg) {
    const result = await importCatalogDocuments(orgId, documents);
    summary.created.apps += result.created.apps;
    summary.created.services += result.created.services;
    summary.skipped += result.skipped;
  }

  return summary;
}
