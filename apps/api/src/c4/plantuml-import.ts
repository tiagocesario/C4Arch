import type {
  ImportedElement,
  ImportedRelationship,
  ImportedView,
  ImportedWorkspace,
} from './model-import.js';
import type { CanonicalElementKind, CanonicalViewType } from './canonical.js';

/**
 * Importador de PlantUML/C4-PlantUML.
 *
 * O formato canônico do C4Arch guarda semântica (elementos, relações e views),
 * não o texto-fonte. Este módulo converte tanto as macros C4 quanto a sintaxe
 * genérica do PlantUML para essa semântica. O texto continua sendo uma
 * projeção: elementos e relações reconhecidos são preservados; comentários e
 * formatação são descartados.
 */

const KIND_BY_MACRO: Record<string, CanonicalElementKind> = {
  person: 'person',
  person_ext: 'person',
  actor: 'person',
  system: 'software_system',
  system_ext: 'software_system',
  systemdb: 'software_system',
  systemdb_ext: 'software_system',
  systemqueue: 'software_system',
  systemqueue_ext: 'software_system',
  external_system: 'software_system',
  software_system: 'software_system',
  container: 'container',
  container_ext: 'container',
  containerdb: 'container',
  containerdb_ext: 'container',
  containerqueue: 'container',
  containerqueue_ext: 'container',
  service: 'container',
  component: 'component',
  component_ext: 'component',
  componentdb: 'component',
  componentdb_ext: 'component',
  componentqueue: 'component',
  componentqueue_ext: 'component',
  deployment_node: 'deployment_node',
  node: 'deployment_node',
  node_ext: 'deployment_node',
  infrastructure_node: 'infrastructure_node',
  container_instance: 'container_instance',
  system_instance: 'software_system_instance',
};

/** Elementos genéricos do PlantUML e sua equivalência no modelo canônico. */
const KIND_BY_GENERIC_DECLARATION: Record<string, CanonicalElementKind> = {
  actor: 'person',
  usecase: 'component',
  rectangle: 'software_system',
  component: 'component',
  interface: 'component',
  database: 'container',
  queue: 'container',
  cloud: 'deployment_node',
  node: 'deployment_node',
  folder: 'container',
  frame: 'container',
  artifact: 'component',
};

const RELATION_MACROS = new Set([
  'rel',
  'rel_u',
  'rel_d',
  'rel_l',
  'rel_r',
  'rel_neighbor',
  'rel_back',
  'rel_back_u',
  'rel_back_d',
  'rel_back_l',
  'rel_back_r',
  'rel_back_neighbor',
  'birel',
  'birel_u',
  'birel_d',
  'birel_l',
  'birel_r',
  'birel_neighbor',
]);

/** Macros C4 que mantêm a ordem dos argumentos, mas invertem a seta. */
const REVERSE_RELATION_MACROS = new Set([
  'rel_back',
  'rel_back_u',
  'rel_back_d',
  'rel_back_l',
  'rel_back_r',
  'rel_back_neighbor',
]);

/** Macros C4 que criam uma relação em cada sentido. */
const BIDIRECTIONAL_RELATION_MACROS = new Set([
  'birel',
  'birel_u',
  'birel_d',
  'birel_l',
  'birel_r',
  'birel_neighbor',
]);

const BOUNDARY_MACROS = new Set([
  'boundary',
  'system_boundary',
  'enterprise_boundary',
  'container_boundary',
  'component_boundary',
]);

const GENERIC_ARROWS = [
  '<-->',
  '<--',
  '-->',
  '<..',
  '..>',
  '--|>',
  '<|--',
  '-|>',
  '|-',
  '->',
  '<-',
  '=>',
  '<=',
  'o--',
  '--o',
  'x--',
  '--x',
  '--',
  '..',
];

interface ParsedArguments {
  positional: string[];
  named: Map<string, string>;
}

function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let depth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      current += char;
      if (char === '\\' && index + 1 < input.length) {
        current += input[index + 1];
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ')' || char === ']') {
      depth -= 1;
      current += char;
      continue;
    }
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

function parseArguments(args: string[]): ParsedArguments {
  const positional: string[] = [];
  const named = new Map<string, string>();

  for (const arg of args) {
    const match = /^\s*\$?([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(arg);
    if (match) {
      named.set(match[1].toLowerCase(), match[2]);
    } else {
      positional.push(arg);
    }
  }

  return { positional, named };
}

function unquote(value: string | undefined): string {
  if (!value) return '';
  let result = value.trim();
  if (
    (result.startsWith('"') && result.endsWith('"')) ||
    (result.startsWith("'") && result.endsWith("'"))
  ) {
    result = result.slice(1, -1);
  }
  return result.replace(/\\(["'\\])/g, '$1').replace(/\\n/g, '\n');
}

function namedValue(
  args: ParsedArguments,
  names: string[],
  positionalIndex: number
): string | undefined {
  for (const name of names) {
    const value = args.named.get(name);
    if (value !== undefined) return value;
  }
  return args.positional[positionalIndex];
}

function identifierFromLabel(label: string): string {
  const normalized = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'elemento';
}

function normalizeAlias(value: string | undefined): string {
  return unquote(value).trim();
}

/**
 * Extrai o título do diagrama. PlantUML aceita `title Texto`, `title "Texto"`
 * e `title("Texto")`; a forma com aspas preserva espaços e pontuação.
 */
function parseTitle(line: string): string | null {
  const quoted = /^title\s*\(?\s*"([^"]*)"\s*\)?$/i.exec(line);
  if (quoted) return quoted[1].trim() || null;
  const plain = /^title\s+(.+)$/i.exec(line);
  if (plain) {
    const value = plain[1].trim();
    if (value.startsWith('"') && value.endsWith('"')) return unquote(value) || null;
    return value || null;
  }
  return null;
}

function parseCaption(line: string): string | null {
  const match = /^caption\s+(.+)$/i.exec(line);
  return match ? unquote(match[1]) || null : null;
}

function detectViewType(content: string): CanonicalViewType {
  const lower = content.toLowerCase();
  if (lower.includes('c4_component')) return 'component';
  if (lower.includes('c4_container')) return 'container';
  if (lower.includes('c4_dynamic')) return 'dynamic';
  if (lower.includes('c4_deployment')) return 'deployment';
  return 'system_context';
}

/**
 * Detecta um fonte PlantUML válido. Um include C4 isolado também é aceito
 * para manter a compatibilidade com os templates e com o contrato anterior.
 */
export function detectPlantUmlFormat(content: string): boolean {
  return /@startuml\b/i.test(content) || /!include\s+<?c4\//i.test(content);
}

/** Remove comentários de linha e blocos sem alterar aspas do diagrama. */
function stripComments(content: string): string[] {
  const output: string[] = [];
  let inBlockComment = false;

  for (const rawLine of content.split(/\r?\n/)) {
    let line = '';
    let quote: '"' | "'" | null = null;

    for (let index = 0; index < rawLine.length; index += 1) {
      const char = rawLine[index];
      const next = rawLine[index + 1];

      if (inBlockComment) {
        if (char === "'" && next === '/') {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        line += char;
        if (char === '\\' && next !== undefined) {
          line += next;
          index += 1;
          continue;
        }
        if (char === quote) quote = null;
        continue;
      }

      if (char === '/' && next === "'") {
        inBlockComment = true;
        index += 1;
        continue;
      }
      if (char === "'" || (char === '/' && next === '/')) break;
      if (char === '"') quote = char;

      line += char;
    }

    output.push(line);
  }

  return output;
}

function parenthesisBalance(text: string): number {
  let balance = 0;
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') balance += 1;
    if (char === ')') balance -= 1;
  }

  return balance;
}

/** Junta macros quebradas em várias linhas em uma única declaração. */
function logicalStatements(content: string): string[] {
  const statements: string[] = [];
  let pending = '';
  let balance = 0;

  for (const rawLine of stripComments(content)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (pending) {
      pending += ` ${line}`;
      balance += parenthesisBalance(line);
      if (balance <= 0) {
        statements.push(pending.trim());
        pending = '';
        balance = 0;
      }
      continue;
    }

    const initialBalance = parenthesisBalance(line);
    if (initialBalance > 0) {
      pending = line;
      balance = initialBalance;
      continue;
    }

    statements.push(line);
  }

  if (pending) statements.push(pending.trim());
  return statements;
}

function findAsSeparator(text: string): number {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index + 3 < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (
      (char === 'a' || char === 'A') &&
      (text[index + 1] === 's' || text[index + 1] === 'S') &&
      /\s/.test(text[index - 1] ?? ' ') &&
      /\s/.test(text[index + 2] ?? ' ')
    ) {
      return index;
    }
  }
  return -1;
}

function parseGenericDeclaration(
  kind: CanonicalElementKind,
  remainder: string
): { alias: string; label: string } | null {
  let text = remainder.trim().replace(/\s*<<[^>]+>>\s*$/g, '').trim();
  if (!text) return null;

  const asIndex = findAsSeparator(text);
  let alias: string;
  let label: string;

  if (asIndex >= 0) {
    label = unquote(text.slice(0, asIndex).trim());
    const aliasText = text.slice(asIndex + 2).trim().split(/\s+/, 1)[0] ?? '';
    alias = normalizeAlias(aliasText);
  } else if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    label = unquote(text);
    alias = identifierFromLabel(label);
  } else {
    const match = /^(\S+)(?:\s+(.+))?$/.exec(text);
    if (!match) return null;
    alias = normalizeAlias(match[1]);
    label = unquote(match[2]?.trim() ?? '') || alias;
  }

  if (!alias) alias = identifierFromLabel(label);
  return { alias, label: label || alias };
}

interface ArrowStatement {
  left: string;
  right: string;
  arrow: string;
  description: string | null;
}

function arrowOccurrences(text: string): Array<{ index: number; arrow: string }> {
  const occurrences: Array<{ index: number; arrow: string }> = [];
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    for (const arrow of GENERIC_ARROWS) {
      if (text.startsWith(arrow, index)) {
        occurrences.push({ index, arrow });
        index += arrow.length - 1;
        break;
      }
    }
  }

  return occurrences;
}

function parseArrowStatement(text: string): ArrowStatement | null {
  const occurrence = arrowOccurrences(text).find(({ index, arrow }) => {
    const left = text.slice(0, index).trim();
    const right = text.slice(index + arrow.length).trim();
    return left.length > 0 && right.length > 0;
  });
  if (!occurrence) return null;

  const left = text.slice(0, occurrence.index).trim();
  let right = text.slice(occurrence.index + occurrence.arrow.length).trim();
  let description: string | null = null;

  const colonIndex = findUnquotedColon(right);
  if (colonIndex >= 0) {
    description = unquote(right.slice(colonIndex + 1).trim()) || null;
    right = right.slice(0, colonIndex).trim();
  }

  if (!left || !right) return null;
  return { left, right, arrow: occurrence.arrow, description };
}

function findUnquotedColon(text: string): number {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ':') return index;
  }
  return -1;
}

function referenceKey(value: string): string {
  return unquote(value)
    .replace(/\s*<<[^>]+>>\s*$/g, '')
    .trim()
    .toLocaleLowerCase();
}

/**
 * Converte um workspace C4-PlantUML em elementos, relações e uma view.
 * Também aceita declarações genéricas do PlantUML, para que um diagrama
 * escrito fora das macros C4 possa ser editado e aplicado sem perder dados.
 */
export function parsePlantUmlWorkspace(content: string): ImportedWorkspace {
  if (!detectPlantUmlFormat(content)) {
    return { name: null, description: null, elements: [], relationships: [], views: [] };
  }

  const elements: ImportedElement[] = [];
  const relationships: ImportedRelationship[] = [];
  const identifiers = new Set<string>();
  const aliasToIdentifier = new Map<string, string>();
  const labelToIdentifier = new Map<string, string>();
  let name: string | null = null;
  let description: string | null = null;

  const resolveReference = (raw: string): string | null => {
    const value = raw.trim();
    const exact = aliasToIdentifier.get(value);
    if (exact) return exact;
    const key = referenceKey(value);
    return aliasToIdentifier.get(key) ?? labelToIdentifier.get(key) ?? null;
  };

  const addElement = (
    alias: string,
    label: string,
    kind: CanonicalElementKind,
    elementDescription: string | null,
    technology: string | null
  ): void => {
    const identifier = alias.trim();
    if (!identifier || identifiers.has(identifier)) return;
    identifiers.add(identifier);
    elements.push({
      identifier,
      kind,
      name: label,
      description: elementDescription,
      technology,
      tags: [],
      url: null,
      parentIdentifier: null,
    });
    aliasToIdentifier.set(identifier, identifier);
    aliasToIdentifier.set(identifier.toLocaleLowerCase(), identifier);
    labelToIdentifier.set(label.toLocaleLowerCase(), identifier);
  };

  const addRelationship = (
    sourceIdentifier: string | null,
    targetIdentifier: string | null,
    relationshipDescription: string | null,
    technology: string | null = null
  ): void => {
    if (!sourceIdentifier || !targetIdentifier || sourceIdentifier === targetIdentifier) return;
    relationships.push({
      sourceIdentifier,
      targetIdentifier,
      description: relationshipDescription,
      technology,
    });
  };

  for (const statement of logicalStatements(content)) {
    const line = statement.replace(/[{}]+\s*$/g, '').trim();
    if (!line) continue;
    if (line.startsWith('@') || line.startsWith('!')) continue;

    const diagramTitle = parseTitle(line);
    if (diagramTitle) {
      name = diagramTitle;
      continue;
    }
    const diagramCaption = parseCaption(line);
    if (diagramCaption) {
      description = diagramCaption;
      continue;
    }

    const macroMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*\{?\s*$/.exec(line);
    if (macroMatch) {
      const macro = macroMatch[1].toLowerCase();
      const args = parseArguments(splitArgs(macroMatch[2]));

      if (RELATION_MACROS.has(macro)) {
        const source = resolveReference(
          namedValue(args, ['from', 'source', 'from_id'], 0) ?? ''
        );
        const target = resolveReference(
          namedValue(args, ['to', 'target', 'to_id'], 1) ?? ''
        );
        const relationshipDescription = unquote(
          namedValue(args, ['descr', 'description', 'label'], 2) ?? ''
        ) || null;
        const technology = unquote(
          namedValue(args, ['technology', 'tech'], 3) ?? ''
        ) || null;
        const reverse = REVERSE_RELATION_MACROS.has(macro);
        const effectiveSource = reverse ? target : source;
        const effectiveTarget = reverse ? source : target;

        addRelationship(effectiveSource, effectiveTarget, relationshipDescription, technology);
        if (BIDIRECTIONAL_RELATION_MACROS.has(macro)) {
          addRelationship(target, source, relationshipDescription, technology);
        }
        continue;
      }

      if (BOUNDARY_MACROS.has(macro)) continue;

      const kind = KIND_BY_MACRO[macro];
      if (kind) {
        const alias = normalizeAlias(
          namedValue(args, ['alias', 'id', 'key'], 0) ?? ''
        );
        const label = unquote(
          namedValue(args, ['label', 'name', 'title'], 1) ?? ''
        ) || alias;
        const hasTechnology = kind === 'container' || kind === 'component';
        const technology = hasTechnology
          ? unquote(namedValue(args, ['technology', 'tech'], 2) ?? '') || null
          : null;
        const descriptionIndex = hasTechnology ? 3 : 2;
        const elementDescription = unquote(
          namedValue(args, ['descr', 'description'], descriptionIndex) ?? ''
        ) || null;
        addElement(alias, label, kind, elementDescription, technology);
        continue;
      }

      const genericKind = KIND_BY_GENERIC_DECLARATION[macro];
      if (genericKind) {
        const alias = normalizeAlias(
          namedValue(args, ['alias', 'id', 'key'], 0) ?? ''
        );
        const label = unquote(
          namedValue(args, ['label', 'name', 'title'], 1) ?? ''
        ) || alias;
        addElement(alias, label, genericKind, null, null);
        continue;
      }
    }

    const genericMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(line);
    if (genericMatch) {
      const keyword = genericMatch[1].toLowerCase();
      const kind = KIND_BY_GENERIC_DECLARATION[keyword];
      if (kind) {
        const declaration = parseGenericDeclaration(kind, genericMatch[2]);
        if (declaration) {
          addElement(declaration.alias, declaration.label, kind, null, null);
        }
        continue;
      }
    }

    const arrow = parseArrowStatement(line);
    if (arrow) {
      const source = resolveReference(arrow.left);
      const target = resolveReference(arrow.right);
      const reverse = ['<--', '<..', '<-', '<=', '<|--', '|-'].includes(arrow.arrow);
      const bidirectional = arrow.arrow === '<-->';

      if (reverse) {
        addRelationship(target, source, arrow.description);
      } else {
        addRelationship(source, target, arrow.description);
      }
      if (bidirectional) {
        addRelationship(target, source, arrow.description);
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
