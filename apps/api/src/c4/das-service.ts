import { pool } from '../db.js';
import { flags } from '../flags.js';
import {
  regenerateAllDAS as legacyRegenerateAllDAS,
  regenerateModelDAS as legacyRegenerateModelDAS,
} from './das.js';
import { generateCanonicalDas, writeCanonicalDas } from './das-canonical.js';

/**
 * Dispatch do DAS pela flag `DAS_OVERRIDES`.
 *
 * - `off`: caminho legado (`elements`/`edges` + XML), sem overrides;
 * - `shadow`: gera o DAS canônico, compara com o conteúdo atual e registra a
 *   divergência, mas continua devolvendo/gravando o legado;
 * - `on`: gera do canônico, aplica overrides e grava metadados
 *   (`das_generated_at`, `das_source_hash`, `das_override_count`).
 *
 * Os controllers e o startup importam daqui, mantendo a API estável.
 */

async function shadowCompare(modelId: string, legacyContent: string | null): Promise<void> {
  try {
    const canonical = await generateCanonicalDas(modelId);
    if (!canonical) return;

    const legacy = (legacyContent ?? '').replace(/\r\n/g, '\n').trim();
    const expected = canonical.content.replace(/\r\n/g, '\n').trim();
    if (legacy === expected) {
      console.log(`[das] sombra modelo ${modelId}: ok`);
      return;
    }

    console.warn(
      `[das] sombra modelo ${modelId}: divergência ` +
        `(legado=${legacy.length}B canônico=${expected.length}B)`
    );
  } catch (err) {
    console.error(`[das] sombra modelo ${modelId}: falha ao gerar canônico`, err);
  }
}

export async function regenerateModelDAS(modelId: string): Promise<string | null> {
  if (flags.dasOverrides === 'off') {
    return legacyRegenerateModelDAS(modelId);
  }

  if (flags.dasOverrides === 'shadow') {
    const legacy = await legacyRegenerateModelDAS(modelId);
    await shadowCompare(modelId, legacy);
    return legacy;
  }

  const result = await writeCanonicalDas(modelId);
  return result?.content ?? null;
}

export async function regenerateAllDAS(): Promise<number> {
  if (flags.dasOverrides === 'off') {
    return legacyRegenerateAllDAS();
  }

  const rows = await pool.query<{ id: string; das_content: string | null }>(
    'SELECT id, das_content FROM models'
  );

  let changed = 0;
  for (const row of rows.rows) {
    try {
      if (flags.dasOverrides === 'shadow') {
        const legacy = await legacyRegenerateModelDAS(row.id);
        await shadowCompare(row.id, legacy);
        if (legacy !== null && legacy !== row.das_content) changed += 1;
        continue;
      }

      const result = await writeCanonicalDas(row.id);
      if (result?.changed) changed += 1;
    } catch (err) {
      console.error(`[das] falha ao regenerar modelo ${row.id}`, err);
    }
  }
  return changed;
}

export { saveDasOverrides } from './das-canonical.js';
