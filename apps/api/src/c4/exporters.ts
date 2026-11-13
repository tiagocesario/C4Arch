import { COLORS, Raster, encodePng } from './png.js';
import { computeAutoLayout, hasStoredLayout } from './autolayout.js';
import type { GraphEdge, GraphElement, ModelGraph } from './model-graph.js';
import { extractTechnologyFromLabel, slugify } from './canonical.js';

/**
 * Exportadores do C4Arch (Onda 2, item 7 e 11).
 *
 * Todos os formatos partem do mesmo grafo (`loadModelGraph`) e não dependem de
 * binários nativos. SVG/HTML/PNG são gerados no servidor; o draw.io continua
 * sendo suportado, agora com IDs estáveis (`c4archElementId`) para o adapter
 * não depender de nomes ou posições.
 */

export type ExportFormat =
  | 'structurizr-json'
  | 'structurizr-dsl'
  | 'plantuml'
  | 'mermaid'
  | 'svg'
  | 'html'
  | 'drawio'
  | 'png';

export const EXPORT_FORMATS: Array<{
  format: ExportFormat;
  label: string;
  contentType: string;
  extension: string;
}> = [
  { format: 'structurizr-json', label: 'Structurizr JSON', contentType: 'application/json; charset=utf-8', extension: 'json' },
  { format: 'structurizr-dsl', label: 'Structurizr DSL', contentType: 'text/plain; charset=utf-8', extension: 'dsl' },
  { format: 'plantuml', label: 'C4-PlantUML', contentType: 'text/plain; charset=utf-8', extension: 'puml' },
  { format: 'mermaid', label: 'Mermaid', contentType: 'text/plain; charset=utf-8', extension: 'mmd' },
  { format: 'svg', label: 'SVG', contentType: 'image/svg+xml; charset=utf-8', extension: 'svg' },
  { format: 'html', label: 'Site estático', contentType: 'text/html; charset=utf-8', extension: 'html' },
  { format: 'drawio', label: 'draw.io', contentType: 'application/xml; charset=utf-8', extension: 'drawio' },
  { format: 'png', label: 'PNG', contentType: 'image/png', extension: 'png' },
];

export interface ExportOptions {
  theme?: 'light' | 'dark';
  legend?: boolean;
  title?: string;
}

export interface ExportResult {
  body: string | Buffer;
  contentType: string;
  filename: string;
}

type Kind = 'person' | 'software_system' | 'container' | 'component';

interface LayoutBox {
  element: GraphElement;
  kind: Kind;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RenderedGraph {
  title: string;
  description: string | null;
  boxes: LayoutBox[];
  edges: Array<{ edge: GraphEdge; from: LayoutBox; to: LayoutBox }>;
  width: number;
  height: number;
}

const NODE_WIDTH = 190;
const NODE_HEIGHT = 90;
const MARGIN = 48;

const THEMES = {
  light: {
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#1e293b',
    muted: '#64748b',
    line: '#475569',
    border: '#334155',
    fills: {
      person: '#fef3c7',
      software_system: '#dbeafe',
      container: '#dcfce7',
      component: '#f3e8ff',
    } as Record<Kind, string>,
  },
  dark: {
    background: '#0f172a',
    surface: '#111c33',
    text: '#e2e8f0',
    muted: '#94a3b8',
    line: '#94a3b8',
    border: '#475569',
    fills: {
      person: '#78350f',
      software_system: '#1e3a8a',
      container: '#14532d',
      component: '#4c1d95',
    } as Record<Kind, string>,
  },
} as const;

const KIND_LABEL: Record<Kind, string> = {
  person: 'Pessoa',
  software_system: 'Sistema',
  container: 'Container',
  component: 'Componente',
};

function kindOf(element: GraphElement): Kind {
  switch (element.type) {
    case 'actor':
    case 'person':
      return 'person';
    case 'system':
    case 'software_system':
      return 'software_system';
    case 'container':
      return 'container';
    default:
      return 'component';
  }
}

function modelTitle(graph: ModelGraph): string {
  const title = graph.model.title;
  return typeof title === 'string' && title.trim() ? title.trim() : 'Modelo C4';
}

function modelDescription(graph: ModelGraph): string | null {
  const description = graph.model.description;
  return typeof description === 'string' && description.trim() ? description.trim() : null;
}

function metadataOf(element: GraphElement): Record<string, unknown> {
  return element.metadata && typeof element.metadata === 'object'
    ? (element.metadata as Record<string, unknown>)
    : {};
}

function technologyOf(element: GraphElement): string | null {
  const metadata = metadataOf(element);
  const value = metadata.technology ?? metadata.tech;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function tagsOf(element: GraphElement): string[] {
  const value = metadataOf(element).tags;
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && !!item.trim());
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function relationshipTechnology(edge: GraphEdge): string | null {
  return extractTechnologyFromLabel(edge.label);
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function fileBaseTitle(title: string): string {
  return slugify(title) || 'modelo';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(value: string): string {
  return escapeXml(value);
}

function escapePlantUml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, "'").replace(/\r?\n/g, ' ');
}

function escapeDsl(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

function escapeMermaid(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/\r?\n/g, ' ');
}

function wrapText(value: string, maxChars: number, maxLines = 3): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function resolveRenderedGraph(graph: ModelGraph): RenderedGraph {
  const elements = graph.elements;
  const stored = hasStoredLayout(
    elements.map((element) => ({ position_x: element.position_x, position_y: element.position_y }))
  );

  let positions: Map<string, { x: number; y: number }>;
  if (stored) {
    positions = new Map(
      elements.map((element) => [element.id, { x: element.position_x, y: element.position_y }])
    );
  } else {
    const auto = computeAutoLayout(
      elements.map((element) => ({ id: element.id, type: element.type, title: element.title })),
      graph.edges.map((edge) => ({ from: edge.from_id, to: edge.to_id })),
      { direction: 'LR', nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT, gapX: 90, gapY: 32 }
    );
    positions = new Map(auto.map((position) => [position.id, { x: position.x, y: position.y }]));
  }

  const boxes: LayoutBox[] = elements.map((element) => {
    const position = positions.get(element.id) ?? { x: 0, y: 0 };
    return {
      element,
      kind: kindOf(element),
      x: position.x,
      y: position.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
  });

  const boxById = new Map(boxes.map((box) => [box.element.id, box]));
  const edges = graph.edges
    .map((edge) => {
      const from = boxById.get(edge.from_id);
      const to = boxById.get(edge.to_id);
      return from && to ? { edge, from, to } : null;
    })
    .filter((item): item is { edge: GraphEdge; from: LayoutBox; to: LayoutBox } => item !== null);

  const maxX = Math.max(0, ...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(0, ...boxes.map((box) => box.y + box.height));

  return {
    title: modelTitle(graph),
    description: modelDescription(graph),
    boxes,
    edges,
    width: Math.max(420, maxX + MARGIN * 2),
    height: Math.max(260, maxY + MARGIN * 2),
  };
}

/** SVG do modelo, com tema, legenda e rótulos quebrados em linhas. */
export function renderSvg(graph: ModelGraph, options: ExportOptions = {}): string {
  const theme = THEMES[options.theme ?? 'light'];
  const rendered = resolveRenderedGraph(graph);
  const offsetX = MARGIN;
  const offsetY = MARGIN + 42;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${rendered.width}" height="${rendered.height + 34}" viewBox="0 0 ${rendered.width} ${rendered.height + 34}" role="img" aria-label="${escapeXml(rendered.title)}">`
  );
  parts.push('<defs>');
  parts.push(
    `<marker id="c4arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${theme.line}"/></marker>`
  );
  parts.push('</defs>');
  parts.push(`<rect width="100%" height="100%" fill="${theme.background}"/>`);
  parts.push(
    `<text x="${offsetX}" y="34" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="600" fill="${theme.text}">${escapeXml(rendered.title)}</text>`
  );
  if (rendered.description) {
    parts.push(
      `<text x="${offsetX}" y="54" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="${theme.muted}">${escapeXml(rendered.description.slice(0, 140))}</text>`
    );
  }

  for (const { edge, from, to } of rendered.edges) {
    const x1 = offsetX + from.x + from.width;
    const y1 = offsetY + from.y + from.height / 2;
    const x2 = offsetX + to.x;
    const y2 = offsetY + to.y + to.height / 2;
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${theme.line}" stroke-width="1.4" marker-end="url(#c4arrow)" opacity="0.85"/>`
    );
    const label = edge.label?.trim();
    if (label) {
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const text = label.length > 34 ? `${label.slice(0, 33)}…` : label;
      parts.push(
        `<rect x="${midX - text.length * 3.2 - 4}" y="${midY - 12}" width="${text.length * 6.4 + 8}" height="16" rx="3" fill="${theme.background}" opacity="0.9"/>`
      );
      parts.push(
        `<text x="${midX}" y="${midY}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="${theme.muted}">${escapeXml(text)}</text>`
      );
    }
  }

  for (const box of rendered.boxes) {
    const x = offsetX + box.x;
    const y = offsetY + box.y;
    const fill = theme.fills[box.kind];
    const titleLines = wrapText(box.element.title || 'Sem título', 24, 2);
    const descriptionLines = wrapText(box.element.description ?? '', 30, 2);
    parts.push(`<g>`);
    parts.push(`<title>${escapeXml(box.element.title)} — ${KIND_LABEL[box.kind]}</title>`);
    parts.push(
      `<rect x="${x}" y="${y}" width="${box.width}" height="${box.height}" rx="8" fill="${fill}" stroke="${theme.border}" stroke-width="1.2"/>`
    );
    let textY = y + 24;
    for (const line of titleLines) {
      parts.push(
        `<text x="${x + 10}" y="${textY}" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="600" fill="${theme.text}">${escapeXml(line)}</text>`
      );
      textY += 16;
    }
    if (descriptionLines.length > 0) {
      textY += 2;
      for (const line of descriptionLines) {
        parts.push(
          `<text x="${x + 10}" y="${textY}" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="${theme.muted}">${escapeXml(line)}</text>`
        );
        textY += 12;
      }
    }
    parts.push(
      `<text x="${x + box.width - 8}" y="${y + box.height - 8}" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="9" fill="${theme.muted}">${KIND_LABEL[box.kind]}</text>`
    );
    parts.push('</g>');
  }

  if (options.legend !== false) {
    const legendY = rendered.height + 16;
    const items: Kind[] = ['person', 'software_system', 'container', 'component'];
    let cursor = offsetX;
    parts.push(
      `<text x="${offsetX}" y="${legendY}" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="${theme.muted}">Legenda:</text>`
    );
    cursor += 52;
    for (const kind of items) {
      parts.push(
        `<rect x="${cursor}" y="${legendY - 9}" width="12" height="10" rx="2" fill="${theme.fills[kind]}" stroke="${theme.border}"/>`
      );
      parts.push(
        `<text x="${cursor + 16}" y="${legendY}" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="${theme.muted}">${KIND_LABEL[kind]}</text>`
      );
      cursor += 92;
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}

function pngColor(value: string): readonly [number, number, number, number] {
  const hex = value.replace('#', '');
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    255,
  ];
}

/** PNG rasterizado localmente, sem `canvas`/`sharp`. */
export function renderPng(graph: ModelGraph, options: ExportOptions = {}): Buffer {
  const theme = THEMES[options.theme ?? 'light'];
  const rendered = resolveRenderedGraph(graph);
  const scale = 2;
  const offsetX = MARGIN * scale;
  const offsetY = (MARGIN + 42) * scale;
  const width = Math.ceil(rendered.width * scale);
  const height = Math.ceil((rendered.height + 34) * scale);

  const raster = new Raster(width, height, pngColor(theme.background));
  const lineColor = pngColor(theme.line);
  const textColor = pngColor(theme.text);
  const mutedColor = pngColor(theme.muted);
  const borderColor = pngColor(theme.border);

  raster.text(offsetX, 22 * scale, rendered.title, textColor, 2);

  for (const { edge, from, to } of rendered.edges) {
    const x1 = offsetX + (from.x + from.width) * scale;
    const y1 = offsetY + (from.y + from.height / 2) * scale;
    const x2 = offsetX + to.x * scale;
    const y2 = offsetY + (to.y + to.height / 2) * scale;
    raster.line(x1, y1, x2, y2, lineColor, 1);
    const label = edge.label?.trim();
    if (label) {
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      raster.text(midX, midY - 8, label.slice(0, 24), mutedColor, 1);
    }
  }

  for (const box of rendered.boxes) {
    const x = Math.round(offsetX + box.x * scale);
    const y = Math.round(offsetY + box.y * scale);
    const boxWidth = Math.round(box.width * scale);
    const boxHeight = Math.round(box.height * scale);
    raster.fillRect(x, y, boxWidth, boxHeight, pngColor(theme.fills[box.kind]));
    raster.strokeRect(x, y, boxWidth, boxHeight, borderColor);
    const titleLines = wrapText(box.element.title || 'Sem título', 22, 2);
    let cursorY = y + 12;
    for (const line of titleLines) {
      raster.text(x + 8, cursorY, line, textColor, 2);
      cursorY += 14;
    }
    const descriptionLines = wrapText(box.element.description ?? '', 34, 2);
    cursorY += 4;
    for (const line of descriptionLines) {
      raster.text(x + 8, cursorY, line, mutedColor, 1);
      cursorY += 8;
    }
    raster.text(x + 8, y + boxHeight - 12, KIND_LABEL[box.kind], mutedColor, 1);
  }

  if (options.legend !== false) {
    const legendY = Math.round((rendered.height + 16) * scale);
    let cursor = offsetX;
    raster.text(cursor, legendY - 8, 'Legenda:', mutedColor, 1);
    cursor += 52 * scale;
    const items: Kind[] = ['person', 'software_system', 'container', 'component'];
    for (const kind of items) {
      raster.fillRect(cursor, legendY - 10, 12, 10, pngColor(theme.fills[kind]));
      raster.strokeRect(cursor, legendY - 10, 12, 10, borderColor);
      raster.text(cursor + 16, legendY - 10, KIND_LABEL[kind], mutedColor, 1);
      cursor += 92 * scale;
    }
  }

  return encodePng(raster);
}

/** Site estático: uma página autocontida com SVG, inventário e relações. */
export function renderHtml(graph: ModelGraph, options: ExportOptions = {}): string {
  const theme = THEMES[options.theme ?? 'light'];
  const title = options.title ?? modelTitle(graph);
  const description = modelDescription(graph);
  const svg = renderSvg(graph, { ...options, title });

  const elementRows = graph.elements
    .map((element) => {
      const kind = kindOf(element);
      return `<tr><td>${escapeHtml(element.title)}</td><td>${KIND_LABEL[kind]}</td><td>${escapeHtml(
        technologyOf(element) ?? '—'
      )}</td><td>${escapeHtml(element.description ?? '—')}</td></tr>`;
    })
    .join('\n');

  const titleById = new Map(graph.elements.map((element) => [element.id, element.title]));
  const relationshipRows = graph.edges
    .map(
      (edge) =>
        `<tr><td>${escapeHtml(titleById.get(edge.from_id) ?? '—')}</td><td>${escapeHtml(
          titleById.get(edge.to_id) ?? '—'
        )}</td><td>${escapeHtml(edge.label || '—')}</td><td>${escapeHtml(
          relationshipTechnology(edge) ?? '—'
        )}</td></tr>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — C4Arch</title>
<style>
  :root { color-scheme: ${options.theme === 'dark' ? 'dark' : 'light'}; }
  body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; background: ${theme.background}; color: ${theme.text}; }
  main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 28px; margin: 0 0 6px; }
  h2 { font-size: 18px; margin: 34px 0 10px; }
  p.description { color: ${theme.muted}; margin: 0 0 22px; }
  .diagram { background: ${theme.surface}; border: 1px solid ${theme.border}; border-radius: 12px; padding: 12px; overflow: auto; }
  .diagram svg { max-width: 100%; height: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid ${theme.border}; vertical-align: top; }
  th { color: ${theme.muted}; font-weight: 600; }
  footer { margin-top: 42px; color: ${theme.muted}; font-size: 12px; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  ${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}
  <div class="diagram">${svg}</div>
  <h2>Elementos (${graph.elements.length})</h2>
  <table><thead><tr><th>Nome</th><th>Tipo</th><th>Tecnologia</th><th>Descrição</th></tr></thead><tbody>
  ${elementRows || '<tr><td colspan="4">Nenhum elemento.</td></tr>'}
  </tbody></table>
  <h2>Relações (${graph.edges.length})</h2>
  <table><thead><tr><th>Origem</th><th>Destino</th><th>Rótulo</th><th>Tecnologia</th></tr></thead><tbody>
  ${relationshipRows || '<tr><td colspan="4">Nenhuma relação.</td></tr>'}
  </tbody></table>
  <footer>Gerado por C4Arch em ${dateStamp()}.</footer>
</main>
</body>
</html>`;
}

interface StructurizrElement {
  id: number;
  name: string;
  description: string;
  technology?: string;
  tags?: string;
  identifier: string;
  kind: Kind;
  parentIdentifier: string | null;
  relationships: Array<Record<string, unknown>>;
  containers?: StructurizrElement[];
  components?: StructurizrElement[];
}

interface StructurizrLayout {
  numeric: Map<string, number>;
  elements: Map<string, StructurizrElement>;
  host: StructurizrElement;
  containers: StructurizrElement[];
  components: StructurizrElement[];
}

function buildStructurizrElements(graph: ModelGraph): StructurizrLayout {
  const numeric = new Map<string, number>();
  const elements = new Map<string, StructurizrElement>();
  let nextId = 1;

  const make = (element: GraphElement, kind: Kind, parentIdentifier: string | null): StructurizrElement => {
    const id = nextId++;
    numeric.set(element.id, id);
    const item: StructurizrElement = {
      id,
      name: element.title || 'Sem título',
      description: element.description ?? '',
      identifier: slugify(element.title) || `element-${id}`,
      kind,
      parentIdentifier,
      relationships: [],
    };
    const technology = technologyOf(element);
    if (technology) item.technology = technology;
    const tags = tagsOf(element);
    if (tags.length > 0) item.tags = tags.join(',');
    elements.set(element.id, item);
    return item;
  };

  const people = graph.elements.filter((element) => kindOf(element) === 'person');
  const systems = graph.elements.filter((element) => kindOf(element) === 'software_system');
  const containers = graph.elements.filter((element) => kindOf(element) === 'container');
  const components = graph.elements.filter((element) => kindOf(element) === 'component');

  for (const element of people) make(element, 'person', null);

  let hostId: string | null = systems[0]?.id ?? null;
  const hostElement = systems[0];
  let host: StructurizrElement;
  if (hostId && hostElement) {
    host = make(hostElement, 'software_system', null);
  } else {
    host = {
      id: nextId++,
      name: modelTitle(graph),
      description: 'Sistema sintético criado para agrupar containers e componentes.',
      identifier: 'c4arch_system',
      kind: 'software_system',
      parentIdentifier: null,
      relationships: [],
      containers: [],
    };
    hostId = '__synthetic__';
    numeric.set('__synthetic__', host.id);
  }
  host.containers = [];

  for (const element of systems.slice(1)) make(element, 'software_system', null);

  const containerObjects = new Map<string, StructurizrElement>();
  for (const element of containers) {
    const item = make(element, 'container', hostId);
    containerObjects.set(element.id, item);
    item.components = [];
    host.containers.push(item);
  }

  // Componentes sem container ficam em um container sintético, para que o JSON
  // continue válido aos olhos de ferramentas do Structurizr.
  let fallbackContainer: StructurizrElement | null = null;
  if (components.length > 0 && containerObjects.size === 0) {
    fallbackContainer = {
      id: nextId++,
      name: 'Aplicação',
      description: 'Container sintético criado a partir dos componentes.',
      identifier: 'c4arch_container',
      kind: 'container',
      parentIdentifier: hostId,
      relationships: [],
      components: [],
    };
    host.containers.push(fallbackContainer);
  }

  for (const element of components) {
    const parent = fallbackContainer ?? [...containerObjects.values()][0] ?? null;
    const item = make(element, 'component', parent?.identifier ?? host.identifier);
    parent?.components?.push(item);
  }

  const elementById = elements;
  let relationshipId = 1;
  for (const edge of graph.edges) {
    const source = elementById.get(edge.from_id);
    if (!source) continue;
    const destination = numeric.get(edge.to_id);
    if (!destination) continue;
    const relationship: Record<string, unknown> = {
      id: relationshipId++,
      description: edge.label || '',
      destinationId: destination,
    };
    const technology = relationshipTechnology(edge);
    if (technology) relationship.technology = technology;
    source.relationships.push(relationship);
  }

  return { numeric, elements, host, containers: [...containerObjects.values()], components: [...elements.values()].filter((item) => item.kind === 'component') };
}

function stripInternal(element: StructurizrElement): Record<string, unknown> {
  const output: Record<string, unknown> = {
    id: element.id,
    name: element.name,
    description: element.description,
  };
  if (element.technology) output.technology = element.technology;
  if (element.tags) output.tags = element.tags;
  if (element.relationships.length > 0) output.relationships = element.relationships;
  if (element.containers && element.containers.length > 0) {
    output.containers = element.containers.map(stripInternal);
  }
  if (element.components && element.components.length > 0) {
    output.components = element.components.map(stripInternal);
  }
  return output;
}

/** Workspace JSON compatível com Structurizr. */
export function renderStructurizrJson(graph: ModelGraph): string {
  const layout = buildStructurizrElements(graph);
  const people = graph.elements
    .filter((element) => kindOf(element) === 'person')
    .map((element) => layout.elements.get(element.id))
    .filter((item): item is StructurizrElement => !!item)
    .map(stripInternal);

  const systems = graph.elements
    .filter((element) => kindOf(element) === 'software_system')
    .map((element) => layout.elements.get(element.id))
    .filter((item): item is StructurizrElement => !!item);

  const systemObjects: Record<string, unknown>[] =
    systems.length === 0 || layout.host.identifier === 'c4arch_system'
      ? [stripInternal(layout.host), ...systems.map(stripInternal)]
      : systems.map(stripInternal);

  const views: Record<string, unknown> = {
    systemLandscapeViews: [
      { key: 'landscape', description: 'Panorama do sistema', include: [{ expression: '*' }], autoLayout: true },
    ],
    configuration: {
      styles: [
        { type: 'person', background: '#fef3c7', color: '#1e293b' },
        { type: 'softwareSystem', background: '#dbeafe', color: '#1e293b' },
        { type: 'container', background: '#dcfce7', color: '#1e293b' },
        { type: 'component', background: '#f3e8ff', color: '#1e293b' },
      ],
      themes: [],
    },
  };

  if (layout.host) {
    views.systemContextViews = [
      {
        key: 'context',
        softwareSystemId: layout.host.id,
        include: [{ expression: '*' }],
        autoLayout: true,
      },
    ];
  }
  if (layout.containers.length > 0) {
    views.containerViews = [
      {
        key: 'containers',
        softwareSystemId: layout.host.id,
        include: [{ expression: '*' }],
        autoLayout: true,
      },
    ];
  }
  const firstContainer = layout.containers[0];
  if (firstContainer) {
    views.componentViews = [
      {
        key: 'components',
        containerId: firstContainer.id,
        include: [{ expression: '*' }],
        autoLayout: true,
      },
    ];
  }

  const workspace = {
    id: 1,
    name: modelTitle(graph),
    description: modelDescription(graph) ?? '',
    model: {
      people,
      softwareSystems: systemObjects,
      deploymentNodes: [],
    },
    views,
    documentation: {},
    decisions: [],
  };

  return `${JSON.stringify(workspace, null, 2)}\n`;
}

function dslIdentifier(element: StructurizrElement): string {
  return element.identifier.replace(/[^A-Za-z0-9_]/g, '_') || `element_${element.id}`;
}

/** DSL do Structurizr com hierarquia e relações. */
export function renderStructurizrDsl(graph: ModelGraph): string {
  const layout = buildStructurizrElements(graph);
  const lines: string[] = [];
  lines.push(`workspace "${escapeDsl(modelTitle(graph))}" "${escapeDsl(modelDescription(graph) ?? '')}" {`);
  lines.push('  model {');

  const people = graph.elements
    .filter((element) => kindOf(element) === 'person')
    .map((element) => layout.elements.get(element.id))
    .filter((item): item is StructurizrElement => !!item);

  const systems = graph.elements
    .filter((element) => kindOf(element) === 'software_system')
    .map((element) => layout.elements.get(element.id))
    .filter((item): item is StructurizrElement => !!item);

  for (const person of people) {
    lines.push(
      `    ${dslIdentifier(person)} = person "${escapeDsl(person.name)}" "${escapeDsl(person.description)}"`
    );
  }

  const systemList = systems.length > 0 && layout.host.identifier !== 'c4arch_system'
    ? systems
    : [layout.host, ...systems];

  for (const system of systemList) {
    const id = dslIdentifier(system);
    const header = `    ${id} = softwareSystem "${escapeDsl(system.name)}" "${escapeDsl(system.description)}"`;
    if ((system.containers ?? []).length === 0) {
      lines.push(header);
      continue;
    }
    lines.push(`${header} {`);
    for (const container of system.containers ?? []) {
      const containerId = dslIdentifier(container);
      const containerHeader = `      ${containerId} = container "${escapeDsl(container.name)}" "${escapeDsl(container.description)}"`;
      const components = container.components ?? [];
      if (components.length === 0) {
        if (container.technology) {
          lines.push(
            `      ${containerId} = container "${escapeDsl(container.name)}" "${escapeDsl(container.description)}" "${escapeDsl(container.technology)}"`
          );
        } else {
          lines.push(containerHeader);
        }
        continue;
      }
      lines.push(`${containerHeader} {`);
      for (const component of components) {
        const technology = component.technology ? ` "${escapeDsl(component.technology)}"` : '';
        lines.push(
          `        ${dslIdentifier(component)} = component "${escapeDsl(component.name)}" "${escapeDsl(component.description)}"${technology}`
        );
      }
      lines.push('      }');
    }
    lines.push('    }');
  }

  for (const edge of graph.edges) {
    const source = layout.numeric.has(edge.from_id)
      ? graph.elements.find((element) => element.id === edge.from_id)
      : undefined;
    const target = layout.numeric.has(edge.to_id)
      ? graph.elements.find((element) => element.id === edge.to_id)
      : undefined;
    if (!source || !target) continue;
    const sourceObject = layout.elements.get(source.id);
    const targetObject = layout.elements.get(target.id);
    if (!sourceObject || !targetObject) continue;
    const technology = relationshipTechnology(edge);
    const tech = technology ? ` "${escapeDsl(technology)}"` : '';
    lines.push(
      `    ${dslIdentifier(sourceObject)} -> ${dslIdentifier(targetObject)} "${escapeDsl(edge.label || '')}"${tech}`
    );
  }

  lines.push('  }');
  lines.push('  views {');
  lines.push('    systemLandscape { include * }');
  if (layout.host) lines.push(`    systemContext ${dslIdentifier(layout.host)} { include * }`);
  if (layout.containers.length > 0) {
    lines.push(`    container ${dslIdentifier(layout.host)} { include * }`);
  }
  const firstContainer = layout.containers[0];
  if (firstContainer) {
    lines.push(`    component ${dslIdentifier(firstContainer)} { include * }`);
  }
  lines.push('  }');
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** C4-PlantUML. */
export function renderPlantUml(graph: ModelGraph): string {
  const lines: string[] = [];
  const kind = (element: GraphElement): Kind => kindOf(element);

  const hasComponents = graph.elements.some((element) => kind(element) === 'component');
  const include = hasComponents
    ? 'C4_Component.puml'
    : graph.elements.some((element) => kind(element) === 'container')
      ? 'C4_Container.puml'
      : 'C4_Context.puml';

  lines.push('@startuml');
  lines.push(`!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/${include}`);
  lines.push(`title ${escapePlantUml(modelTitle(graph))}`);
  if (modelDescription(graph)) lines.push(`caption ${escapePlantUml(modelDescription(graph) ?? '')}`);

  const identifiers = new Map<string, string>();
  let index = 0;
  for (const element of graph.elements) {
    const id = `e${index++}`;
    identifiers.set(element.id, id);
    const name = escapePlantUml(element.title);
    const description = escapePlantUml(element.description ?? '');
    const technology = technologyOf(element);
    switch (kind(element)) {
      case 'person':
        lines.push(`Person(${id}, "${name}", "${description}")`);
        break;
      case 'software_system':
        lines.push(`System(${id}, "${name}", "${description}")`);
        break;
      case 'container':
        lines.push(
          `Container(${id}, "${name}", "${technology ? escapePlantUml(technology) : ''}", "${description}")`
        );
        break;
      default:
        lines.push(
          `Component(${id}, "${name}", "${technology ? escapePlantUml(technology) : ''}", "${description}")`
        );
    }
  }

  for (const edge of graph.edges) {
    const from = identifiers.get(edge.from_id);
    const to = identifiers.get(edge.to_id);
    if (!from || !to) continue;
    const technology = relationshipTechnology(edge);
    const tech = technology ? `, "${escapePlantUml(technology)}"` : '';
    lines.push(`Rel(${from}, ${to}, "${escapePlantUml(edge.label || '')}"${tech})`);
  }

  lines.push('@enduml');
  return `${lines.join('\n')}\n`;
}

/** Mermaid `flowchart`, útil para wikis e Markdown. */
export function renderMermaid(graph: ModelGraph): string {
  const lines: string[] = ['flowchart LR'];
  const identifiers = new Map<string, string>();
  let index = 0;
  for (const element of graph.elements) {
    const id = `n${index++}`;
    identifiers.set(element.id, id);
    const technology = technologyOf(element);
    const label = technology ? `${element.title}<br/>[${technology}]` : element.title;
    lines.push(`  ${id}["${escapeMermaid(label)}"]`);
  }
  for (const edge of graph.edges) {
    const from = identifiers.get(edge.from_id);
    const to = identifiers.get(edge.to_id);
    if (!from || !to) continue;
    const label = edge.label ? `|"${escapeMermaid(edge.label)}"|` : '';
    lines.push(`  ${from} -->${label} ${to}`);
  }
  return `${lines.join('\n')}\n`;
}

/** XML draw.io com IDs estáveis e posições do layout resolvido. */
export function renderDrawio(graph: ModelGraph): string {
  const rendered = resolveRenderedGraph(graph);
  const offsetX = MARGIN;
  const offsetY = MARGIN + 42;
  const pageWidth = Math.ceil(rendered.width + 80);
  const pageHeight = Math.ceil(rendered.height + 120);

  const cells: string[] = [];
  cells.push('<mxCell id="0"/>');
  cells.push('<mxCell id="1" parent="0"/>');

  const colors: Record<Kind, string> = {
    person: '#fef3c7',
    software_system: '#dbeafe',
    container: '#dcfce7',
    component: '#f3e8ff',
  };
  const border: Record<Kind, string> = {
    person: '#d97706',
    software_system: '#2563eb',
    container: '#16a34a',
    component: '#7c3aed',
  };

  for (const box of rendered.boxes) {
    const objectId = `c4arch-${box.element.id}`;
    const label = `<b>${escapeXml(box.element.title)}</b>${
      box.element.description ? `<br><span style="font-size:10px">${escapeXml(box.element.description)}</span>` : ''
    }`;
    const style = `rounded=1;whiteSpace=wrap;html=1;fillColor=${colors[box.kind]};strokeColor=${border[box.kind]};fontColor=#1e293b;align=left;verticalAlign=top;spacing=8;`;
    cells.push(
      `<object id="${objectId}" label="${label}" c4archElementId="${escapeXml(box.element.id)}" c4archType="${box.kind}">`
    );
    cells.push(
      `  <mxCell id="shape-${box.element.id}" style="${style}" vertex="1" parent="1">`
    );
    cells.push(
      `    <mxGeometry x="${offsetX + box.x}" y="${offsetY + box.y}" width="${box.width}" height="${box.height}" as="geometry"/>`
    );
    cells.push('  </mxCell>');
    cells.push('</object>');
  }

  for (const { edge, from, to } of rendered.edges) {
    const style =
      'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#475569;fontColor=#334155;fontSize=10;endArrow=block;endFill=1;';
    cells.push(
      `<mxCell id="edge-${edge.id}" value="${escapeXml(edge.label || '')}" style="${style}" edge="1" parent="1" source="c4arch-${from.element.id}" target="c4arch-${to.element.id}">`
    );
    cells.push('  <mxGeometry relative="1" as="geometry"/>');
    cells.push('</mxCell>');
  }

  return `<mxfile host="c4arch" modified="${new Date().toISOString()}" agent="C4Arch" version="1.0">
  <diagram id="c4arch-${escapeXml(String(graph.model.id ?? 'model'))}" name="${escapeXml(modelTitle(graph))}">
    <mxGraphModel dx="${pageWidth}" dy="${pageHeight}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">
      <root>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

/** Despacha o formato pedido e devolve corpo, content-type e nome do arquivo. */
export function exportModel(
  graph: ModelGraph,
  format: ExportFormat,
  options: ExportOptions = {}
): ExportResult {
  const metadata = EXPORT_FORMATS.find((item) => item.format === format);
  if (!metadata) throw new Error(`Formato de exportação desconhecido: ${format}`);
  const title = options.title ?? modelTitle(graph);
  const filename = `${fileBaseTitle(title)}.${metadata.extension}`;

  switch (format) {
    case 'structurizr-json':
      return { body: renderStructurizrJson(graph), contentType: metadata.contentType, filename };
    case 'structurizr-dsl':
      return { body: renderStructurizrDsl(graph), contentType: metadata.contentType, filename };
    case 'plantuml':
      return { body: renderPlantUml(graph), contentType: metadata.contentType, filename };
    case 'mermaid':
      return { body: renderMermaid(graph), contentType: metadata.contentType, filename };
    case 'svg':
      return { body: renderSvg(graph, options), contentType: metadata.contentType, filename };
    case 'html':
      return { body: renderHtml(graph, options), contentType: metadata.contentType, filename };
    case 'drawio':
      return { body: renderDrawio(graph), contentType: metadata.contentType, filename };
    case 'png':
      return { body: renderPng(graph, options), contentType: metadata.contentType, filename };
  }
}

/** Cores usadas também pelo PNG: mantém os exporters visualmente coerentes. */
export const EXPORT_COLORS = COLORS;
