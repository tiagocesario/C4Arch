import type { ModelDiagram } from '../services/types';

/** Usa o XML do diagrama primário ou, se vazio, o primeiro tipo com desenho. */
export function firstDiagramXml(model: {
  drawioXml?: string | null;
  diagrams?: ModelDiagram[];
}): string | null {
  if (model.drawioXml) return model.drawioXml;
  return model.diagrams?.find((diagram) => diagram.drawioXml)?.drawioXml ?? null;
}

export interface DasSection {
  heading: string;
  body: string;
}

/**
 * Separa o cabeçalho (metadados antes do primeiro `##`) das seções de nível 2.
 * O DAS gerado pela API usa `##` para cada seção do documento.
 */
export function parseDasSections(content: string): { preamble: string; sections: DasSection[] } {
  const lines = content.split('\n');
  const sections: DasSection[] = [];
  const preamble: string[] = [];
  let current: DasSection | null = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), body: '' };
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line;
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current);
  return { preamble: preamble.join('\n'), sections };
}

export function buildDasFromSections(preamble: string, sections: DasSection[]): string {
  const parts: string[] = [];
  if (preamble.trim()) parts.push(preamble);
  for (const section of sections) {
    parts.push(`## ${section.heading}\n\n${section.body}`);
  }
  return parts.join('\n\n');
}
