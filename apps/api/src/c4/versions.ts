import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { flags } from '../flags.js';
import {
  applyCanonicalSnapshot,
  buildCanonicalSnapshot,
  type BuildSnapshotInput,
} from './backfill.js';
import type { LegacyModelRow } from './canonical.js';
import {
  computeStateContentHash,
  encodeModelState,
  stateVectorOf,
  type DecodedState,
  type StateEdge,
  type StateElement,
} from './state.js';

/**
 * Versões por conteúdo e restauração (M3).
 *
 * O worker cria versões `auto` por hash; aqui ficam listagem, detalhe e o
 * restore. O snapshot lógico é o mesmo JSON produzido pelo realtime
 * (`{ modelId, elements, edges }`), o que mantém compatibilidade com o worker
 * legado e com os arquivos de snapshot já existentes.
 */

export interface VersionRow {
  id: string;
  model_id: string;
  version: number;
  content_hash: string | null;
  label: string | null;
  description: string | null;
  kind: 'auto' | 'manual' | 'restore' | 'import';
  author_id: string | null;
  author_email: string | null;
  created_at: string;
  size_bytes: number | null;
}

export interface VersionDetail extends VersionRow {
  snapshot: unknown;
}

const LEGACY_ELEMENT_TYPES = new Set(['actor', 'system', 'container', 'component']);
const LEGACY_EDGE_TYPES = new Set(['call', 'http', 'message', 'depends']);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeSnapshot(snapshot: unknown, modelId: string): DecodedState {
  const record = asRecord(snapshot);
  const rawElements = Array.isArray(record.elements)
    ? record.elements
    : Object.entries(asRecord(record.elements)).map(([id, element]) => ({
        ...asRecord(element),
        id,
      }));

  const elements: StateElement[] = [];
  for (const raw of rawElements) {
    const element = asRecord(raw);
    const id = asText(element.id);
    if (!id) continue;
    const type = asText(element.type, 'system');
    elements.push({
      id,
      type: LEGACY_ELEMENT_TYPES.has(type) ? type : 'system',
      title: asText(element.title),
      description: typeof element.description === 'string' ? element.description : null,
      metadata: element.metadata ?? null,
      position_x: asNumber(element.positionX ?? element.position_x),
      position_y: asNumber(element.positionY ?? element.position_y),
      order: asNumber(element.order),
    });
  }

  const edges: StateEdge[] = [];
  const rawEdges = Array.isArray(record.edges) ? record.edges : [];
  for (const raw of rawEdges) {
    const edge = asRecord(raw);
    const from = asText(edge.fromId ?? edge.from_id);
    const to = asText(edge.toId ?? edge.to_id);
    if (!from || !to) continue;
    const type = asText(edge.type, 'call');
    edges.push({
      id: asText(edge.id, `${from}->${to}`),
      from_id: from,
      to_id: to,
      label: asText(edge.label),
      type: LEGACY_EDGE_TYPES.has(type) ? type : 'call',
    });
  }

  // O snapshot do worker pode conter modelo diferente por engano; o parâmetro
  // garante que a restauração fique no modelo da rota.
  void modelId;
  return { elements, edges };
}

export async function listVersions(modelId: string, limit = 100): Promise<VersionRow[]> {
  const result = await pool.query<VersionRow>(
    `SELECT v.id, v.model_id, v.version, v.content_hash, v.label, v.description,
            v.kind, v.author_id, u.email AS author_email, v.created_at,
            octet_length(v.snapshot::text) AS size_bytes
       FROM model_versions v
       LEFT JOIN users u ON u.id = COALESCE(v.author_id, v.created_by)
      WHERE v.model_id = $1
      ORDER BY v.version DESC
      LIMIT $2`,
    [modelId, Math.max(1, Math.min(500, limit))]
  );
  return result.rows;
}

export async function getVersion(
  modelId: string,
  versionId: string
): Promise<VersionDetail | null> {
  const result = await pool.query<VersionDetail>(
    `SELECT v.id, v.model_id, v.version, v.content_hash, v.label, v.description,
            v.kind, v.author_id, u.email AS author_email, v.created_at,
            octet_length(v.snapshot::text) AS size_bytes, v.snapshot
       FROM model_versions v
       LEFT JOIN users u ON u.id = COALESCE(v.author_id, v.created_by)
      WHERE v.model_id = $1 AND v.id = $2`,
    [modelId, versionId]
  );
  return result.rows[0] ?? null;
}

async function nextVersion(client: PoolClient, modelId: string): Promise<number> {
  // O contador é a fonte normal, mas versões podem ter sido inseridas
  // diretamente (importações, fixtures, migrações antigas). Semeie/alinhe com
  // o maior `version` existente para não violar o índice único
  // `(model_id, version)`, nem reaproveitar números já usados.
  await client.query(
    `INSERT INTO model_version_counters(model_id, version)
     SELECT $1, COALESCE(MAX(version), 0)
       FROM model_versions
      WHERE model_id = $1
     ON CONFLICT (model_id) DO UPDATE
       SET version = GREATEST(model_version_counters.version, EXCLUDED.version)`,
    [modelId]
  );
  const result = await client.query<{ version: number }>(
    `UPDATE model_version_counters
        SET version = version + 1
      WHERE model_id = $1
      RETURNING version`,
    [modelId]
  );
  return result.rows[0].version;
}

async function restoreLegacy(
  client: PoolClient,
  modelId: string,
  decoded: DecodedState
): Promise<void> {
  await client.query('DELETE FROM edges WHERE model_id = $1', [modelId]);
  await client.query('DELETE FROM elements WHERE model_id = $1', [modelId]);

  for (const element of decoded.elements) {
    await client.query(
      `INSERT INTO elements
         (id, model_id, type, title, description, metadata, position_x, position_y, "order")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [
        element.id,
        modelId,
        element.type,
        element.title,
        element.description,
        element.metadata === null ? null : JSON.stringify(element.metadata),
        Math.round(element.position_x),
        Math.round(element.position_y),
        Math.round(element.order),
      ]
    );
  }

  for (const edge of decoded.edges) {
    if (!decoded.elements.some((element) => element.id === edge.from_id)) continue;
    if (!decoded.elements.some((element) => element.id === edge.to_id)) continue;
    await client.query(
      `INSERT INTO edges (id, model_id, from_id, to_id, label, type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [edge.id, modelId, edge.from_id, edge.to_id, edge.label, edge.type]
    );
  }
}

async function restoreCanonical(
  client: PoolClient,
  modelId: string,
  decoded: DecodedState
): Promise<void> {
  const modelResult = await client.query<LegacyModelRow>('SELECT * FROM models WHERE id = $1', [
    modelId,
  ]);
  const model = modelResult.rows[0];
  if (!model) return;

  const input: BuildSnapshotInput = {
    model: { ...model, drawio_xml: null, das_content: null },
    elements: decoded.elements.map((element) => ({ ...element, model_id: modelId })),
    edges: decoded.edges.map((edge) => ({ ...edge, model_id: modelId })),
    versions: [],
    layoutFromXml: false,
  };
  const snapshot = buildCanonicalSnapshot(input);
  await applyCanonicalSnapshot(client, snapshot, { prune: true });
}

/**
 * Restaura uma versão no estado durável, no legado e (quando a flag canônica
 * estiver ativa) no canônico. Sempre grava uma nova versão `restore`.
 */
export async function restoreVersion(
  modelId: string,
  versionId: string,
  userId: string | null
): Promise<{ version: number; contentHash: string; versionId: string } | null> {
  const version = await getVersion(modelId, versionId);
  if (!version) return null;

  const decoded = normalizeSnapshot(version.snapshot, modelId);
  const state = encodeModelState(decoded);
  const contentHash = computeStateContentHash(decoded);
  const stateVector = stateVectorOf(state);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await restoreLegacy(client, modelId, decoded);

    if (flags.canonicalModel !== 'off' || flags.projectorShadow !== 'off') {
      await restoreCanonical(client, modelId, decoded);
    }

    await client.query(
      `INSERT INTO model_state (model_id, state, state_vector, content_hash, revision, updated_by)
       VALUES ($1, $2, $3, $4, 1, $5)
       ON CONFLICT (model_id) DO UPDATE SET
         state = EXCLUDED.state,
         state_vector = EXCLUDED.state_vector,
         content_hash = EXCLUDED.content_hash,
         revision = model_state.revision + 1,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by`,
      [modelId, Buffer.from(state), Buffer.from(stateVector), contentHash, userId]
    );

    const snapshot = {
      modelId,
      elements: decoded.elements.map((element) => ({
        id: element.id,
        type: element.type,
        title: element.title,
        description: element.description,
        metadata: element.metadata,
        positionX: element.position_x,
        positionY: element.position_y,
        order: element.order,
      })),
      edges: decoded.edges.map((edge) => ({
        id: edge.id,
        fromId: edge.from_id,
        toId: edge.to_id,
        label: edge.label,
        type: edge.type,
      })),
    };

    // Versões só representam mudanças de conteúdo. Se o hash restaurado já
    // existe, reutilizamos a versão em vez de consumir um número do contador
    // (o que abriria buracos na sequência sem versão correspondente).
    const existing = await client.query<{ id: string; version: number }>(
      'SELECT id, version FROM model_versions WHERE model_id = $1 AND content_hash = $2',
      [modelId, contentHash]
    );

    let assignedVersion: number;
    let newVersionId: string;
    if (existing.rows[0]) {
      assignedVersion = existing.rows[0].version;
      newVersionId = existing.rows[0].id;
    } else {
      assignedVersion = await nextVersion(client, modelId);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO model_versions
           (model_id, version, snapshot, content_hash, author_id, label, description, kind)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, 'restore')
         ON CONFLICT (model_id, content_hash) WHERE content_hash IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          modelId,
          assignedVersion,
          JSON.stringify(snapshot),
          contentHash,
          userId,
          `Restauração da versão ${version.version}`,
          `Restaurado por ${userId ?? 'sistema'} em ${new Date().toISOString()}`,
        ]
      );
      newVersionId = inserted.rows[0]?.id ?? version.id;

      if (!inserted.rows[0]) {
        // Corrida com outro escritor: o hash passou a existir entre a leitura
        // e o INSERT. Reporta a versão realmente gravada.
        const raced = await client.query<{ id: string; version: number }>(
          'SELECT id, version FROM model_versions WHERE model_id = $1 AND content_hash = $2',
          [modelId, contentHash]
        );
        assignedVersion = raced.rows[0]?.version ?? assignedVersion;
        newVersionId = raced.rows[0]?.id ?? newVersionId;
      }
    }

    await client.query('COMMIT');
    return { version: assignedVersion, contentHash, versionId: newVersionId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
