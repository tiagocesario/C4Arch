import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import {
  generateDAS,
  loadDasAssets,
  regenerateModelDAS as legacyRegenerateModelDAS,
  type DasAsset,
  type DasEdge,
  type DasElement,
  type DasModel,
} from './das.js';
import { parseDiagrams } from './diagrams.js';
import {
  applyDasOverrides,
  computeContentHash,
  computeDasSourceHash,
  diffDasSections,
  mergeDasOverrides,
  type CanonicalDasOverride,
  type CanonicalElement,
  type CanonicalRelationship,
  type CanonicalView,
} from './canonical.js';

/**
 * DAS gerado a partir do modelo canônico (M3).
 *
 * O template continua sendo o mesmo de `das.ts`; a diferença é a origem dos
 * elementos e relações: tabelas canônicas, não o XML draw.io. O XML permanece
 * apenas nas seções visuais de diagramas. Depois do template aplicamos os
 * overrides por seção e calculamos o `das_source_hash`.
 */

export interface CanonicalDasResult {
  modelId: string;
  /** Template puro, antes dos overrides (base do diff de seções). */
  generated: string;
  /** Documento final com overrides aplicados. */
  content: string;
  overrides: CanonicalDasOverride[];
  modelContentHash: string;
  sourceHash: string;
  overrideCount: number;
}

interface ModelRow {
  id: string;
  org_id: string;
  title: string;
  description: string | null;
  status: string | null;
  c4_type: string | null;
  c4_scope: string | null;
  folder_id: string | null;
  drawio_xml: string | null;
  diagrams: unknown;
  das_content: string | null;
  das_source_hash: string | null;
}

function legacyTypeOf(element: CanonicalElement): string {
  const properties = element.properties ?? {};
  const legacy = properties.legacyType;
  return typeof legacy === 'string' && legacy ? legacy : element.kind;
}

function toDasElement(element: CanonicalElement): DasElement {
  return {
    id: element.id,
    type: legacyTypeOf(element),
    title: element.name,
    description: element.description ?? null,
    app_id: element.app_id ?? null,
    service_id: element.service_id ?? null,
  };
}

function toDasEdge(relationship: CanonicalRelationship): DasEdge {
  const properties = relationship.properties ?? {};
  const legacy = properties.legacyType;
  return {
    id: relationship.id,
    from_id: relationship.source_id,
    to_id: relationship.target_id,
    label: relationship.description ?? '',
    type: relationship.technology ?? (typeof legacy === 'string' ? legacy : ''),
  };
}

async function query<T>(
  client: PoolClient | typeof pool,
  text: string,
  values: unknown[]
): Promise<T[]> {
  const result = await client.query(text, values);
  return result.rows as T[];
}

/**
 * Carrega o modelo + estado canônico e produz o DAS final. Não escreve nada:
 * serve tanto para a geração normal quanto para a comparação em sombra.
 */
export async function generateCanonicalDas(
  modelId: string,
  client: PoolClient | typeof pool = pool
): Promise<CanonicalDasResult | null> {
  const models = await query<ModelRow>(client, 'SELECT * FROM models WHERE id = $1', [modelId]);
  const model = models[0];
  if (!model) return null;

  const elements = await query<CanonicalElement>(
    client,
    'SELECT * FROM model_elements WHERE model_id = $1 ORDER BY name',
    [modelId]
  );
  const relationships = await query<CanonicalRelationship>(
    client,
    'SELECT * FROM model_relationships WHERE model_id = $1 ORDER BY created_at',
    [modelId]
  );
  const views = await query<CanonicalView>(
    client,
    'SELECT * FROM model_views WHERE model_id = $1 ORDER BY key',
    [modelId]
  );
  const overrides = await query<CanonicalDasOverride>(
    client,
    `SELECT section_key, content, mode
       FROM model_das_overrides
      WHERE model_id = $1
      ORDER BY section_key`,
    [modelId]
  );
  const folder = model.folder_id
    ? await query<{ name: string }>(client, 'SELECT name FROM folders WHERE id = $1', [
        model.folder_id,
      ])
    : [];

  const assets: Map<string, DasAsset> = await loadDasAssets(model.org_id);

  const dasModel: DasModel = {
    id: model.id,
    title: model.title,
    description: model.description,
    status: model.status ?? undefined,
    c4_type: model.c4_type ?? undefined,
    c4_scope: model.c4_scope,
    folder_id: model.folder_id,
    org_id: model.org_id,
  };

  const generated = generateDAS(
    dasModel,
    elements.map(toDasElement),
    relationships.map(toDasEdge),
    folder[0]?.name ?? null,
    model.drawio_xml,
    parseDiagrams(model.diagrams),
    assets,
    { aggregateXml: false }
  );

  const content = applyDasOverrides(generated, overrides);
  const modelContentHash = computeContentHash({
    model: {
      id: model.id,
      title: model.title,
      description: model.description,
      c4_type: model.c4_type,
      c4_scope: model.c4_scope,
    },
    elements,
    relationships,
    views,
  });

  return {
    modelId,
    generated,
    content,
    overrides,
    modelContentHash,
    sourceHash: computeDasSourceHash(modelContentHash, overrides),
    overrideCount: overrides.length,
  };
}

/**
 * Regenera e grava o DAS canônico. Se o `das_source_hash` não mudou e já existe
 * conteúdo, a escrita é evitada (idempotência). Retorna `null` se o modelo não
 * existir.
 */
export async function writeCanonicalDas(
  modelId: string,
  options: { force?: boolean } = {}
): Promise<{ content: string; changed: boolean; sourceHash: string } | null> {
  // Fallback do plano (§8): se o modelo ainda não foi migrado, o canônico está
  // vazio. Nesse caso gera pelo caminho legado (elements/edges + XML) em vez de
  // sobrescrever o DAS existente com um documento sem elementos.
  const canonical = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM model_elements WHERE model_id = $1',
    [modelId]
  );
  if (Number(canonical.rows[0]?.count ?? 0) === 0) {
    const current = await pool.query<{
      das_content: string | null;
      das_source_hash: string | null;
    }>('SELECT das_content, das_source_hash FROM models WHERE id = $1', [modelId]);
    if (current.rows.length === 0) return null;
    const legacy = await legacyRegenerateModelDAS(modelId);
    if (legacy === null) return null;
    return {
      content: legacy,
      changed: legacy !== current.rows[0].das_content,
      sourceHash: current.rows[0].das_source_hash ?? '',
    };
  }

  const generated = await generateCanonicalDas(modelId);
  if (!generated) return null;

  const current = await pool.query<{
    das_content: string | null;
    das_source_hash: string | null;
  }>('SELECT das_content, das_source_hash FROM models WHERE id = $1', [modelId]);
  const row = current.rows[0];
  const unchanged =
    !options.force &&
    row?.das_source_hash === generated.sourceHash &&
    Boolean(row?.das_content?.trim());

  if (unchanged) {
    return { content: generated.content, changed: false, sourceHash: generated.sourceHash };
  }

  await pool.query(
    `UPDATE models
        SET das_content = $1,
            das_generated_at = NOW(),
            das_source_hash = $2,
            das_override_count = $3
      WHERE id = $4`,
    [generated.content, generated.sourceHash, generated.overrideCount, modelId]
  );

  return { content: generated.content, changed: true, sourceHash: generated.sourceHash };
}

/**
 * Converte o DAS editado em overrides por seção e grava o documento. Usado pelo
 * `PUT /das` quando `DAS_OVERRIDES` está ligado.
 */
export async function saveDasOverrides(
  modelId: string,
  content: string,
  userId: string | null
): Promise<{ changedKeys: string[]; sourceHash: string; overrideCount: number } | null> {
  const generated = await generateCanonicalDas(modelId);
  if (!generated) return null;

  const diff = diffDasSections(generated.generated, content);

  // O diff é calculado contra o template puro, então overrides `hide` e
  // `append` que já existiam precisam ser preservados: seções ocultas não
  // aparecem no conteúdo salvo (e não gerariam diff), e o texto anexado seria
  // reinterpretado como `replace`.
  const overrides = mergeDasOverrides(
    generated.generated,
    content,
    generated.overrides,
    diff
  );

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM model_das_overrides WHERE model_id = $1', [modelId]);
    for (const override of overrides) {
      await client.query(
        `INSERT INTO model_das_overrides (model_id, section_key, content, mode, updated_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [modelId, override.section_key, override.content, override.mode, userId]
      );
    }

    const sourceHash = computeDasSourceHash(generated.modelContentHash, overrides);
    await client.query(
      `UPDATE models
          SET das_content = $1,
              das_generated_at = NOW(),
              das_source_hash = $2,
              das_override_count = $3
        WHERE id = $4`,
      [content, sourceHash, overrides.length, modelId]
    );
    await client.query('COMMIT');

    return {
      changedKeys: overrides.map((override) => override.section_key),
      sourceHash,
      overrideCount: overrides.length,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
