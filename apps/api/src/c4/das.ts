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

/** App/serviço do catálogo usado para enriquecer shapes do draw.io. */
export interface DasAsset {
  id: string;
  kind: 'app' | 'service';
  name: string;
  description?: string | null;
  technology?: string | null;
}

export interface ParsedElement {
  id: string;
  name: string;
  c4Kind: string;
  technology: string;
  description: string;
  assetId?: string;
  assetKind?: string;
  /** Natureza declarada no rótulo: "Aplicação" ou "Serviço". */
  nature?: 'app' | 'service';
}

export interface ParsedEdge {
  source: string;
  target: string;
  label: string;
  technology: string;
}

export interface ParsedDrawio {
  shapes: string[];
  edges: ParsedEdge[];
  elements: ParsedElement[];
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
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const regex = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    attributes[match[1]] = decodeXmlEntities(match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function readAttr(tag: string, name: string): string | null {
  return parseAttributes(tag)[name] ?? null;
}

function htmlToLines(value: string): string[] {
  return decodeXmlEntities(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function cleanText(value: string | null | undefined): string {
  return value ? htmlToLines(value).join(' ') : '';
}

/** Troca placeholders usados pelos shapes de relacionamento do draw.io/C4. */
function expandPlaceholders(value: string, attributes: Record<string, string>): string {
  return value
    .replace(/%c4Description%/gi, attributes.c4Description ?? '')
    .replace(/%c4Technology%/gi, attributes.c4Technology ?? '')
    .replace(
      /%c4Name%/gi,
      attributes.c4archAssetName ?? attributes.c4Name ?? attributes.name ?? ''
    )
    .replace(/%c4Type%/gi, attributes.c4Type ?? '')
    .replace(/%c4[A-Za-z]+%/g, '');
}

/** Remove prefixos de exemplo ("e.g.") deixados pelo template do draw.io. */
function humanizePlaceholder(value: string): string {
  return value
    .replace(/^\s*e\.g\.?\s*/i, '')
    .replace(/\[\s*e\.g\.?\s+/gi, '[')
    .replace(/\s+/g, ' ')
    .trim();
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

interface ShapeInfo {
  name: string;
  c4Kind: string;
  technology: string;
  description: string;
  nature?: 'app' | 'service';
}

/**
 * Interpreta o rótulo de um shape. Shapes da biblioteca c4arch usam
 * `[Tipo: Nome]`, seguido de natureza (Aplicação/Serviço + endpoint) e de
 * `tecnologia — descrição`.
 */
function parseShapeLabel(label: string, attributes: Record<string, string>): ShapeInfo {
  const lines = htmlToLines(label);
  if (lines.length === 0) {
    return {
      name: cleanText(attributes.c4archAssetName),
      c4Kind: cleanText(attributes.c4Type) || 'Elemento',
      technology: '',
      description: '',
    };
  }

  let name = lines[0];
  let c4Kind = cleanText(attributes.c4Type) || 'Elemento';
  let rest = lines.slice(1);

  const bracket = lines[0].match(/^\[([^\]]+?):\s*(.+?)\]$/);
  if (bracket) {
    c4Kind = bracket[1].trim() || c4Kind;
    name = bracket[2].trim();
  } else {
    // Templates genéricos colocam nome e tipo na mesma linha
    // ("Site / App [Software System]"); remove o sufixo de tipo do nome.
    const trailingType = name.match(/^(.*\S)\s*\[[^\]]*\]\s*$/);
    if (trailingType) name = trailingType[1].trim();
  }

  let technology = '';
  let description = '';
  let nature: 'app' | 'service' | undefined;

  // A linha de natureza pode vir depois do tipo (ex.: nome, [tipo],
  // "Serviço http:8080"), então procura em todo o restante do rótulo.
  const natureIndex = rest.findIndex((line) => /^(Aplicação|Serviço)\b/i.test(line));
  if (natureIndex >= 0) {
    const match = rest[natureIndex].match(/^(Aplicação|Serviço)\b\s*(.*)$/i);
    if (match) {
      const line = match[1];
      const endpoint = (match[2] ?? '').trim();
      nature = /^Servi/i.test(line) ? 'service' : 'app';
      if (nature === 'service' && endpoint) technology = endpoint;
      rest = rest.filter((_, index) => index !== natureIndex);
    }
  }

  if (rest.length > 0) {
    const detail = rest.join(' — ');
    const parts = detail.split(/\s+[—–]\s+/);
    if (parts.length > 1) {
      technology = technology || parts[0].trim();
      description = parts.slice(1).join(' — ').trim();
    } else {
      description = detail.trim();
    }
  }

  return {
    name: name || cleanText(attributes.c4archAssetName),
    c4Kind: c4Kind || 'Elemento',
    technology,
    description,
    nature,
  };
}

function applyAsset(
  info: ShapeInfo,
  attributes: Record<string, string>,
  assets?: Map<string, DasAsset>
): ParsedElement {
  const assetId = cleanText(attributes.c4archAssetId);
  const asset = assetId ? assets?.get(assetId) : undefined;
  if (asset) {
    return {
      id: cleanText(attributes.id) || assetId,
      name: asset.name || info.name,
      c4Kind: info.c4Kind,
      technology: asset.technology ?? info.technology,
      description: asset.description ?? info.description,
      assetId,
      assetKind: asset.kind,
      nature: asset.kind,
    };
  }

  return {
    id: cleanText(attributes.id) || cleanText(attributes.c4archAssetName) || info.name,
    name: info.name,
    c4Kind: info.c4Kind,
    technology: info.technology,
    description: info.description,
    assetId: assetId || undefined,
    assetKind: cleanText(attributes.c4archAssetKind) || undefined,
    nature: info.nature,
  };
}

interface RawEdge {
  sourceId: string;
  targetId: string;
  label: string;
  technology: string;
}

/**
 * Extrai elementos e conexões de um XML draw.io. Trata objetos com metadados
 * (`<object>`/`<UserObject>`), células nativas e relações com placeholders,
 * resolvendo as conexões para os nomes dos elementos.
 */
export function parseDrawio(
  xml: string | null | undefined,
  assets?: Map<string, DasAsset>
): ParsedDrawio {
  const empty: ParsedDrawio = { shapes: [], edges: [], elements: [] };
  if (!xml) return empty;

  const expandedXml = expandCompressedDiagrams(xml);
  const elements: ParsedElement[] = [];
  const rawEdges: RawEdge[] = [];
  const objectSpans: [number, number][] = [];

  // Objetos com metadados (shapes da biblioteca c4arch e relações C4).
  const objectRegex = /<(object|UserObject)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let objectMatch: RegExpExecArray | null;
  while ((objectMatch = objectRegex.exec(expandedXml)) !== null) {
    objectSpans.push([objectMatch.index, objectMatch.index + objectMatch[0].length]);
    const attributes = parseAttributes(objectMatch[2]);
    const inner = objectMatch[3];
    const cellTag = inner.match(/<mxCell\b[^>]*>/i)?.[0] ?? '';
    const isVertex = /vertex\s*=\s*"1"/i.test(cellTag);
    const isEdge = /edge\s*=\s*"1"/i.test(cellTag);
    const rawLabel = expandPlaceholders(
      attributes.label ?? readAttr(cellTag, 'value') ?? '',
      attributes
    );

    if (isEdge) {
      const sourceId = readAttr(cellTag, 'source') ?? '';
      const targetId = readAttr(cellTag, 'target') ?? '';
      if (sourceId && targetId) {
        const technology = humanizePlaceholder(cleanText(attributes.c4Technology));
        let label = humanizePlaceholder(cleanText(rawLabel));
        // O template do draw.io repete a tecnologia entre colchetes no rótulo.
        if (technology && label.includes(`[${technology}]`)) {
          label = label.replace(`[${technology}]`, '').replace(/\s+/g, ' ').trim();
        }
        rawEdges.push({ sourceId, targetId, label, technology });
      }
      continue;
    }

    if (isVertex || attributes.label) {
      const info = parseShapeLabel(rawLabel, attributes);
      if (info.name || info.description) {
        elements.push(applyAsset(info, attributes, assets));
      }
    }
  }

  // Células nativas do draw.io, ignorando as que já estão dentro de <object>.
  const cellRegex = /<mxCell\b[^>]*>/gi;
  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellRegex.exec(expandedXml)) !== null) {
    const insideObject = objectSpans.some(
      ([start, end]) => cellMatch!.index >= start && cellMatch!.index < end
    );
    if (insideObject) continue;

    const tag = cellMatch[0];
    const attributes = parseAttributes(tag);
    const id = attributes.id ?? '';
    const value = attributes.value ?? '';
    const isVertex = /vertex\s*=\s*"1"/i.test(tag);
    const isEdge = /edge\s*=\s*"1"/i.test(tag);

    if (isVertex && value) {
      const info = parseShapeLabel(value, attributes);
      if (info.name || info.description) {
        elements.push({
          id: id || `element-${elements.length}`,
          name: info.name,
          c4Kind: info.c4Kind,
          technology: info.technology,
          description: info.description,
        });
      }
    }

    if (isEdge && attributes.source && attributes.target) {
      rawEdges.push({
        sourceId: attributes.source,
        targetId: attributes.target,
        label: humanizePlaceholder(cleanText(value)),
        technology: '',
      });
    }
  }

  const names = new Map(elements.map((element) => [element.id, element.name]));
  const edges: ParsedEdge[] = rawEdges.map((edge) => ({
    source: names.get(edge.sourceId) ?? edge.sourceId,
    target: names.get(edge.targetId) ?? edge.targetId,
    label: edge.label,
    technology: edge.technology,
  }));

  const shapes: string[] = [];
  for (const element of elements) {
    if (element.name && !shapes.includes(element.name)) shapes.push(element.name);
  }

  return { shapes, edges, elements };
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
  diagrams: ModelDiagram[],
  assets?: Map<string, DasAsset>
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
    .map(([c4Type, xml]) => ({ c4Type, xml, parsed: parseDrawio(xml, assets) }));
}

function renderElementTable(elements: ParsedElement[]): string {
  if (elements.length === 0) return '_Nenhum elemento identificado._';
  const rows = elements
    .map(
      (element) =>
        `| ${mdCell(element.name)} | ${mdCell(element.c4Kind)} | ${mdCell(element.technology)} | ${mdCell(element.description)} |`
    )
    .join('\n');
  return `| Elemento | Tipo C4 | Tecnologia | Descrição |\n|---|---|---|---|\n${rows}`;
}

function renderEdgeTable(edges: ParsedEdge[]): string {
  if (edges.length === 0) return '_Nenhuma conexão identificada._';
  const rows = edges
    .map(
      (edge) =>
        `| ${mdCell(edge.source)} | ${mdCell(edge.target)} | ${mdCell(edge.label)} | ${mdCell(edge.technology)} |`
    )
    .join('\n');
  return `| Origem | Destino | Rótulo | Tecnologia |\n|---|---|---|---|\n${rows}`;
}

function renderDiagram(entry: DiagramEntry | undefined, heading: string): string {
  if (!entry) {
    return `### ${heading}\n\n_Diagrama não criado para este modelo._\n`;
  }

  const label = typeLabel(entry.c4Type);
  const diagramId = `### ${heading} — ${label} (\`${entry.c4Type}\`)`;

  if (!entry.xml) {
    return `${diagramId}\n\n_Tipo de diagrama criado, mas o desenho draw.io ainda não foi salvo._\n`;
  }

  const elements = entry.parsed.elements;
  const edges = entry.parsed.edges;
  if (elements.length === 0 && edges.length === 0) {
    return `${diagramId}\n\n_Desenho salvo, mas nenhum elemento ou conexão nomeado foi identificado._\n`;
  }

  return `${diagramId}

**Resumo:** ${elements.length} elemento(s) e ${edges.length} conexão(ões) identificados no desenho.

**Elementos**

${renderElementTable(elements)}

**Conexões**

${renderEdgeTable(edges)}
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

interface AggregatedElement extends ParsedElement {
  diagramLabels: string[];
}

interface AggregatedEdge extends ParsedEdge {
  diagramLabels: string[];
}

function aggregateElements(
  diagrams: DiagramEntry[],
  postgresElements: DasElement[]
): AggregatedElement[] {
  const map = new Map<string, AggregatedElement>();

  const add = (
    element: ParsedElement,
    diagramLabel: string | null
  ) => {
    const key = `${element.name.toLowerCase()}|${element.c4Kind.toLowerCase()}`;
    const existing = map.get(key);
    if (existing) {
      if (diagramLabel && !existing.diagramLabels.includes(diagramLabel)) {
        existing.diagramLabels.push(diagramLabel);
      }
      if (!existing.technology && element.technology) existing.technology = element.technology;
      if (!existing.description && element.description) existing.description = element.description;
      return;
    }
    map.set(key, {
      ...element,
      diagramLabels: diagramLabel ? [diagramLabel] : [],
    });
  };

  for (const diagram of diagrams) {
    for (const element of diagram.parsed.elements) {
      add(element, typeLabel(diagram.c4Type));
    }
  }

  for (const element of postgresElements) {
    add(
      {
        id: element.id,
        name: element.title,
        c4Kind: element.type,
        technology: '',
        description: element.description ?? '',
      },
      null
    );
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function aggregateEdges(
  diagrams: DiagramEntry[],
  postgresEdges: DasEdge[],
  postgresElements: DasElement[]
): AggregatedEdge[] {
  const map = new Map<string, AggregatedEdge>();

  const add = (edge: ParsedEdge, diagramLabel: string | null) => {
    const key = `${edge.source.toLowerCase()}|${edge.target.toLowerCase()}|${edge.label.toLowerCase()}`;
    const existing = map.get(key);
    if (existing) {
      if (diagramLabel && !existing.diagramLabels.includes(diagramLabel)) {
        existing.diagramLabels.push(diagramLabel);
      }
      if (!existing.technology && edge.technology) existing.technology = edge.technology;
      return;
    }
    map.set(key, {
      ...edge,
      diagramLabels: diagramLabel ? [diagramLabel] : [],
    });
  };

  for (const diagram of diagrams) {
    for (const edge of diagram.parsed.edges) {
      add(edge, typeLabel(diagram.c4Type));
    }
  }

  for (const edge of postgresEdges) {
    const source = postgresElements.find((element) => element.id === edge.from_id)?.title;
    const target = postgresElements.find((element) => element.id === edge.to_id)?.title;
    if (!source || !target) continue;
    add(
      {
        source,
        target,
        label: edge.label ?? '',
        technology: edge.type ?? '',
      },
      null
    );
  }

  return [...map.values()].sort(
    (a, b) => a.source.localeCompare(b.source, 'pt-BR') || a.target.localeCompare(b.target, 'pt-BR')
  );
}

function renderAggregatedElementTable(elements: AggregatedElement[]): string {
  if (elements.length === 0) return '_Nenhum elemento identificado._';
  const rows = elements
    .map(
      (element) =>
        `| ${mdCell(element.name)} | ${mdCell(element.c4Kind)} | ${mdCell(element.technology)} | ${mdCell(element.description)} | ${mdCell(element.diagramLabels.join(', ') || '—')} |`
    )
    .join('\n');
  return `| Elemento | Tipo C4 | Tecnologia | Descrição | Diagramas |\n|---|---|---|---|---|\n${rows}`;
}

function renderAggregatedEdgeTable(edges: AggregatedEdge[]): string {
  if (edges.length === 0) return '_Nenhuma conexão identificada._';
  const rows = edges
    .map(
      (edge) =>
        `| ${mdCell(edge.source)} | ${mdCell(edge.target)} | ${mdCell(edge.label)} | ${mdCell(edge.technology)} | ${mdCell(edge.diagramLabels.join(', ') || '—')} |`
    )
    .join('\n');
  return `| Origem | Destino | Rótulo | Tecnologia | Diagramas |\n|---|---|---|---|---|\n${rows}`;
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
  diagrams: ModelDiagram[] = [],
  assets?: Map<string, DasAsset>
): string {
  const now = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const scope = model.c4_scope ?? '—';
  const diagramEntries = collectDiagrams(model, drawioXml, diagrams, assets);
  const primaryType = model.c4_type ?? 'container';
  const diagramTypes = diagramEntries.map((entry) => typeLabel(entry.c4Type)).join(', ');
  const aggregatedElements = aggregateElements(diagramEntries, elements);
  const aggregatedEdges = aggregateEdges(diagramEntries, edges, elements);

  const inventoryRows = diagramEntries
    .map((entry) => {
      const elementCount = entry.parsed.elements.length;
      const edgeCount = entry.parsed.edges.length;
      const status = entry.xml
        ? elementCount > 0 || edgeCount > 0
          ? 'Preenchido'
          : 'Salvo (sem elementos)'
        : 'Sem desenho';
      return `| ${mdCell(typeLabel(entry.c4Type))} | \`${entry.c4Type}\` | ${elementCount} | ${edgeCount} | ${status} |`;
    })
    .join('\n');

  const context = diagramEntries.find((entry) => entry.c4Type === 'system-context');
  const container = diagramEntries.find((entry) => entry.c4Type === 'container');
  const component = diagramEntries.find((entry) => entry.c4Type === 'component');
  const code = diagramEntries.find((entry) => entry.c4Type === 'code');

  const purpose =
    model.description?.trim() ||
    `Documento da arquitetura do modelo "${model.title}", gerado a partir de ${diagramEntries.length} diagrama(s) C4 e ${aggregatedElements.length} elemento(s) identificado(s).`;

  const markdown = `# Documento de Arquitetura de Soluções (DAS)

> Gerado automaticamente pelo C4Arch em ${now}, a partir dos diagramas e
> elementos cadastrados no modelo.

## 1. Informações do documento

| Campo | Valor |
|---|---|
| Projeto | ${mdCell(model.title)} |
| Versão | 0.3.0 |
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

${purpose}

### 2.2 Escopo

- **Incluído:** modelo C4 "${mdCell(model.title)}" com os diagramas: ${mdCell(diagramTypes)}.
- **Elementos identificados:** ${aggregatedElements.length}.
- **Conexões identificadas:** ${aggregatedEdges.length}.
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

${renderAggregatedElementTable(aggregatedElements)}

### 6.2 Conexões

${renderAggregatedEdgeTable(aggregatedEdges)}

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
| 0.3.0 | ${now} | C4Arch (auto) | DAS regenerado a partir dos tipos de diagrama e das conexões identificadas no draw.io |
`;

  return `${markdown.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function metadataTechnology(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const record = metadata as Record<string, unknown>;
  const value = record.technology ?? record.tech;
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Regenera o DAS de um modelo a partir do estado atual do Postgres, incluindo
 * todos os tipos de diagrama (primário + `models.diagrams`).
 */
export async function regenerateModelDAS(modelId: string): Promise<string | null> {
  const modelRow = await pool.query('SELECT * FROM models WHERE id = $1', [modelId]);
  const model = modelRow.rows[0];
  if (!model) return null;

  const [elements, edges, folder, apps, services] = await Promise.all([
    pool.query('SELECT * FROM elements WHERE model_id = $1 ORDER BY "order"', [modelId]),
    pool.query('SELECT * FROM edges WHERE model_id = $1', [modelId]),
    model.folder_id
      ? pool.query('SELECT name FROM folders WHERE id = $1', [model.folder_id])
      : Promise.resolve({ rows: [] as { name?: string }[] }),
    pool.query('SELECT id, name, description, metadata FROM apps WHERE org_id = $1', [
      model.org_id,
    ]),
    pool.query(
      'SELECT id, name, description, protocol, port, metadata FROM services WHERE org_id = $1',
      [model.org_id]
    ),
  ]);

  const assets = new Map<string, DasAsset>();
  for (const app of apps.rows as {
    id: string;
    name: string;
    description: string | null;
    metadata: unknown;
  }[]) {
    assets.set(app.id, {
      id: app.id,
      kind: 'app',
      name: app.name,
      description: app.description,
      technology: metadataTechnology(app.metadata),
    });
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
    const technology = [metadataTechnology(service.metadata), endpoint]
      .filter(Boolean)
      .join(' · ');
    assets.set(service.id, {
      id: service.id,
      kind: 'service',
      name: service.name,
      description: service.description,
      technology,
    });
  }

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
    parseDiagrams(model.diagrams),
    assets
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
