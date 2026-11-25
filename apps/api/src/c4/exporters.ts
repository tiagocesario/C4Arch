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

/**
 * Dimensões e estilos oficiais da biblioteca C4 do draw.io.
 *
 * O desenho gerado a partir do PlantUML precisa continuar sendo um diagrama
 * C4 quando aberto no editor: as shapes (person2, sistema, container e
 * componente), as cores e o rótulo de três linhas seguem o padrão do draw.io.
 */
const DRAWIO_C4_SIZES: Record<Kind, { width: number; height: number }> = {
  person: { width: 200, height: 180 },
  software_system: { width: 240, height: 120 },
  container: { width: 240, height: 120 },
  component: { width: 240, height: 120 },
};

/**
 * Pontos de conexão das shapes C4 oficiais (12 pontos no perímetro). Sem eles
 * o draw.io não permite conectar relações nas laterais como na biblioteca.
 */
const DRAWIO_C4_POINTS =
  'points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];';

/** Estilos copiados da paleta C4 oficial do draw.io (`Sidebar-C4.js`). */
const DRAWIO_C4_STYLES: Record<Kind, string> = {
  person:
    'html=1;fontSize=11;dashed=0;whiteSpace=wrap;fillColor=#083F75;strokeColor=#06315C;fontColor=#ffffff;shape=mxgraph.c4.person2;align=center;metaEdit=1;resizable=0;' +
    'points=[[0.5,0,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0]];',
  software_system:
    'rounded=1;whiteSpace=wrap;html=1;labelBackgroundColor=none;fillColor=#1061B0;fontColor=#ffffff;align=center;arcSize=10;strokeColor=#0D5091;metaEdit=1;resizable=0;roundedPerimeter=1;' +
    DRAWIO_C4_POINTS,
  container:
    'rounded=1;whiteSpace=wrap;html=1;fontSize=11;labelBackgroundColor=none;fillColor=#23A2D9;fontColor=#ffffff;align=center;arcSize=10;strokeColor=#0E7DAD;metaEdit=1;resizable=0;roundedPerimeter=1;' +
    DRAWIO_C4_POINTS,
  component:
    'rounded=1;whiteSpace=wrap;html=1;labelBackgroundColor=none;fillColor=#63BEF2;fontColor=#ffffff;align=center;arcSize=6;strokeColor=#2086C9;metaEdit=1;resizable=0;roundedPerimeter=1;' +
    DRAWIO_C4_POINTS,
};

/**
 * Rótulos oficiais da biblioteca C4: o draw.io substitui `%c4Name%`,
 * `%c4Type%`, `%c4Technology%` e `%c4Description%` pelos atributos do objeto.
 */
const DRAWIO_C4_LABEL: Record<Kind, string> = {
  person:
    '<font style="font-size: 16px"><b>%c4Name%</b></font><div>[%c4Type%]</div><br><div><font style="font-size: 11px"><font color="#cccccc">%c4Description%</font></div>',
  software_system:
    '<font style="font-size: 16px"><b>%c4Name%</b></font><div>[%c4Type%]</div><br><div><font style="font-size: 11px"><font color="#cccccc">%c4Description%</font></div>',
  container:
    '<font style="font-size: 16px"><b>%c4Name%</b></font><div>[%c4Type%: %c4Technology%]</div><br><div><font style="font-size: 11px"><font color="#E6E6E6">%c4Description%</font></div>',
  component:
    '<font style="font-size: 16px"><b>%c4Name%</b></font><div>[%c4Type%: %c4Technology%]</div><br><div><font style="font-size: 11px">%c4Description%</font></div>',
};

const DRAWIO_C4_TYPE: Record<Kind, string> = {
  person: 'Person',
  software_system: 'Software System',
  container: 'Container',
  component: 'Component',
};

/** Boundary oficial do draw.io (System/Container scope boundary). */
const DRAWIO_C4_BOUNDARY_STYLE =
  'rounded=1;fontSize=11;whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=#666666;fontColor=#333333;labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 4;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;' +
  DRAWIO_C4_POINTS;

const DRAWIO_C4_BOUNDARY_LABEL =
  '<font style="font-size: 16px"><b><div style="text-align: left">%c4Name%</div></b></font><div style="text-align: left">[%c4Application%]</div>';

/** Relação C4 oficial do draw.io. */
const DRAWIO_C4_RELATIONSHIP_STYLE =
  'endArrow=blockThin;html=1;fontSize=10;fontColor=#404040;strokeWidth=1;endFill=1;strokeColor=#828282;elbow=vertical;metaEdit=1;endSize=14;startSize=14;jumpStyle=arc;jumpSize=16;rounded=0;edgeStyle=orthogonalEdgeStyle;labelBackgroundColor=#ffffff;';

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

function relationshipTechnology(edge: GraphEdge): string | null {
  const declared = typeof edge.technology === 'string' ? edge.technology.trim() : '';
  return declared || extractTechnologyFromLabel(edge.label);
}

/** Tags canônicas guardadas em `metadata.tags` (C4 `$tags="a+b"`). */
function tagsOf(element: GraphElement): string[] {
  const value = metadataOf(element).tags;
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function plantUmlTags(tags: string[]): string {
  return tags.length > 0 ? `, $tags="${escapePlantUml(tags.join('+'))}"` : '';
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

/** Texto de diretiva PlantUML entre aspas, com escapes explícitos. */
function quotePlantUmlText(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
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

/** Duas caixas se sobrepõem quando os retângulos se cruzam em ambos os eixos. */
function hasOverlappingBoxes(boxes: LayoutBox[]): boolean {
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
      const overlapY = a.y < b.y + b.height && b.y < a.y + a.height;
      if (overlapX && overlapY) return true;
    }
  }
  return false;
}

function resolveRenderedGraph(
  graph: ModelGraph,
  sizeFor: (kind: Kind) => { width: number; height: number } = () => ({
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }),
  options: { reflowOnOverlap?: boolean } = {}
): RenderedGraph {
  const elements = graph.elements;
  const stored = hasStoredLayout(
    elements.map((element) => ({ position_x: element.position_x, position_y: element.position_y }))
  );

  const buildBoxes = (positions: Map<string, { x: number; y: number }>): LayoutBox[] =>
    elements.map((element) => {
      const position = positions.get(element.id) ?? { x: 0, y: 0 };
      const kind = kindOf(element);
      const size = sizeFor(kind);
      return {
        element,
        kind,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      };
    });

  const autoLayout = (nodeWidth: number, nodeHeight: number): Map<string, { x: number; y: number }> => {
    const auto = computeAutoLayout(
      elements.map((element) => ({ id: element.id, type: element.type, title: element.title })),
      graph.edges.map((edge) => ({ from: edge.from_id, to: edge.to_id })),
      { direction: 'LR', nodeWidth, nodeHeight, gapX: 90, gapY: 32 }
    );
    return new Map(auto.map((position) => [position.id, { x: position.x, y: position.y }]));
  };

  let boxes = buildBoxes(
    stored
      ? new Map(
          elements.map((element) => [element.id, { x: element.position_x, y: element.position_y }])
        )
      : autoLayout(NODE_WIDTH, NODE_HEIGHT)
  );

  // As shapes oficiais do C4 são maiores que as caixas genéricas usadas pelo
  // autolayout original. Um layout salvo pode, então, sobrepor duas pessoas ou
  // um sistema e um container. Nesse caso o desenho é refeito com as dimensões
  // reais para o editor abrir legível.
  if (options.reflowOnOverlap && hasOverlappingBoxes(boxes)) {
    const maxWidth = Math.max(...elements.map((element) => sizeFor(kindOf(element)).width));
    const maxHeight = Math.max(...elements.map((element) => sizeFor(kindOf(element)).height));
    boxes = buildBoxes(autoLayout(maxWidth, maxHeight));
  }

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

/** C4-PlantUML. */
export function renderPlantUml(graph: ModelGraph): string {
  const lines: string[] = [];
  const kind = (element: GraphElement): Kind => kindOf(element);

  const hasComponents = graph.elements.some((element) => kind(element) === 'component');
  const include = hasComponents
    ? 'C4_Component'
    : graph.elements.some((element) => kind(element) === 'container')
      ? 'C4_Container'
      : 'C4_Context';

  lines.push('@startuml');
  // Usa a biblioteca C4-PlantUML empacotada no servidor PlantUML. A forma
  // `<C4/...>` não depende de acesso à internet (o include via raw.github
  // falhava com 400 em ambientes sem saída externa).
  lines.push(`!include <C4/${include}>`);
  lines.push(`title ${quotePlantUmlText(modelTitle(graph))}`);
  if (modelDescription(graph)) {
    lines.push(`caption ${quotePlantUmlText(modelDescription(graph) ?? '')}`);
  }

  const identifiers = new Map<string, string>();
  const usedAliases = new Set<string>();

  // Aliases: usa o identificador canônico quando existe para que exportar,
  // editar e aplicar de novo mantenha os mesmos identificadores (e, com eles,
  // o layout das views e os vínculos com apps/serviços). Elementos sem
  // identificador caem em `e0`, `e1`...
  const aliasOf = (raw: string): string => {
    const sanitized = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, 'e_$1');
    const base = sanitized.slice(0, 60) || 'e';
    let alias = base;
    let suffix = 2;
    while (usedAliases.has(alias)) alias = `${base}_${suffix++}`;
    usedAliases.add(alias);
    return alias;
  };

  for (const element of graph.elements) {
    const raw = element.identifier?.trim();
    if (!raw) continue;
    identifiers.set(element.id, aliasOf(raw));
  }

  let index = 0;
  for (const element of graph.elements) {
    if (identifiers.has(element.id)) continue;
    let alias = `e${index++}`;
    while (usedAliases.has(alias)) alias = `e${index++}`;
    usedAliases.add(alias);
    identifiers.set(element.id, alias);
  }

  // Hierarquia: `parent_element_id` agrupa os filhos no bloco do pai
  // (`System(...) { ... }`, `Container(...) { ... }`), preservando a estrutura
  // importada do PlantUML em vez de achatá-la na exportação.
  const elementIds = new Set(graph.elements.map((element) => element.id));
  const elementById = new Map(graph.elements.map((element) => [element.id, element]));
  const nestable = (element: GraphElement): boolean => kind(element) !== 'person';
  const childrenByParent = new Map<string, GraphElement[]>();
  const roots: GraphElement[] = [];
  const orderIndex = new Map(graph.elements.map((element, position) => [element.id, position]));

  for (const element of graph.elements) {
    const parentId = element.parent_element_id;
    const parent =
      parentId && parentId !== element.id && elementIds.has(parentId)
        ? elementById.get(parentId)
        : undefined;
    if (!parent || !nestable(parent)) {
      roots.push(element);
      continue;
    }
    const list = childrenByParent.get(parent.id) ?? [];
    list.push(element);
    childrenByParent.set(parent.id, list);
  }

  for (const list of childrenByParent.values()) {
    list.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
  }
  roots.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

  const emitted = new Set<string>();
  const emit = (element: GraphElement, depth: number): void => {
    if (emitted.has(element.id)) return;
    emitted.add(element.id);

    const id = identifiers.get(element.id) ?? element.id;
    const indent = '  '.repeat(depth);
    const children = childrenByParent.get(element.id) ?? [];
    const name = escapePlantUml(element.title);
    const description = escapePlantUml(element.description ?? '');
    const technology = technologyOf(element);
    const tags = plantUmlTags(tagsOf(element));
    const elementKind = kind(element);

    // Um elemento com filhos é desenhado como boundary oficial do C4-PlantUML,
    // exatamente como no draw.io. Sem isso o preview aninharia um `System(...)`
    // dentro de outro e o nível apareceria como caixa sólida em vez de fronteira.
    if (children.length > 0 && elementKind !== 'person') {
      if (elementKind === 'software_system') {
        lines.push(`${indent}System_Boundary(${id}, "${name}"${tags}) {`);
      } else if (elementKind === 'container') {
        lines.push(`${indent}Container_Boundary(${id}, "${name}"${tags}) {`);
      } else {
        lines.push(`${indent}Boundary(${id}, "${name}", "Component"${tags}) {`);
      }
      for (const child of children) emit(child, depth + 1);
      lines.push(`${indent}}`);
      return;
    }

    switch (elementKind) {
      case 'person':
        lines.push(`${indent}Person(${id}, "${name}", "${description}"${tags})`);
        break;
      case 'software_system':
        lines.push(`${indent}System(${id}, "${name}", "${description}"${tags})`);
        break;
      case 'container':
        lines.push(
          `${indent}Container(${id}, "${name}", "${technology ? escapePlantUml(technology) : ''}", "${description}"${tags})`
        );
        break;
      default:
        lines.push(
          `${indent}Component(${id}, "${name}", "${technology ? escapePlantUml(technology) : ''}", "${description}"${tags})`
        );
    }
  };

  for (const element of roots) emit(element, 0);
  // Elementos órfãos de um ciclo de hierarquia nunca ficam de fora.
  for (const element of graph.elements) emit(element, 0);

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

/**
 * Detecta XML inválido por `<` cru dentro do valor de um atributo — exatamente
 * o erro que o draw.io reporta como "não é um arquivo de diagrama". Labels HTML
 * (`<b>`, `<span>`) precisam ser escapados como entidades no atributo.
 */
export function hasRawAngleInAttribute(xml: string): boolean {
  let inTag = false;
  let quote: '"' | "'" | null = null;

  for (const char of xml) {
    if (!inTag) {
      if (char === '<') inTag = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '<') {
        return true;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      inTag = false;
    }
  }
  return false;
}

/** XML draw.io plausível e bem formado o suficiente para abrir no editor. */
export function isUsableDrawioXml(xml: string | null | undefined): boolean {
  if (typeof xml !== 'string') return false;
  const trimmed = xml.trim();
  if (!trimmed) return false;
  if (hasRawAngleInAttribute(trimmed)) return false;
  return /<mxfile[\s>]/i.test(trimmed) || /<mxGraphModel[\s>]/i.test(trimmed);
}

/*
 * Rótulos oficiais do draw.io/C4 declarados em `DRAWIO_C4_LABEL` e
 * `DRAWIO_C4_BOUNDARY_LABEL`. Os textos são resolvidos pelo próprio editor a
 * partir de `c4Name`, `c4Type`, `c4Technology` e `c4Description`; o parser do
 * DAS aplica os mesmos placeholders ao ler o XML.
 */

/** Rótulo oficial de relação: descrição em negrito e tecnologia entre colchetes. */
function drawioRelationshipLabel(hasDescription: boolean, hasTechnology: boolean): string {
  const description = hasDescription
    ? '<div style="text-align: center"><b>%c4Description%</b></div>'
    : '';
  const technology = hasTechnology
    ? '<div style="text-align: center">[%c4Technology%]</div>'
    : '';
  if (!description && !technology) return '';
  return `<div style="text-align: left">${description}${technology}</div>`;
}

/**
 * Mapeia filho → pai apenas para hierarquias que o draw.io consegue agrupar.
 * Pessoas não são containers no C4 e ciclos são ignorados ao subir a árvore.
 */
function parentElementMap(elements: GraphElement[]): Map<string, string> {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const parents = new Map<string, string>();

  for (const element of elements) {
    const parentId = element.parent_element_id;
    if (!parentId || parentId === element.id) continue;
    const parent = byId.get(parentId);
    if (!parent || kindOf(parent) === 'person') continue;
    parents.set(element.id, parentId);
  }

  return parents;
}

function isDescendantOf(
  elementId: string,
  ancestorId: string,
  parents: Map<string, string>
): boolean {
  const seen = new Set<string>();
  let cursor = parents.get(elementId);
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestorId) return true;
    seen.add(cursor);
    cursor = parents.get(cursor);
  }
  return false;
}

function hierarchyDepth(elementId: string, parents: Map<string, string>): number {
  const seen = new Set<string>();
  let depth = 0;
  let cursor = parents.get(elementId);
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    depth += 1;
    cursor = parents.get(cursor);
  }
  return depth;
}

/**
 * XML draw.io no padrão C4.
 *
 * Usa as shapes oficiais da biblioteca C4 do draw.io (`person2`, sistema,
 * container e componente), o rótulo de três linhas do C4 model, boundaries
 * pontilhadas para a hierarquia preservada pelo PlantUML e o estilo oficial
 * de relação. Os IDs estáveis (`c4archElementId`) continuam presentes para
 * que o adapter e as inspeções reconheçam as formas.
 */
export function renderDrawio(graph: ModelGraph): string {
  const rendered = resolveRenderedGraph(graph, (kind) => DRAWIO_C4_SIZES[kind], {
    reflowOnOverlap: true,
  });
  const offsetX = MARGIN;
  const offsetY = MARGIN + 42;
  const pageWidth = Math.ceil(rendered.width + 80);
  const pageHeight = Math.ceil(rendered.height + 120);

  const boxById = new Map(rendered.boxes.map((box) => [box.element.id, box]));
  const parents = parentElementMap(graph.elements);
  const parentIds = new Set(parents.values());

  const cells: string[] = [];
  cells.push('<mxCell id="0"/>');
  cells.push('<mxCell id="1" parent="0"/>');

  interface BoundaryLayout {
    box: LayoutBox;
    x: number;
    y: number;
    width: number;
    height: number;
    depth: number;
  }

  // Boundaries são desenhadas primeiro para ficarem atrás dos elementos.
  const boundaries: BoundaryLayout[] = [];
  for (const parentId of parentIds) {
    const parentBox = boxById.get(parentId);
    if (!parentBox) continue;
    const members = rendered.boxes.filter((box) =>
      isDescendantOf(box.element.id, parentId, parents)
    );
    if (members.length === 0) continue;

    const minX = Math.min(...members.map((box) => box.x)) - 24;
    const minY = Math.min(...members.map((box) => box.y)) - 32;
    const maxX = Math.max(...members.map((box) => box.x + box.width)) + 24;
    const maxY = Math.max(...members.map((box) => box.y + box.height)) + 48;

    boundaries.push({
      box: parentBox,
      x: offsetX + minX,
      y: offsetY + minY,
      width: maxX - minX,
      height: maxY - minY,
      depth: hierarchyDepth(parentId, parents),
    });
  }
  boundaries.sort((a, b) => a.depth - b.depth || a.y - b.y || a.x - b.x);

  for (const boundary of boundaries) {
    const { box } = boundary;
    const attributes = [
      `id="c4arch-${escapeXml(box.element.id)}"`,
      `label="${escapeXml(DRAWIO_C4_BOUNDARY_LABEL)}"`,
      'placeholders="1"',
      `c4archElementId="${escapeXml(box.element.id)}"`,
      'c4archType="boundary"',
      `c4Name="${escapeXml(box.element.title || '')}"`,
      `c4Type="${escapeXml(DRAWIO_C4_TYPE[box.kind])}"`,
      `c4Application="${escapeXml(DRAWIO_C4_TYPE[box.kind])}"`,
    ];
    const description = (box.element.description ?? '').trim();
    if (description) attributes.push(`c4Description="${escapeXml(description)}"`);

    cells.push(`<object ${attributes.join(' ')}>`);
    cells.push(
      `  <mxCell id="boundary-${escapeXml(box.element.id)}" style="${DRAWIO_C4_BOUNDARY_STYLE}" vertex="1" parent="1">`
    );
    cells.push(
      `    <mxGeometry x="${boundary.x}" y="${boundary.y}" width="${boundary.width}" height="${boundary.height}" as="geometry"/>`
    );
    cells.push('  </mxCell>');
    cells.push('</object>');
  }

  for (const box of rendered.boxes) {
    // O elemento estrutural que veio de um bloco/boundary do PlantUML é
    // representado pela boundary; desenhar também a caixa sólida duplicaria
    // o mesmo elemento no diagrama.
    const hasChildren = rendered.boxes.some((candidate) =>
      isDescendantOf(candidate.element.id, box.element.id, parents)
    );
    if (parentIds.has(box.element.id) && hasChildren) continue;

    const objectId = `c4arch-${box.element.id}`;
    const technology = technologyOf(box.element);
    const description = (box.element.description ?? '').trim();
    const attributes = [
      `id="${escapeXml(objectId)}"`,
      `label="${escapeXml(DRAWIO_C4_LABEL[box.kind])}"`,
      'placeholders="1"',
      `c4archElementId="${escapeXml(box.element.id)}"`,
      `c4archType="${box.kind}"`,
      `c4Name="${escapeXml(box.element.title || '')}"`,
      `c4Type="${escapeXml(DRAWIO_C4_TYPE[box.kind])}"`,
    ];
    if (technology) attributes.push(`c4Technology="${escapeXml(technology)}"`);
    if (description) attributes.push(`c4Description="${escapeXml(description)}"`);

    cells.push(`<object ${attributes.join(' ')}>`);
    cells.push(
      `  <mxCell id="shape-${escapeXml(box.element.id)}" style="${DRAWIO_C4_STYLES[box.kind]}" vertex="1" parent="1">`
    );
    cells.push(
      `    <mxGeometry x="${offsetX + box.x}" y="${offsetY + box.y}" width="${box.width}" height="${box.height}" as="geometry"/>`
    );
    cells.push('  </mxCell>');
    cells.push('</object>');
  }

  for (const { edge, from, to } of rendered.edges) {
    const technology = relationshipTechnology(edge) ?? '';
    const label = (edge.label ?? '').trim();
    const showTechnology = Boolean(technology) && !label.includes(`[${technology}]`);
    const attributes = [
      `id="edge-${escapeXml(edge.id)}"`,
      `label="${escapeXml(drawioRelationshipLabel(Boolean(label), showTechnology))}"`,
      'placeholders="1"',
      'c4Type="Relationship"',
    ];
    if (label) attributes.push(`c4Description="${escapeXml(label)}"`);
    if (technology) attributes.push(`c4Technology="${escapeXml(technology)}"`);

    cells.push(`<object ${attributes.join(' ')}>`);
    cells.push(
      `  <mxCell id="edge-cell-${escapeXml(edge.id)}" style="${DRAWIO_C4_RELATIONSHIP_STYLE}" edge="1" parent="1" source="c4arch-${escapeXml(from.element.id)}" target="c4arch-${escapeXml(to.element.id)}">`
    );
    cells.push('    <mxGeometry relative="1" as="geometry"/>');
    cells.push('  </mxCell>');
    cells.push('</object>');
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
