import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { flags } from '../flags.js';
import { parseDrawio } from './das.js';
import { canonicalModelHasData } from './canonical-access.js';
import { regenerateModelDAS } from './das-service.js';

const KIND_MAP: Record<string, string> = {
  person: 'person',
  Pessoa: 'person',
  Person: 'person',
  'Software System': 'software_system',
  Sistema: 'software_system',
  Container: 'container',
  Component: 'component',
  Componente: 'component',
};

function toKind(c4Kind: string): string {
  return KIND_MAP[c4Kind] ?? KIND_MAP[c4Kind.trim()] ?? 'component';
}

function toLegacyType(kind: string): string {
  switch (kind) {
    case 'person':
      return 'actor';
    case 'software_system':
      return 'system';
    case 'container':
      return 'container';
    default:
      return 'component';
  }
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/**
 * Sincroniza o modelo canônico/legado a partir do XML draw.io recém-salvo.
 *
 * Garante que componentes inseridos/editados no draw.io se reflitam no modelo,
 * de modo que a exportação C4-PlantUML (e o DAS) sejam atualizados
 * automaticamente. A sincronização é best-effort e idempotente: elementos são
 * casados por (nome, kind); relações por (origem, destino).
 */
export async function syncModelFromDrawio(modelId: string, xml: string): Promise<void> {
  const parsed = parseDrawio(xml);
  if (parsed.elements.length === 0) return;

  const syncCanonical = flags.canonicalModel !== 'off' || (await canonicalModelHasData(modelId));

  // Mapa nome -> id canônico existente.
  const existing = syncCanonical
    ? await pool.query<{ id: string; name: string; kind: string }>(
        'SELECT id, name, kind FROM model_elements WHERE model_id = $1',
        [modelId]
      )
    : { rows: [] as { id: string; name: string; kind: string }[] };

  const byNameKind = new Map(existing.rows.map((row) => [`${row.name}::${row.kind}`, row.id]));

  const legacyExisting = await pool.query<{ id: string; title: string; type: string }>(
    'SELECT id, title, type FROM elements WHERE model_id = $1',
    [modelId]
  );
  const legacyByNameType = new Map(legacyExisting.rows.map((row) => [`${row.title}::${row.type}`, row.id]));

  const nameToCanonicalId = new Map<string, string>();

  for (const el of parsed.elements) {
    const kind = toKind(el.c4Kind);
    const key = `${el.name}::${kind}`;
    let canonicalId = byNameKind.get(key);
    const technology = el.technology?.trim() || null;
    const description = el.description?.trim() || null;

    if (syncCanonical) {
      if (!canonicalId) {
        canonicalId = randomUUID();
        const identifier = slugify(el.name) || `element_${canonicalId.slice(0, 8)}`;
        let uniqueIdentifier = identifier;
        let suffix = 2;
        while (
          (await pool.query('SELECT 1 FROM model_elements WHERE model_id=$1 AND identifier=$2', [modelId, uniqueIdentifier])).rows.length > 0
        ) {
          uniqueIdentifier = `${identifier}_${suffix++}`;
        }

        await pool.query(
          `INSERT INTO model_elements
             (id, model_id, identifier, kind, name, description, technology, tags, properties)
           VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::text[], '{}'::jsonb)`,
          [canonicalId, modelId, uniqueIdentifier, kind, el.name, description, technology]
        );

        byNameKind.set(key, canonicalId);
        existing.rows.push({ id: canonicalId, name: el.name, kind });
      } else {
        await pool.query(
          `UPDATE model_elements
              SET name = $1, kind = $2, description = $3, technology = $4, updated_at = NOW()
            WHERE id = $5 AND model_id = $6`,
          [el.name, kind, description, technology, canonicalId, modelId]
        );
      }
    } else if (!canonicalId) {
      // Sem canônico: usa um id determinístico por nome para o legado.
      canonicalId = randomUUID();
    }

    nameToCanonicalId.set(el.name, canonicalId);

    // Legado
    const legacyType = toLegacyType(kind);
    const legacyKey = `${el.name}::${legacyType}`;
    if (!legacyByNameType.has(legacyKey)) {
      const legacyId = canonicalId;
      await pool.query(
        `INSERT INTO elements (id, model_id, type, title, description, position_x, position_y, "order")
         VALUES ($1, $2, $3, $4, $5, 0, 0, 0)
         ON CONFLICT (id) DO NOTHING`,
        [legacyId, modelId, legacyType, el.name, description ?? '']
      );
      legacyByNameType.set(legacyKey, legacyId);
    } else {
      await pool.query(
        `UPDATE elements
            SET title = $1, type = $2, description = $3
          WHERE id = $4 AND model_id = $5`,
        [el.name, legacyType, description ?? '', legacyByNameType.get(legacyKey), modelId]
      );
    }
  }

  if (syncCanonical) {
    const existingEdges = await pool.query<{ id: string; source_id: string; target_id: string }>(
      'SELECT id, source_id, target_id FROM model_relationships WHERE model_id = $1',
      [modelId]
    );
    const edgeByKey = new Map(existingEdges.rows.map((row) => [`${row.source_id}::${row.target_id}`, row.id]));

    for (const edge of parsed.edges) {
      const sourceId = nameToCanonicalId.get(edge.source);
      const targetId = nameToCanonicalId.get(edge.target);
      if (!sourceId || !targetId) continue;

      const key = `${sourceId}::${targetId}`;
      const technology = edge.technology?.trim() || null;
      const description = edge.label?.trim() || null;

      if (edgeByKey.has(key)) {
        const edgeId = edgeByKey.get(key)!;
        await pool.query(
          `UPDATE model_relationships
              SET description = $1, technology = $2, updated_at = NOW()
            WHERE id = $3`,
          [description, technology, edgeId]
        );
      } else {
        const edgeId = randomUUID();
        await pool.query(
          `INSERT INTO model_relationships (id, model_id, source_id, target_id, description, technology, tags, properties)
           VALUES ($1, $2, $3, $4, $5, $6, '{}'::text[], '{}'::jsonb)`,
          [edgeId, modelId, sourceId, targetId, description, technology]
        );
        edgeByKey.set(key, edgeId);
      }
    }
  }

  // Invalida estado colaborativo e regenera DAS.
  try {
    await pool.query('DELETE FROM model_state WHERE model_id = $1', [modelId]);
  } catch (e) {
    console.error('[drawio-sync] invalidate state error', e);
  }
  try {
    await regenerateModelDAS(modelId);
  } catch (e) {
    console.error('[drawio-sync] das regen error', e);
  }
}
