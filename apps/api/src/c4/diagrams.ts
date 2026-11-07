import { isC4ModelType, type C4ModelType } from './model-types.js';

export interface ModelDiagram {
  c4Type: C4ModelType;
  drawioXml?: string | null;
}

/** Normaliza a coluna JSONB `diagrams` (array de tipos de diagrama extras). */
export function parseDiagrams(value: unknown): ModelDiagram[] {
  let raw: unknown = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is { c4Type?: unknown; drawioXml?: unknown } => !!item && typeof item === 'object')
    .map((item) => ({
      c4Type: item.c4Type as C4ModelType,
      drawioXml: typeof item.drawioXml === 'string' ? item.drawioXml : null,
    }))
    .filter((item) => isC4ModelType(item.c4Type));
}

/** Retorna o XML de um tipo de diagrama, considerando o primário (`c4_type`). */
export function resolveDiagramXml(
  model: { c4_type?: string | null; drawio_xml?: string | null; diagrams?: unknown },
  c4Type: string
): string | null {
  if (model.c4_type === c4Type) {
    return typeof model.drawio_xml === 'string' ? model.drawio_xml : null;
  }
  const diagram = parseDiagrams(model.diagrams).find((d) => d.c4Type === c4Type);
  return diagram?.drawioXml ?? null;
}

/** Atualiza o XML de um tipo de diagrama (primário ou extra). */
export function withDiagramXml(
  model: { c4_type?: string | null; diagrams?: unknown },
  c4Type: string,
  xml: string
): ModelDiagram[] {
  return parseDiagrams(model.diagrams).map((d) =>
    d.c4Type === c4Type ? { ...d, drawioXml: xml } : d
  );
}
