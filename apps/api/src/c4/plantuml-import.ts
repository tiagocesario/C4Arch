/**
 * Importação de diagramas C4-PlantUML.
 */
import type { ImportedElement, ImportedRelationship, ImportedView, ImportedWorkspace } from './structurizr-import.js';
import type { CanonicalElementKind, CanonicalViewType } from './canonical.js';

export type PlantUmlFormat = 'plantuml';

const KIND_BY_MACRO: Record<string, CanonicalElementKind> = {
  person: 'person',
  person_ext: 'person',
  system: 'software_system',
  system_ext: 'software_system',
  systemdb: 'software_system',
  systemqueue: 'software_system',
  container: 'container',
  container_ext: 'container',
  containerdb: 'container',
  containerqueue: 'container',
  component: 'component',
  component_ext: 'component',
  componentdb: 'component',
  componentqueue: 'component',
};

function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let depth = 0;
  for (const char of input) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') { depth++; current += char; continue; }
    if (char === ')') { depth--; current += char; continue; }
    if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function unquote(value: string | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeAlias(value: string | undefined): string {
  return unquote(value).trim();
}

function detectViewType(content: string): CanonicalViewType {
  const lower = content.toLowerCase();
  if (lower.includes('c4_component')) return 'component';
  if (lower.includes('c4_container')) return 'container';
  if (lower.includes('c4_dynamic')) return 'dynamic';
  if (lower.includes('c4_deployment')) return 'deployment';
  return 'system_context';
}

export function detectPlantUmlFormat(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.includes('@startuml') || (lower.includes('!include') && lower.includes('c4'));
}

export function parsePlantUmlWorkspace(content: string): ImportedWorkspace {
  const elements: ImportedElement[] = [];
  const relationships: ImportedRelationship[] = [];
  const identifiers = new Set<string>();
  let name: string | null = null;
  let description: string | null = null;

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("'")) continue;
    if (line.toLowerCase().startsWith('@') || line.toLowerCase().startsWith('!')) continue;

    const titleMatch = /^(?:title|Title)\s*\(?\s*"([^"]*)"\s*\)?/.exec(line);
    if (titleMatch) {
      name = titleMatch[1];
      continue;
    }

    const macroMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*$/.exec(line);
    if (macroMatch) {
      const macro = macroMatch[1].toLowerCase();
      const kind = KIND_BY_MACRO[macro];
      if (kind) {
        const args = splitArgs(macroMatch[2]);
        const alias = normalizeAlias(args[0]);
        if (!alias || identifiers.has(alias)) continue;
        identifiers.add(alias);
        const label = unquote(args[1]) || alias;
        const technology = (macro.startsWith('container') || macro.startsWith('component'))
          ? (unquote(args[2]) || null)
          : null;
        const descIndex = (macro.startsWith('container') || macro.startsWith('component')) ? 3 : 2;
        const desc = unquote(args[descIndex]) || null;
        elements.push({
          identifier: alias,
          kind,
          name: label,
          description: desc,
          technology,
          tags: [],
          url: null,
          parentIdentifier: null,
        });
        continue;
      }

      if (macro.startsWith('rel') || macro === 'birel' || macro === 'rel_back') {
        const args = splitArgs(macroMatch[2]);
        if (args.length >= 3) {
          const from = normalizeAlias(args[0]);
          const to = normalizeAlias(args[1]);
          const label = unquote(args[2]);
          const technology = unquote(args[3]) || null;
          relationships.push({
            sourceIdentifier: from,
            targetIdentifier: to,
            description: label || null,
            technology,
          });
        }
        continue;
      }
    }
  }

  const viewType = detectViewType(content);
  const view: ImportedView = {
    key: 'default',
    type: viewType,
    title: name,
    scopeIdentifier: null,
  };

  return {
    name,
    description,
    elements,
    relationships,
    views: [view],
  };
}
