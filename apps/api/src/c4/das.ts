import { inflateRawSync } from 'node:zlib';
import { pool } from '../db.js';
import { parseDiagrams, type ModelDiagram } from './diagrams.js';

export interface DasModel {
  id: string;
  title: string;
  description?: string | null;
  status?: string;
  c4_type?: string;
  c4_scope?: string | null;
  folder_id?: string | null;
  org_id?: string;
}

export interface DasElement {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  app_id?: string | null;
  service_id?: string | null;
}

export interface DasEdge {
  id: string;
  from_id?: string;
  to_id?: string;
  label?: string | null;
  type?: string;
}

export interface ParsedDrawio {
  shapes: string[];
  edges: { source: string; target: string }[];
}

export const C4_TYPE_LABELS: Record<string, string> = {
  'system-landscape': 'System landscape',
  'system-context': 'Contexto do sistema',
  container: 'Containers',
  component: 'Componentes',
  code: 'Código',
  dynamic: 'Dinâmico',
  deployment: 'Implantação',
};

const C4_ORDER = [
  'system-landscape',
  'system-context',
  'container',
  'component',
  'code',
  'dynamic',
  'deployment',
];

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function cleanLabel(value: string): string {
  return decodeXmlEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readAttr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return match ? match[1] : null;
}

/**
 * Arquivos draw.io podem guardar cada página comprimida (base64 + deflate raw
 * + encodeURIComponent). Expande o conteúdo para que o DAS consiga enxergar
 * shapes e conexões também nesses arquivos.
 */
function expandCompressedDiagrams(xml: string): string {
  if (/<mxCell\b|<mxGraphModel\b/i.test(xml)) return xml;
  return xml.replace(
    /(<diagram\b[^>]*>)([\s\S]*?)(<\/diagram>)/gi,
    (full, open: string, body: string, close: string) => {
      const payload = body.trim();
      if (!payload || payload.startsWith('<') || !/^[A-Za-z0-9+/=\s]+$/.test(payload)) {
        return full;
      }
      try {
        const inflated = inflateRawSync(Buffer.from(payload, 'base64'), {
          maxOutputLength: 5_000_000,
        }).toString('utf8');
        let decoded = inflated;
        try {
          decoded = decodeURIComponent(inflated);
        } catch {
          // Mantém o texto inflado caso não esteja URL-encoded.
        }
        return `${open}${decoded}${close}`;
      } catch {
        return full;
      }
    }
  );
}

/**
 * Extrai rótulos de shapes e conexões de um XML draw.io. As conexões são
 * resolvidas para os rótulos dos vértices quando possível, para o DAS ficar
 * legível (em vez de mostrar apenas IDs internos do draw.io).
 */
export function parseDrawio(xml: string | null | undefined): ParsedDrawio {
  const shapes: string[] = [];
  const edges: { source: string; target: string }[] = [];
  if (!xml) return { shapes, edges };
  const expandedXml = expandCompressedDiagrams(xml);

  const idLabel = new Map<string, string>();

  // Objetos com metadados (shapes da biblioteca c4arch) usam <object label="...">.
  const objRegex = /<object\b[^>]*>/g;
  let objMatch: RegExpExecArray | null;
  while ((objMatch = objRegex.exec(expandedXml)) !== null) {
    const tag = objMatch[0];
    const id = readAttr(tag, 'id');
    const label = readAttr(tag, 'label');
    if (!label) continue;
    const clean = cleanLabel(label);
    if (!clean) continue;
    if (id) idLabel.set(id, clean);
    if (!shapes.includes(clean)) shapes.push(clean);
  }

  // Células nativas do draw.io usam value="..." e podem ser vértices/arestas.
  const rawEdges: { source: string; target: string }[] = [];
  const cellRegex = /<mxCell\b[^>]*>/g;
  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellRegex.exec(expandedXml)) !== null) {
    const tag = cellMatch[0];
    const id = readAttr(tag, 'id');
    const value = readAttr(tag, 'value');
    const isVertex = /vertex\s*=\s*"1"/.test(tag);
    const isEdge = /edge\s*=\s*"1"/.test(tag);

    if (value) {
      const clean = cleanLabel(value);
      if (clean && id) idLabel.set(id, clean);
      if (clean && isVertex && !shapes.includes(clean)) shapes.push(clean);
    }

    if (isEdge) {
      const source = readAttr(tag, 'source');
      const target = readAttr(tag, 'target');
      if (source && target) rawEdges.push({ source, target });
    }
  }

  for (const edge of rawEdges) {
    edges.push({
      source: idLabel.get(edge.source) ?? edge.source,
      target: idLabel.get(edge.target) ?? edge.target,
    });
  }

  return { shapes, edges };
}

function mdCell(value: string | null | undefined): string {
  return (value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—';
}

function typeLabel(type: string): string {
  return C4_TYPE_LABELS[type] ?? type;
}

function typeRank(type: string): number {
  const index = C4_ORDER.indexOf(type);
  return index === -1 ? C4_ORDER.length : index;
}

interface DiagramEntry {
  c4Type: string;
  xml: string | null;
  parsed: ParsedDrawio;
}

function collectDiagrams(
  model: DasModel,
  drawioXml: string | null | undefined,
  diagrams: ModelDiagram[]
): DiagramEntry[] {
  const byType = new Map<string, string | null>();
  const primaryType = model.c4_type ?? 'container';
  byType.set(primaryType, drawioXml ?? null);
  for (const diagram of diagrams) {
    if (!byType.has(diagram.c4Type)) {
      byType.set(diagram.c4Type, diagram.drawioXml ?? null);
    }
  }
  return [...byType.entries()]
    .sort(([a], [b]) => typeRank(a) - typeRank(b) || a.localeCompare(b))
    .map(([c4Type, xml]) => ({ c4Type, xml, parsed: parseDrawio(xml) }));
}

function renderDiagram(entry: DiagramEntry | undefined, heading: string): string {
  if (!entry) {
    return `### ${heading}\n\n_Diagrama não criado para este modelo._\n`;
  }

  const label = typeLabel(entry.c4Type);
  if (!entry.xml) {
    return `### ${heading} — ${label} (\`${entry.c4Type}\`)\n\n_Tipo de diagrama criado, mas o desenho draw.io ainda não foi salvo._\n`;
  }

  const shapes = entry.parsed.shapes;
  const edges = entry.parsed.edges;
  const shapeList = shapes.length
    ? shapes.map((shape) => `- ${shape}`).join('\n')
    : '_Nenhum elemento identificado._';
  const edgeList = edges.length
    ? edges.map((edge) => `- ${edge.source} → ${edge.target}`).join('\n')
    : '_Nenhuma conexão identificada._';

  return `### ${heading} — ${label} (\`${entry.c4Type}\`)

**Status:** desenho salvo com ${shapes.length} elemento(s) e ${edges.length} conexão(ões).

**Elementos identificados:**

${shapeList}

**Conexões identificadas:**

${edgeList}
`;
}

function otherDiagramsSection(diagrams: DiagramEntry[]): string {
  const known = new Set(['system-context', 'container', 'component', 'code']);
  const others = diagrams.filter((diagram) => !known.has(diagram.c4Type));
  if (others.length === 0) {
    return `### 5.6 Outros tipos de diagrama\n\n_Nenhum diagrama adicional (landscape, dinâmico ou implantação) criado._\n`;
  }
  return others
    .map((diagram, index) =>
      renderDiagram(diagram, `5.6.${index + 1} ${typeLabel(diagram.c4Type)}`)
    )
    .join('\n');
}

/**
 * Gera o conteúdo Markdown do DAS a partir do modelo, dos elementos/conexões do
 * Postgres e de TODOS os tipos de diagrama draw.io (primário + extras). Assim
 * o DAS evolui automaticamente quando novos tipos são criados.
 */
export function generateDAS(
  model: DasModel,
  elements: DasElement[] = [],
  edges: DasEdge[] = [],
  folderName?: string | null,
  drawioXml?: string | null,
  diagrams: ModelDiagram[] = []
): string {
  const now = new Date().toLocaleDateString('pt-BR');
  const scope = model.c4_scope ?? '—';
  const diagramEntries = collectDiagrams(model, drawioXml, diagrams);
  const primaryType = model.c4_type ?? 'container';
  const diagramTypes = diagramEntries.map((entry) => typeLabel(entry.c4Type)).join(', ');

  // Se não houver elementos no Postgres, usa os shapes do draw.io do tipo primário.
  const primary = diagramEntries.find((entry) => entry.c4Type === primaryType);
  const effectiveElements: DasElement[] = elements.length
    ? elements
    : (primary?.parsed.shapes ?? []).map((shape, index) => ({
        id: `drawio-${index}`,
        type: 'container',
        title: shape,
      }));

  const elementRows = effectiveElements.length
    ? effectiveElements
        .map(
          (element) =>
            `| ${mdCell(element.title)} | ${mdCell(element.type)} | ${mdCell(element.description)} | ${
              element.app_id ? 'app' : element.service_id ? 'service' : '—'
            } |`
        )
        .join('\n')
    : '| _nenhum elemento_ | — | — | — |';

  const edgeRows = edges.length
    ? edges
        .map((edge) => {
          const from =
            effectiveElements.find((element) => element.id === edge.from_id)?.title ??
            edge.from_id ??
            '—';
          const to =
            effectiveElements.find((element) => element.id === edge.to_id)?.title ??
            edge.to_id ??
            '—';
          return `| ${mdCell(from)} | ${mdCell(to)} | ${mdCell(edge.label)} | ${mdCell(edge.type ?? 'call')} |`;
        })
        .join('\n')
    : '| _nenhuma conexão_ | — | — | — |';

  const inventoryRows = diagramEntries
    .map((entry) => {
      const status = entry.xml
        ? entry.parsed.shapes.length > 0 || entry.parsed.edges.length > 0
          ? 'Preenchido'
          : 'Salvo (sem elementos)'
        : 'Sem desenho';
      return `| ${mdCell(typeLabel(entry.c4Type))} | \`${entry.c4Type}\` | ${entry.parsed.shapes.length} | ${entry.parsed.edges.length} | ${status} |`;
    })
    .join('\n');

  const context = diagramEntries.find((entry) => entry.c4Type === 'system-context');
  const container = diagramEntries.find((entry) => entry.c4Type === 'container');
  const component = diagramEntries.find((entry) => entry.c4Type === 'component');
  const code = diagramEntries.find((entry) => entry.c4Type === 'code');

  return `# Documento de Arquitetura de Soluções (DAS)

> Gerado automaticamente pelo C4Arch em ${now}, a partir dos diagramas e
> elementos cadastrados no modelo.

## 1. Informações do documento

| Campo | Valor |
|---|---|
| Projeto | ${mdCell(model.title)} |
| Versão | 0.2.0 |
| Data | ${now} |
| Status | ${model.status ?? 'draft'} |
| Modelo C4 primário | ${typeLabel(primaryType)} |
| Tipos de diagrama | ${mdCell(diagramTypes)} |
| Escopo C4 | ${mdCell(scope)} |
| Pasta | ${mdCell(folderName ?? 'Sem pasta')} |
| Referência | Modelo \`${model.id}\` |

---

## 2. Visão geral

### 2.1 Propósito

${model.description ?? '_Descrição não informada._'}

### 2.2 Escopo

- **Incluído:** modelo C4 "${mdCell(model.title)}" com os diagramas: ${mdCell(diagramTypes)}.
- **Excluído:** _a definir._
- **Fronteiras:** _a definir._

---

## 3. Requisitos e restrições

### 3.1 Requisitos funcionais

Referência: \`docs/PRD.md\`.

### 3.2 Requisitos não funcionais

| Categoria | Requisito | Métrica/Alvo |
|---|---|---|
| Desempenho | _a definir_ | _a definir_ |
| Disponibilidade | _a definir_ | _a definir_ |
| Segurança | RBAC owner/editor/viewer | _a definir_ |

---

## 4. Stakeholders e personas

| Stakeholder | Papel | Interesse principal |
|---|---|---|
| Arquiteto Sênior | owner | Aprovar e exportar modelos |
| Arquiteto de Soluções | editor | Construir sistemas e conexões |
| Arquiteto de Negócio | viewer | Ler e validar |

---

## 5. Diagramas C4

### 5.1 Inventário de diagramas

| Tipo | Chave | Elementos | Conexões | Situação |
|---|---|---|---|---|
${inventoryRows || '| _nenhum diagrama_ | — | 0 | 0 | Sem desenho |'}

${renderDiagram(context, '5.2 Visão de contexto (C4 — Nível 1)')}
${renderDiagram(container, '5.3 Visão de containers (C4 — Nível 2)')}
${renderDiagram(component, '5.4 Visão de componentes (C4 — Nível 3)')}
${renderDiagram(code, '5.5 Visão de código (C4 — Nível 4)')}
${otherDiagramsSection(diagramEntries)}

---

## 6. Elementos e conexões do modelo

### 6.1 Elementos

| Elemento | Tipo | Descrição | App/Serviço |
|---|---|---|---|
${elementRows}

### 6.2 Conexões

| Origem | Destino | Rótulo | Tipo |
|---|---|---|---|
${edgeRows}

---

## 7. Modelo de dados

_A definir._

---

## 8. Segurança

RBAC por organização (owner/editor/viewer). Ver \`docs/SECURITY.md\`.

---

## 9. Decisões de arquitetura

Referência: \`docs/ADR/\`.

---

## 10. Histórico

| Versão | Data | Autor | Descrição |
|---|---|---|---|
| 0.2.0 | ${now} | C4Arch (auto) | DAS regenerado a partir dos tipos de diagrama do modelo |
`;
}

/**
 * Regenera o DAS de um modelo a partir do estado atual do Postgres, incluindo
 * todos os tipos de diagrama (primário + `models.diagrams`).
 */
export async function regenerateModelDAS(modelId: string): Promise<string | null> {
  const modelRow = await pool.query('SELECT * FROM models WHERE id = $1', [modelId]);
  const model = modelRow.rows[0];
  if (!model) return null;

  const [elements, edges, folder] = await Promise.all([
    pool.query('SELECT * FROM elements WHERE model_id = $1 ORDER BY "order"', [modelId]),
    pool.query('SELECT * FROM edges WHERE model_id = $1', [modelId]),
    model.folder_id
      ? pool.query('SELECT name FROM folders WHERE id = $1', [model.folder_id])
      : Promise.resolve({ rows: [] as { name?: string }[] }),
  ]);

  const das = generateDAS(
    {
      id: model.id,
      title: model.title,
      description: model.description,
      status: model.status,
      c4_type: model.c4_type,
      c4_scope: model.c4_scope,
      folder_id: model.folder_id,
      org_id: model.org_id,
    },
    elements.rows,
    edges.rows,
    folder.rows[0]?.name ?? null,
    model.drawio_xml ?? null,
    parseDiagrams(model.diagrams)
  );

  await pool.query('UPDATE models SET das_content = $1 WHERE id = $2', [das, modelId]);
  return das;
}

/**
 * Backfill usado no startup: aplica o novo DAS a todos os modelos, novos e
 * antigos. Retorna quantos modelos tiveram o conteúdo alterado.
 */
export async function regenerateAllDAS(): Promise<number> {
  const rows = await pool.query('SELECT id, das_content FROM models');
  let changed = 0;
  for (const row of rows.rows as { id: string; das_content: string | null }[]) {
    try {
      const content = await regenerateModelDAS(row.id);
      if (content !== null && content !== row.das_content) changed += 1;
    } catch (err) {
      console.error(`[das] falha ao regenerar modelo ${row.id}`, err);
    }
  }
  return changed;
}
