import { pool } from '../db.js';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { getModelAccess, getOrgRole, isWriterRole } from '../auth/access.js';
import {
  DEFAULT_C4_MODEL_TYPE,
  isC4ModelType,
  type C4ModelType,
} from '../c4/model-types.js';
import { regenerateModelDAS } from '../c4/das-service.js';
import { saveDasOverrides } from '../c4/das-canonical.js';
import { getVersion, listVersions, restoreVersion } from '../c4/versions.js';
import { inspectModel } from '../c4/inspections.js';
import { recordAudit } from '../c4/audit.js';
import { importCatalogAssets } from '../c4/catalog-import.js';
import { parseDiagrams } from '../c4/diagrams.js';
import { runShadowCheck } from '../c4/shadow.js';
import { flags } from '../flags.js';
import { canonicalModelHasData, loadCanonicalElements, loadCanonicalEdges } from '../c4/canonical-access.js';
import { fetchPublicText, UnsafeUrlError } from '../security/url.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Diagramas C4 reais podem passar de algumas centenas de kB. O limite do corpo
// JSON dessas rotas é de 8 MB (ver server.ts); aqui aplicamos o teto lógico do
// conteúdo XML em 5 MB.
const MAX_DRAWIO_XML_LENGTH = 5_000_000;
const MAX_IMPORT_SIZE = 5_000_000;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function cleanOptionalText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().slice(0, max);
}

function stripModelExtension(value: string): string {
  return value
    .replace(/(\.drawio)?\.xml$/i, '')
    .replace(/\.drawio$/i, '')
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractXmlTitle(xml: string): string | null {
  const diagram = xml.match(/<diagram\b[^>]*\bname="([^"]+)"/i);
  if (diagram) return decodeEntities(diagram[1]).trim();
  const title = xml.match(/<title>([^<]+)<\/title>/i);
  return title ? decodeEntities(title[1]).trim() : null;
}

function inferC4Type(text: string): C4ModelType | null {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/contexto|context/.test(normalized)) return 'system-context';
  if (/container/.test(normalized)) return 'container';
  if (/componente|component/.test(normalized)) return 'component';
  if (/codigo|code/.test(normalized)) return 'code';
  if (/landscape|panorama/.test(normalized)) return 'system-landscape';
  if (/dinamic|dynamic|fluxo/.test(normalized)) return 'dynamic';
  if (/deploy|implant/.test(normalized)) return 'deployment';
  return null;
}

const IMPORT_HEADERS = {
  Accept: 'application/xml,text/xml,*/*',
  'User-Agent': 'C4Arch-Importer/1.0',
};

export class ModelController {
  static async list(req: AuthenticatedRequest, res: Response) {
    try {
      const result = await pool.query(
        `SELECT m.*, o.name AS org_name
           FROM models m
           JOIN organizations o ON o.id = m.org_id
           JOIN memberships mem ON mem.org_id = o.id
          WHERE mem.user_id = $1
          ORDER BY m.created_at DESC`,
        [req.user!.id]
      );
      return res.json(result.rows);
    } catch (err) {
      console.error('[models] list error', err);
      return res.status(500).json({ error: 'Erro ao listar modelos' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const { orgId, title, description, status, folderId, c4Type, c4Scope, parentId, drawioXml } =
      req.body as {
        orgId?: string;
        title?: string;
        description?: string | null;
        status?: 'draft' | 'final';
        folderId?: string | null;
        c4Type?: C4ModelType;
        c4Scope?: string | null;
        parentId?: string | null;
        drawioXml?: string | null;
      };

    const cleanTitle = typeof title === 'string' ? title.trim() : '';
    if (!isUuid(orgId) || !cleanTitle) {
      return res.status(400).json({ error: 'orgId e title são obrigatórios' });
    }
    if (cleanTitle.length > 200) {
      return res.status(400).json({ error: 'title muito longo' });
    }
    if (status !== undefined && status !== 'draft' && status !== 'final') {
      return res.status(400).json({ error: 'status deve ser "draft" ou "final"' });
    }
    if (folderId !== undefined && folderId !== null && !isUuid(folderId)) {
      return res.status(400).json({ error: 'folderId inválido' });
    }
    if (c4Type !== undefined && !isC4ModelType(c4Type)) {
      return res.status(400).json({ error: 'c4Type inválido' });
    }
    if (c4Scope !== undefined && c4Scope !== null && typeof c4Scope !== 'string') {
      return res.status(400).json({ error: 'c4Scope inválido' });
    }
    if (parentId !== undefined && parentId !== null && !isUuid(parentId)) {
      return res.status(400).json({ error: 'parentId inválido' });
    }
    if (drawioXml !== undefined && drawioXml !== null) {
      if (typeof drawioXml !== 'string' || !drawioXml.trimStart().startsWith('<')) {
        return res.status(400).json({ error: 'drawioXml inválido' });
      }
      if (drawioXml.length > MAX_DRAWIO_XML_LENGTH) {
        return res.status(413).json({ error: 'drawioXml muito grande' });
      }
    }
 
    try {
      const role = await getOrgRole(req.user!.id, orgId);
      if (!isWriterRole(role)) {
        return res.status(403).json({ error: 'Sem permissão de escrita nesta organização' });
      }

      if (folderId) {
        const folder = await pool.query(
          'SELECT id FROM folders WHERE id = $1 AND org_id = $2',
          [folderId, orgId]
        );
        if (folder.rows.length === 0) {
          return res.status(404).json({ error: 'Pasta não encontrada ou não pertence à organização' });
        }
      }

      // Validação de vínculo a modelo existente (parent) e unicidade do tipo de diagrama
      const effectiveC4Type = c4Type ?? DEFAULT_C4_MODEL_TYPE;
      if (parentId) {
        const parent = await pool.query(
          'SELECT id, org_id, c4_type FROM models WHERE id = $1',
          [parentId]
        );
        if (parent.rows.length === 0 || parent.rows[0].org_id !== orgId) {
          return res.status(404).json({ error: 'Modelo pai não encontrado ou não pertence à organização' });
        }
        // Impede mais de um modelo com o mesmo tipo de diagrama no mesmo grupo
        const dup = await pool.query(
          `SELECT id FROM models WHERE org_id = $1 AND c4_type = $2
             AND (id = $3 OR parent_id = $3)`,
          [orgId, effectiveC4Type, parentId]
        );
        if (dup.rows.length > 0 || parent.rows[0].c4_type === effectiveC4Type) {
          return res.status(409).json({ error: 'Já existe um diagrama deste tipo vinculado a este modelo' });
        }
      }
 
      const model = await pool.query(
        `INSERT INTO models (org_id, title, description, status, folder_id, c4_type, c4_scope, parent_id, drawio_xml)
         VALUES ($1, $2, $3, COALESCE($4, 'draft'), $5, $6, $7, $8, $9) RETURNING *`,
        [
          orgId,
          cleanTitle,
          cleanOptionalText(description, 5000),
          status ?? null,
          folderId ?? null,
          c4Type ?? DEFAULT_C4_MODEL_TYPE,
          cleanOptionalText(c4Scope, 200),
          parentId ?? null,
          drawioXml ?? null,
        ]
      );
      const created = model.rows[0];
      // O DAS é gerado pelo fluxo único, com todos os diagramas e metadados.
      created.das_content = await regenerateModelDAS(created.id);
      await recordAudit({
        orgId,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'model.create',
        entityType: 'model',
        entityId: created.id,
        metadata: { title: created.title, c4Type: created.c4_type },
      });
      return res.status(201).json(created);
    } catch (err) {
      console.error('[models] create error', err);
      return res.status(500).json({ error: 'Erro ao criar modelo' });
    }
  }

  /**
   * Importa um modelo a partir de um XML draw.io enviado pelo navegador
   * (arquivo/pasta local) ou baixado de uma URL (Google Drive ou outra fonte).
   * O frontend chama esta rota uma vez por arquivo para permitir importação em
   * lote com relatório individual de sucesso/falha.
   */
  static async importModel(req: AuthenticatedRequest, res: Response) {
    const { orgId, folderId, title, description, c4Type, c4Scope, parentId, xml, url, name, source } =
      req.body as {
        orgId?: string;
        folderId?: string | null;
        title?: string;
        description?: string | null;
        c4Type?: C4ModelType;
        c4Scope?: string | null;
        parentId?: string | null;
        xml?: string;
        url?: string;
        name?: string;
        source?: string;
      };

    if (!isUuid(orgId)) {
      return res.status(400).json({ error: 'orgId inválido' });
    }
    if (folderId !== undefined && folderId !== null && !isUuid(folderId)) {
      return res.status(400).json({ error: 'folderId inválido' });
    }
    if (c4Type !== undefined && !isC4ModelType(c4Type)) {
      return res.status(400).json({ error: 'c4Type inválido' });
    }
    if ((!xml && !url) || (xml && url)) {
      return res.status(400).json({ error: 'Informe xml OU url (exatamente uma fonte)' });
    }
    if (typeof xml === 'string') {
      if (!xml.trimStart().startsWith('<')) {
        return res.status(400).json({ error: 'XML inválido' });
      }
      if (xml.length > MAX_IMPORT_SIZE) {
        return res.status(413).json({ error: 'XML muito grande' });
      }
    }
    if (url !== undefined && typeof url !== 'string') {
      return res.status(400).json({ error: 'url inválida' });
    }
    if (c4Scope !== undefined && c4Scope !== null && typeof c4Scope !== 'string') {
      return res.status(400).json({ error: 'c4Scope inválido' });
    }
    if (parentId !== undefined && parentId !== null && !isUuid(parentId)) {
      return res.status(400).json({ error: 'parentId inválido' });
    }

    try {
      const role = await getOrgRole(req.user!.id, orgId);
      if (!isWriterRole(role)) {
        return res.status(403).json({ error: 'Sem permissão de escrita nesta organização' });
      }

      if (folderId) {
        const folder = await pool.query(
          'SELECT id FROM folders WHERE id = $1 AND org_id = $2',
          [folderId, orgId]
        );
        if (folder.rows.length === 0) {
          return res.status(404).json({ error: 'Pasta não encontrada ou não pertence à organização' });
        }
      }

      if (parentId) {
        const parent = await pool.query(
          'SELECT id, org_id, c4_type FROM models WHERE id = $1',
          [parentId]
        );
        if (parent.rows.length === 0 || parent.rows[0].org_id !== orgId) {
          return res.status(404).json({ error: 'Modelo pai não encontrado ou não pertence à organização' });
        }
      }

      const content =
        typeof xml === 'string'
          ? xml
          : await fetchPublicText(url as string, {
              maxBytes: MAX_IMPORT_SIZE,
              headers: IMPORT_HEADERS,
            });
      if (content.length > MAX_IMPORT_SIZE) {
        return res.status(413).json({ error: 'XML muito grande' });
      }

      const sourceName = typeof name === 'string' ? name : title;
      const explicitTitle = typeof title === 'string' ? stripModelExtension(title) : '';
      const derivedTitle =
        explicitTitle ||
        extractXmlTitle(content) ||
        (sourceName ? stripModelExtension(sourceName) : '') ||
        'Modelo importado';
      const cleanTitle = derivedTitle.slice(0, 200);
      const effectiveType =
        c4Type ?? inferC4Type(`${sourceName ?? ''} ${cleanTitle}`) ?? DEFAULT_C4_MODEL_TYPE;
      const importDescription =
        cleanOptionalText(description, 5000) ??
        (source ? `Importado de ${source}`.slice(0, 5000) : null);

      // Mesma regra do create: um grupo só pode ter um diagrama por tipo.
      // Sem isso, o índice único do banco viraria um 500 na importação.
      if (parentId) {
        const dup = await pool.query(
          `SELECT id FROM models WHERE org_id = $1 AND c4_type = $2
             AND (id = $3 OR parent_id = $3)`,
          [orgId, effectiveType, parentId]
        );
        if (dup.rows.length > 0) {
          return res
            .status(409)
            .json({ error: 'Já existe um diagrama deste tipo vinculado a este modelo' });
        }
      }

      // Antes de criar o modelo, cadastra no catálogo os componentes do XML
      // que ainda não existem como app/serviço. A operação é idempotente.
      const catalog = await importCatalogAssets(orgId, content);

      const result = await pool.query(
        `INSERT INTO models
           (org_id, title, description, status, folder_id, c4_type, c4_scope, parent_id, drawio_xml)
         VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8)
         RETURNING *`,
        [orgId, cleanTitle, importDescription, folderId ?? null, effectiveType, c4Scope ?? null, parentId ?? null, content]
      );
      const created = result.rows[0];

      // O DAS já nasce preenchido com o diagrama importado.
      created.das_content = await regenerateModelDAS(created.id);
      await recordAudit({
        orgId,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'model.import',
        entityType: 'model',
        entityId: created.id,
        metadata: { title: created.title },
      });
      return res.status(201).json({ ...created, diagrams: [], catalog });
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        return res.status(400).json({ error: err.message });
      }
      console.error('[models] importModel error', err);
      return res.status(500).json({ error: 'Erro ao importar modelo' });
    }
  }

  static async get(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      let elements: unknown[] = [];
      let edges: unknown[] = [];

      if (flags.canonicalModel === 'on' && (await canonicalModelHasData(id))) {
        elements = await loadCanonicalElements(id);
        edges = await loadCanonicalEdges(id);
      } else {
        const legacyElements = await pool.query(
          'SELECT * FROM elements WHERE model_id = $1 ORDER BY "order"',
          [id]
        );
        const legacyEdges = await pool.query(
          `SELECT e.*, from_elem.title AS source_title, to_elem.title AS target_title
             FROM edges e
             JOIN elements from_elem ON from_elem.id = e.from_id
             JOIN elements to_elem ON to_elem.id = e.to_id
            WHERE e.model_id = $1`,
          [id]
        );
        elements = legacyElements.rows;
        edges = legacyEdges.rows;
      }

      res.json({ ...model, elements, edges });

      // M2: a resposta acima continua vindo do legado. Em modo sombra, o
      // canônico é comparado em paralelo, depois do envio, sem alterar payload
      // nem status. Falhas são registradas e nunca derrubam a requisição.
      if (flags.canonicalModel === 'shadow') {
        void runShadowCheck(id);
      }
      return;
    } catch (err) {
      console.error('[models] get error', err);
      return res.status(500).json({ error: 'Erro ao carregar modelo' });
    }
  }

  /**
   * Vincula um novo tipo de diagrama ao MESMO modelo (não cria novo modelo).
   * Os diagramas extras ficam na coluna JSONB `diagrams`.
   */
  static async addDiagram(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { c4Type } = req.body as { c4Type?: C4ModelType };

    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    if (!isC4ModelType(c4Type)) {
      return res.status(400).json({ error: 'c4Type inválido' });
    }

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const diagrams = parseDiagrams(model.diagrams);
      if (model.c4_type === c4Type || diagrams.some((d) => d.c4Type === c4Type)) {
        return res.status(409).json({ error: 'Este tipo de diagrama já existe neste modelo' });
      }

      const next = [...diagrams, { c4Type, drawioXml: null }];
      const result = await pool.query(
        'UPDATE models SET diagrams = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING *',
        [JSON.stringify(next), id]
      );
      // O DAS é regenerado e passa a incluir o novo tipo de diagrama.
      const das = await regenerateModelDAS(id);
      return res.status(201).json({
        ...result.rows[0],
        diagrams: parseDiagrams(result.rows[0].diagrams),
        das_content: das,
      });
    } catch (err) {
      console.error('[models] addDiagram error', err);
      return res.status(500).json({ error: 'Erro ao adicionar tipo de diagrama' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { title, description, status, folderId, c4Type, c4Scope, parentId } = req.body as {
      title?: string;
      description?: string | null;
      status?: 'draft' | 'final';
      folderId?: string | null;
      c4Type?: C4ModelType;
      c4Scope?: string | null;
      parentId?: string | null;
    };

    if (!isUuid(id)) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) {
        return res.status(400).json({ error: 'title inválido' });
      }
    }
    if (description !== undefined && description !== null && typeof description !== 'string') {
      return res.status(400).json({ error: 'description inválida' });
    }
    if (status !== undefined && status !== 'draft' && status !== 'final') {
      return res.status(400).json({ error: 'status deve ser "draft" ou "final"' });
    }
    if (folderId !== undefined && folderId !== null && !isUuid(folderId)) {
      return res.status(400).json({ error: 'folderId inválido' });
    }
    if (c4Type !== undefined && !isC4ModelType(c4Type)) {
      return res.status(400).json({ error: 'c4Type inválido' });
    }
    if (c4Scope !== undefined && c4Scope !== null && typeof c4Scope !== 'string') {
      return res.status(400).json({ error: 'c4Scope inválido' });
    }
    if (parentId !== undefined && parentId !== null && !isUuid(parentId)) {
      return res.status(400).json({ error: 'parentId inválido' });
    }
 
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      const orgId = model.org_id as string;
      // Validação de vínculo/uniqueness se parentId ou c4Type forem alterados
      const newParentId = parentId !== undefined ? parentId : (model.parent_id as string | null);
      const newC4Type = c4Type !== undefined ? c4Type : (model.c4_type as C4ModelType);
      if (parentId !== undefined && parentId !== null) {
        const parent = await pool.query('SELECT id, org_id, c4_type FROM models WHERE id = $1', [parentId]);
        if (parent.rows.length === 0 || parent.rows[0].org_id !== orgId) {
          return res.status(404).json({ error: 'Modelo pai não encontrado ou não pertence à organização' });
        }
        // Evita ciclos: o novo pai não pode ser o próprio modelo nem um
        // descendente dele. A hierarquia é rasa, mas a checagem é genérica.
        const ancestry = await pool.query(
          `WITH RECURSIVE ancestors AS (
             SELECT id, parent_id FROM models WHERE id = $1
             UNION ALL
             SELECT m.id, m.parent_id
               FROM models m
               JOIN ancestors a ON m.id = a.parent_id
           )
           SELECT 1 FROM ancestors WHERE id = $2 LIMIT 1`,
          [parentId, id]
        );
        if (ancestry.rows.length > 0) {
          return res.status(400).json({ error: 'parentId inválido: ciclo de modelos' });
        }
      }
      // unicidade do tipo de diagrama no grupo
      const groupRoot = newParentId ?? id;
      const dup = await pool.query(
        `SELECT id FROM models WHERE org_id = $1 AND c4_type = $2
           AND (id = $3 OR parent_id = $3) AND id <> $4`,
        [orgId, newC4Type, groupRoot, id]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'Já existe um diagrama deste tipo vinculado a este modelo' });
      }
      if (groupRoot !== id) {
        const parentRow = await pool.query('SELECT c4_type FROM models WHERE id = $1', [groupRoot]);
        if (parentRow.rows[0]?.c4_type === newC4Type) {
          return res.status(409).json({ error: 'Já existe um diagrama deste tipo vinculado a este modelo' });
        }
      }
      const sets: string[] = [];
      const values: unknown[] = [];
      let index = 1;

      if (title !== undefined) {
        sets.push(`title = $${index++}`);
        values.push(title.trim());
      }
      if (description !== undefined) {
        sets.push(`description = $${index++}`);
        values.push(cleanOptionalText(description, 5000));
      }
      if (status !== undefined) {
        sets.push(`status = $${index++}`);
        values.push(status);
      }
      if (folderId !== undefined) {
        if (folderId !== null) {
          const folder = await pool.query(
            'SELECT id FROM folders WHERE id = $1 AND org_id = $2',
            [folderId, orgId]
          );
          if (folder.rows.length === 0) {
            return res.status(404).json({ error: 'Pasta não encontrada ou não pertence à organização' });
          }
        }
        sets.push(`folder_id = $${index++}`);
        values.push(folderId);
      }
      if (parentId !== undefined) {
        sets.push(`parent_id = $${index++}`);
        values.push(parentId);
      }
      if (c4Type !== undefined) {
        sets.push(`c4_type = $${index++}`);
        values.push(c4Type);
      }
      if (c4Scope !== undefined) {
        sets.push(`c4_scope = $${index++}`);
        values.push(cleanOptionalText(c4Scope, 200));
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      values.push(id);
      const result = await pool.query(
        `UPDATE models SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${index} RETURNING *`,
        values
      );
      const updated = result.rows[0];
      // Regenera o DAS automaticamente com todos os tipos de diagrama.
      updated.das_content = await regenerateModelDAS(id);
      await recordAudit({
        orgId,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'model.update',
        entityType: 'model',
        entityId: id,
        metadata: { fields: Object.keys(req.body ?? {}) },
      });
      return res.json(updated);
    } catch (err) {
      console.error('[models] update error', err);
      return res.status(500).json({ error: 'Erro ao atualizar modelo' });
    }
  }

  static async das(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      const result = await pool.query('SELECT das_content FROM models WHERE id = $1', [id]);
      let content = result.rows[0]?.das_content ?? '';
      if (!content.trim()) {
        // Modelos antigos sem DAS recebem o documento automaticamente.
        content = (await regenerateModelDAS(id)) ?? '';
      }
      return res.json({ id, content });
    } catch (err) {
      console.error('[models] das error', err);
      return res.status(500).json({ error: 'Erro ao carregar DAS' });
    }
  }

  static async updateDas(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { content } = req.body as { content?: string };
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'content inválido' });
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }
      if (flags.dasOverrides !== 'off') {
        // `shadow` também grava overrides: a diferença é que a geração normal
        // continua usando o caminho legado até o cutover.
        const saved = await saveDasOverrides(id, content, req.user!.id);
        await recordAudit({
          orgId: (model.org_id as string) ?? null,
          actorId: req.user!.id,
          actorEmail: req.user!.email,
          action: 'das.update',
          entityType: 'model',
          entityId: id,
          metadata: { changedKeys: saved?.changedKeys ?? [] },
        });
        return res.json({ ok: true, ...saved });
      }
      await pool.query('UPDATE models SET das_content = $1, updated_at = NOW() WHERE id = $2', [content, id]);
      await recordAudit({
        orgId: (model.org_id as string) ?? null,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'das.update',
        entityType: 'model',
        entityId: id,
      });
      return res.json({ ok: true });
    } catch (err) {
      console.error('[models] updateDas error', err);
      return res.status(500).json({ error: 'Erro ao salvar DAS' });
    }
  }

  static async versions(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      const limit = Number(req.query.limit ?? 100);
      const versions = await listVersions(id, Number.isFinite(limit) ? limit : 100);
      return res.json({ versions });
    } catch (err) {
      console.error('[models] versions error', err);
      return res.status(500).json({ error: 'Erro ao listar versões' });
    }
  }

  static async version(req: AuthenticatedRequest, res: Response) {
    const { id, versionId } = req.params;
    if (!isUuid(id) || !isUuid(versionId)) {
      return res.status(404).json({ error: 'Versão não encontrada' });
    }
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      const version = await getVersion(id, versionId);
      if (!version) return res.status(404).json({ error: 'Versão não encontrada' });
      return res.json(version);
    } catch (err) {
      console.error('[models] version error', err);
      return res.status(500).json({ error: 'Erro ao carregar versão' });
    }
  }

  static async restore(req: AuthenticatedRequest, res: Response) {
    const { id, versionId } = req.params;
    if (!isUuid(id) || !isUuid(versionId)) {
      return res.status(404).json({ error: 'Versão não encontrada' });
    }
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para restaurar este modelo' });
      }
      const restored = await restoreVersion(id, versionId, req.user!.id);
      if (!restored) return res.status(404).json({ error: 'Versão não encontrada' });
      await recordAudit({
        orgId: (model.org_id as string) ?? null,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'version.restore',
        entityType: 'model_version',
        entityId: versionId,
        metadata: { modelId: id, newVersion: restored.version },
      });
      return res.json({ ok: true, ...restored });
    } catch (err) {
      console.error('[models] restore error', err);
      return res.status(500).json({ error: 'Erro ao restaurar versão' });
    }
  }

  static async inspect(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Modelo não encontrado' });
    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      const report = await inspectModel(id);
      return res.json(report);
    } catch (err) {
      console.error('[models] inspect error', err);
      return res.status(500).json({ error: 'Erro ao inspecionar modelo' });
    }
  }

  static async remove(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Sem permissão para alterar este modelo' });
      }

      await pool.query('DELETE FROM models WHERE id = $1', [id]);
      await recordAudit({
        orgId: (model.org_id as string) ?? null,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'model.delete',
        entityType: 'model',
        entityId: id,
      });
      return res.json({ ok: true });
    } catch (err) {
      console.error('[models] remove error', err);
      return res.status(500).json({ error: 'Erro ao excluir modelo' });
    }
  }
}
