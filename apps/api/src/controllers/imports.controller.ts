import type { Response } from 'express';
import { pool } from '../db.js';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import { getModelAccess, getOrgRole, isWriterRole } from '../auth/access.js';
import { recordAudit } from '../c4/audit.js';
import { regenerateModelDAS } from '../c4/das-service.js';
import { queueModelExternalSync } from '../c4/external-sync.js';
import {
  importWorkspaceIntoModel,
  type ImportedWorkspace,
} from '../c4/model-import.js';
import { detectPlantUmlFormat, parsePlantUmlWorkspace } from '../c4/plantuml-import.js';
import { validatePlantUmlImport } from '../c4/import-guards.js';
import { loadModelGraph } from '../c4/model-graph.js';
import { isC4ModelType, type C4ModelType } from '../c4/model-types.js';
import { PLANTUML_TEMPLATES } from '../c4/plantuml-templates.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMPORT_BYTES = 5_000_000;

/**
 * Verifica se o conteúdo é o template oficial em branco. Título e caption
 * podem ser editados; qualquer outra declaração transforma a criação em um
 * diagrama potencialmente parcial.
 */
function isOfficialBlankPlantUml(content: string): boolean {
  const blank = PLANTUML_TEMPLATES.find((template) => template.id === 'blank');
  if (!blank) return false;
  const normalize = (source: string): string =>
    source
      .replace(/^\s*(?:title|caption)(?:\s|\().*$/gim, '')
      .replace(/\s+/g, ' ')
      .trim();
  return normalize(content) === normalize(blank.content);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function validateImportBody(body: Record<string, unknown>, res: Response): string | null {
  const content = body.content;
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'content é obrigatório' });
    return null;
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) {
    res.status(413).json({ error: 'Conteúdo do diagrama muito grande' });
    return null;
  }
  if (body.format !== undefined && body.format !== 'plantuml') {
    res.status(400).json({ error: 'format deve ser "plantuml"' });
    return null;
  }
  if (body.mode !== undefined && body.mode !== 'replace' && body.mode !== 'merge') {
    res.status(400).json({ error: 'mode deve ser "replace" ou "merge"' });
    return null;
  }
  return content;
}

/** Valida e converte um diagrama C4-PlantUML no workspace canônico. */
function parseImportedWorkspace(content: string): ImportedWorkspace | null {
  if (!detectPlantUmlFormat(content)) return null;
  try {
    return parsePlantUmlWorkspace(content);
  } catch {
    return null;
  }
}

export class ImportController {
  /** Lista os padrões PlantUML disponíveis para criação de modelos. */
  static async listTemplates(_req: AuthenticatedRequest, res: Response) {
    return res.json({ templates: PLANTUML_TEMPLATES });
  }

  /** Importa um diagrama PlantUML criando um novo modelo na organização. */
  static async importNew(req: AuthenticatedRequest, res: Response) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const orgId = body.orgId;
    if (!isUuid(orgId)) return res.status(400).json({ error: 'orgId inválido' });
    if (body.folderId !== undefined && body.folderId !== null && !isUuid(body.folderId)) {
      return res.status(400).json({ error: 'folderId inválido' });
    }
    if (body.parentId !== undefined && body.parentId !== null && !isUuid(body.parentId)) {
      return res.status(400).json({ error: 'parentId inválido' });
    }
    if (body.c4Type !== undefined && !isC4ModelType(body.c4Type)) {
      return res.status(400).json({ error: 'c4Type inválido' });
    }
    const content = validateImportBody(body, res);
    if (!content) return;

    try {
      const role = await getOrgRole(req.user!.id, orgId);
      if (!isWriterRole(role)) {
        return res.status(403).json({ error: 'Sem permissão de escrita nesta organização' });
      }

      if (body.folderId) {
        const folder = await pool.query('SELECT id FROM folders WHERE id = $1 AND org_id = $2', [
          body.folderId,
          orgId,
        ]);
        if (folder.rows.length === 0) {
          return res.status(404).json({ error: 'Pasta não encontrada ou não pertence à organização' });
        }
      }
      if (body.parentId) {
        const parent = await pool.query('SELECT id, org_id FROM models WHERE id = $1', [body.parentId]);
        if (parent.rows.length === 0 || parent.rows[0].org_id !== orgId) {
          return res.status(404).json({ error: 'Modelo pai não encontrado ou não pertence à organização' });
        }
      }

      const workspace = parseImportedWorkspace(content);
      if (!workspace) {
        return res.status(400).json({ error: 'Diagrama PlantUML inválido' });
      }

      const mode = body.mode === 'merge' ? 'merge' : 'replace';

      // Uma relação que o parser não interpretou tornaria o resultado parcial.
      // A criação pode usar legitimamente o template oficial "Modelo em branco",
      // que não possui elementos: não há conteúdo existente a preservar nesse
      // fluxo, e o guard destrutivo completo fica no endpoint de modelo existente.
      const guard = validatePlantUmlImport({
        elements: workspace.elements,
        unrecognizedRelationships: workspace.unrecognizedRelationships,
        unrecognizedElements: workspace.unrecognizedElements,
        mode,
        hasExistingModel: false,
        allowEmpty: isOfficialBlankPlantUml(content),
      });
      if (!guard.ok) {
        return res.status(400).json({ error: guard.error });
      }

      const c4Type = (body.c4Type as C4ModelType | undefined) ?? 'container';
      const title =
        cleanTitle(body.title) ??
        cleanTitle(body.name) ??
        cleanTitle(workspace.name) ??
        'Modelo importado do PlantUML';

      const created = await pool.query(
        `INSERT INTO models (org_id, title, description, status, folder_id, c4_type, c4_scope, parent_id)
         VALUES ($1, $2, $3, 'draft', $4, $5, NULL, $6)
         RETURNING *`,
        [
          orgId,
          title,
          workspace.description,
          body.folderId ?? null,
          c4Type,
          body.parentId ?? null,
        ]
      );
      const model = created.rows[0];

      const result = await importWorkspaceIntoModel(model.id, workspace, {
        mode,
        title,
        c4Type,
      });

      model.das_content = await regenerateModelDAS(model.id);
      queueModelExternalSync(model.id, 'model.created', {
        regenerateDas: false,
        preferStoredDrawio: true,
      });
      await recordAudit({
        orgId,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'model.import.plantuml',
        entityType: 'model',
        entityId: model.id,
        metadata: {
          format: 'plantuml',
          elements: result.elements,
          relationships: result.relationships,
        },
      });

      return res.status(201).json({ ...model, import: result });
    } catch (err) {
      console.error('[imports] importNew error', err);
      return res.status(500).json({ error: 'Erro ao importar diagrama PlantUML' });
    }
  }

  /** Importa um diagrama PlantUML para um modelo existente. */
  static async importIntoModel(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.c4Type !== undefined && !isC4ModelType(body.c4Type)) {
      return res.status(400).json({ error: 'c4Type inválido' });
    }
    const content = validateImportBody(body, res);
    if (!content) return;

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const workspace = parseImportedWorkspace(content);
      if (!workspace) {
        return res.status(400).json({ error: 'Diagrama PlantUML inválido' });
      }

      const mode = body.mode === 'merge' ? 'merge' : 'replace';

      // Não aceita um resultado parcial: se alguma relação não foi interpretada,
      // o modelo existente precisa permanecer intacto. O mesmo guard impede um
      // `replace` vazio de apagar o modelo atual.
      const guard = validatePlantUmlImport({
        elements: workspace.elements,
        unrecognizedRelationships: workspace.unrecognizedRelationships,
        unrecognizedElements: workspace.unrecognizedElements,
        mode,
        hasExistingModel: true,
      });
      if (!guard.ok) {
        return res.status(400).json({ error: guard.error });
      }

      const result = await importWorkspaceIntoModel(id, workspace, {
        mode,
        // O título também faz parte do código PlantUML. Quando o chamador não
        // envia um título explícito, usa o `title` do diagrama para que uma
        // edição nesse campo seja efetivamente persistida no modelo.
        title: cleanTitle(body.title) ?? cleanTitle(workspace.name),
        description: workspace.description,
        c4Type: typeof body.c4Type === 'string' ? body.c4Type : null,
      });
      const das = await regenerateModelDAS(id);
      queueModelExternalSync(id, 'model.updated', {
        regenerateDas: false,
        preferStoredDrawio: true,
      });
      // Devolve o snapshot persistido para que o painel aplique exatamente o
      // conteúdo recém-importado no documento colaborativo, sem uma leitura
      // intermediária que pudesse capturar um estado antigo do projetor.
      const graph = await loadModelGraph(id);
      await recordAudit({
        orgId: (model.org_id as string) ?? null,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'model.import.plantuml',
        entityType: 'model',
        entityId: id,
        metadata: {
          format: 'plantuml',
          mode: result.mode,
          elements: result.elements,
          relationships: result.relationships,
        },
      });

      return res.json({
        ok: true,
        das_content: das,
        import: result,
        model: graph ? { elements: graph.elements, edges: graph.edges } : null,
      });
    } catch (err) {
      console.error('[imports] importIntoModel error', err);
      return res.status(500).json({ error: 'Erro ao importar diagrama PlantUML' });
    }
  }
}
