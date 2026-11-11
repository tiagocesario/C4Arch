import { expandCompressedDiagrams, parseAttributes } from './das.js';

/**
 * Extrai geometria e chaves de formas de um XML draw.io para o
 * `model_view_layout` canônico.
 *
 * A extração é best-effort: o objetivo é preservar posições e tamanhos das
 * formas já desenhadas, não reinterpretar o desenho como modelo. Formas sem
 * `c4archElementId` continuam sendo anotações visuais (`object_key`).
 */

export interface LayoutShape {
  objectKey: string;
  elementRef: string | null;
  name: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  style: Record<string, unknown>;
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstLine(value: string): string | null {
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function extractName(value: string): string | null {
  const line = firstLine(value);
  if (!line) return null;
  const bracket = /^\[([^\]]+?):\s*(.+?)\]$/.exec(line);
  if (bracket) return bracket[2].trim() || null;
  const trailingType = /^(.*\S)\s*\[[^\]]*\]\s*$/.exec(line);
  return (trailingType ? trailingType[1] : line).trim() || null;
}

function parseStyle(value: string | undefined): Record<string, unknown> {
  const style = value?.trim();
  return style ? { drawio: style } : {};
}

function geometryAttributes(tag: string | undefined): Record<string, string> {
  return tag ? parseAttributes(tag) : {};
}

/**
 * Retorna as formas (vértices) do XML. Células de camada (`id=0`/`id=1`) e
 * arestas são ignoradas.
 */
export function extractDiagramLayout(xml: string | null | undefined): LayoutShape[] {
  if (!xml) return [];

  const expanded = expandCompressedDiagrams(xml);
  const shapes: LayoutShape[] = [];
  const objectSpans: Array<[number, number]> = [];
  const usedKeys = new Map<string, number>();

  const uniqueKey = (key: string): string => {
    const count = usedKeys.get(key) ?? 0;
    usedKeys.set(key, count + 1);
    return count === 0 ? key : `${key}#${count + 1}`;
  };

  // Objetos com metadados (shapes da biblioteca c4arch).
  const objectRegex = /<(object|UserObject)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let objectMatch: RegExpExecArray | null;
  while ((objectMatch = objectRegex.exec(expanded)) !== null) {
    objectSpans.push([objectMatch.index, objectMatch.index + objectMatch[0].length]);

    const attributes = parseAttributes(objectMatch[2]);
    const inner = objectMatch[3];
    const cellTag = inner.match(/<mxCell\b[^>]*>/i)?.[0] ?? '';
    if (!/vertex\s*=\s*"1"/i.test(cellTag)) continue;

    const cellAttributes = parseAttributes(cellTag);
    const geometry = geometryAttributes(inner.match(/<mxGeometry\b[^>]*>/i)?.[0]);
    const label = attributes.label ?? cellAttributes.value ?? '';
    const key = attributes.id || cellAttributes.id || `object-${shapes.length}`;

    shapes.push({
      objectKey: uniqueKey(key),
      elementRef: attributes.c4archElementId ?? cellAttributes.c4archElementId ?? null,
      name: extractName(label),
      x: toNumber(geometry.x),
      y: toNumber(geometry.y),
      width: toNumber(geometry.width),
      height: toNumber(geometry.height),
      style: parseStyle(cellAttributes.style),
    });
  }

  // Células nativas do draw.io, ignorando as que já estão dentro de <object>.
  const cellRegex = /<mxCell\b[^>]*>/gi;
  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellRegex.exec(expanded)) !== null) {
    const insideObject = objectSpans.some(
      ([start, end]) => cellMatch!.index >= start && cellMatch!.index < end
    );
    if (insideObject) continue;

    const tag = cellMatch[0];
    const attributes = parseAttributes(tag);
    if (!/vertex\s*=\s*"1"/i.test(tag)) continue;

    const id = attributes.id ?? '';
    if (!id || id === '0' || id === '1') continue;

    const rest = expanded.slice(cellMatch.index + tag.length);
    const cellEnd = rest.search(/<\/mxCell>|<mxCell\b/i);
    const cellBody = cellEnd >= 0 ? rest.slice(0, cellEnd) : rest.slice(0, 2000);
    const geometry = geometryAttributes(cellBody.match(/<mxGeometry\b[^>]*>/i)?.[0]);

    shapes.push({
      objectKey: uniqueKey(id),
      elementRef: attributes.c4archElementId ?? null,
      name: extractName(attributes.value ?? ''),
      x: toNumber(geometry.x),
      y: toNumber(geometry.y),
      width: toNumber(geometry.width),
      height: toNumber(geometry.height),
      style: parseStyle(attributes.style),
    });
  }

  return shapes;
}
