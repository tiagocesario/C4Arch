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

/**
 * Declarações de elemento comuns do PlantUML que não têm equivalência no
 * modelo C4Arch. Elas são registradas para que uma importação `replace` não
 * descarte silenciosamente parte do diagrama.
 */
const UNSUPPORTED_GENERIC_ELEMENT_KEYWORDS = new Set([
  'abstract',
  'agent',
  'card',
  'circle',
  'class',
  'collections',
  'diamond',
  'entity',
  'enum',
  'file',
  'hexagon',
  'mainframe',
  'map',
  'object',
  'participant',
  'person',
  'port',
  'protocol',
  'query',
  'service',
  'stack',
  'state',
  'storage',
  'system',
]);

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

/** Macros C4 cujo nome indica um elemento, mas que não são suportados. */
function looksLikeUnsupportedElementMacro(macro: string): boolean {
  if (UNSUPPORTED_GENERIC_ELEMENT_KEYWORDS.has(macro)) return true;
  return /^(?:component|container|deployment|infrastructure|node|person|service|software|system)(?:_|$)/.test(
    macro
  );
}

/**
 * Formas de seta genéricas aceitas pelo PlantUML.
 *
 * A ordem importa: as variantes mais longas devem aparecer antes do traço
 * simples para que `..|>` não seja lido como `..` e `--*` não como `--`.
 */
const GENERIC_ARROWS = [
  '<-->',
  '<-up-',
  '<-down-',
  '<-left-',
  '<-right-',
  '-up->',
  '-down->',
  '-left->',
  '-right->',
  '<--',
  '-->',
  '<..*',
  '*..>',
  '<*--',
  '--*>',
  '<|..',
  '..|>',
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
  '*--',
  '--*',
  'o--',
  '--o',
  'x--',
  '--x',
  '+--',
  '--+',
  '--',
  '..',
];

interface ParsedArguments {
  /** Argumentos sem nome, na ordem em que apareceram. */
  positional: string[];
  /** Todos os argumentos, incluindo os nomeados, para respeitar a posição C4. */
  slots: string[];
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

  return { positional, slots: args, named };
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
  // `slots` preserva a posição original mesmo quando há argumentos nomeados
  // antes de um argumento posicional (por exemplo `$tags` + `$descr`). Um slot
  // que já contém outro argumento nomeado não pode ser usado como posicional.
  const slot = args.slots[positionalIndex];
  if (slot !== undefined && !/^\s*\$?[A-Za-z][A-Za-z0-9_]*\s*=/.test(slot)) {
    return slot;
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

/** Lê `$tags="a+b"` (separadores aceitos pelo C4: `+`, `,` e `;`). */
function parseTags(args: ParsedArguments): string[] {
  const raw = args.named.get('tags') ?? args.named.get('tag');
  if (!raw) return [];
  return unquote(raw)
    .split(/[+,;]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** Braços de bloco fora de aspas, usados para empilhar/desempilhar escopos. */
function braceDelta(text: string): { opens: number; closes: number } {
  let opens = 0;
  let closes = 0;
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
    if (char === '{') opens += 1;
    if (char === '}') closes += 1;
  }

  return { opens, closes };
}

/** Remove chaves de agrupamento das extremidades preservando o texto útil. */
function stripBlockBraces(statement: string): { text: string; opensBlock: boolean } {
  let text = statement.trim();
  let opensBlock = false;

  while (/\}+\s*$/.test(text)) {
    text = text.replace(/\}+\s*$/, '').trim();
  }
  while (/\{\s*$/.test(text)) {
    opensBlock = true;
    text = text.replace(/\{\s*$/, '').trim();
  }

  return { text, opensBlock };
}

/** Lê um texto entre aspas, respeitando escapes de `\"` e `\\`. */
function parseQuotedText(value: string): string | null {
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return null;

  let result = '';
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\' && index + 1 < value.length) {
      result += value[index + 1];
      index += 1;
      continue;
    }
    if (char === quote) return result;
    result += char;
  }
  return null;
}

/** Valor textual de uma diretiva, com suporte a `title(...)`/`caption(...)`. */
function parseDirectiveValue(line: string, directive: string): string | null {
  if (!new RegExp(`^${directive}(?:\\s|\\()`, 'i').test(line)) return null;

  let value = line.slice(directive.length).trim();
  if (value.startsWith('(')) {
    value = value.slice(1).trim();
    if (value.endsWith(')')) value = value.slice(0, -1).trim();
  }
  if (!value) return null;

  const quoted = parseQuotedText(value);
  return (quoted ?? value).trim() || null;
}

/**
 * Extrai o título do diagrama. PlantUML aceita `title Texto`, `title "Texto"`
 * e `title("Texto")`; a forma com aspas preserva espaços e pontuação.
 */
function parseTitle(line: string): string | null {
  return parseDirectiveValue(line, 'title');
}

function parseCaption(line: string): string | null {
  return parseDirectiveValue(line, 'caption');
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
    // `title`/`caption` são diretivas cujo texto pode conter apóstrofos.
    // O apóstrofo inicia comentário nas demais linhas, mas aqui faz parte do
    // texto (por exemplo, `title Don't lose`).
    const trimmed = rawLine.trim();
    if (
      !inBlockComment &&
      (/^title(?:\s|\()/i.test(trimmed) || /^caption(?:\s|\()/i.test(trimmed))
    ) {
      output.push(rawLine);
      continue;
    }

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
    const left = text.slice(0, asIndex).trim();
    const right = text.slice(asIndex + 2).trim();
    const leftIsQuoted = (left.startsWith('"') && left.endsWith('"')) ||
      (left.startsWith("'") && left.endsWith("'"));
    const rightIsQuoted = (right.startsWith('"') && right.endsWith('"')) ||
      (right.startsWith("'") && right.endsWith("'"));

    if (rightIsQuoted && !leftIsQuoted) {
      // `actor user as "Usuário"`: o lado entre aspas é o label e o lado
      // esquerdo é o alias estável.
      alias = normalizeAlias(left);
      label = unquote(right);
    } else {
      // `actor "Usuário" as user`: o lado esquerdo é o label e o direito é
      // o alias.
      label = unquote(left);
      const aliasText = right.split(/\s+/, 1)[0] ?? '';
      alias = normalizeAlias(aliasText);
    }
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

    // Estilo/cor: `-[#red]->`, `-[#red,dashed]->` etc. O token completo
    // precisa ser capturado antes do `->` simples.
    const styledArrow = /^-\[[^\]]+\]->/.exec(text.slice(index));
    if (styledArrow) {
      occurrences.push({ index, arrow: styledArrow[0] });
      index += styledArrow[0].length - 1;
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

interface ArrowDirection {
  reverse: boolean;
  bidirectional: boolean;
}

/** Determina a direção semântica de uma seta genérica do PlantUML. */
function arrowDirection(arrow: string): ArrowDirection {
  if (arrow === '<-->') return { reverse: false, bidirectional: true };
  if (arrow.startsWith('<')) return { reverse: true, bidirectional: false };
  if (['--*', '--o', '--x', '--+', '|-'].includes(arrow)) {
    return { reverse: true, bidirectional: false };
  }
  return { reverse: false, bidirectional: false };
}

/**
 * Indica se uma linha parece conter uma relação que o parser não entendeu.
 * Uma importação `replace` não pode aceitar essa interpretação parcial e
 * apagar as relações que existiam no modelo.
 */
function looksLikeRelationshipStatement(text: string): boolean {
  const markers = ['--', '..', '->', '<-', '=>', '<=', '<|', '|>', '-['];
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
    if (markers.some((marker) => text.startsWith(marker, index))) return true;
  }

  return false;
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
    return {
      name: null,
      description: null,
      elements: [],
      relationships: [],
      views: [],
      unrecognizedRelationships: [],
      unrecognizedElements: [],
    };
  }

  const elements: ImportedElement[] = [];
  const relationships: ImportedRelationship[] = [];
  const unrecognizedRelationships: string[] = [];
  const unrecognizedElements: string[] = [];
  const identifiers = new Set<string>();
  const aliasToIdentifier = new Map<string, string>();
  const labelToIdentifier = new Map<string, string>();
  // Pilha de escopos abertos (`System_Boundary(...) {`, `Container(...) {`).
  // O topo é o pai dos próximos elementos declarados.
  const scopes: Array<string | null> = [];
  let name: string | null = null;
  let description: string | null = null;

  const currentScope = (): string | null =>
    scopes.length > 0 ? scopes[scopes.length - 1] : null;

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
    technology: string | null,
    tags: string[] = []
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
      tags,
      url: null,
      parentIdentifier: currentScope(),
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
    // Fecha escopos abertos antes de interpretar a declaração. `}` pode vir em
    // linha própria (fim de um boundary) ou no fim de uma declaração.
    let contentPart = statement.trim();

    const leadingCloses = /^(?:\s*\})+/.exec(contentPart);
    if (leadingCloses) {
      const count = (leadingCloses[0].match(/\}/g) ?? []).length;
      for (let index = 0; index < count; index += 1) scopes.pop();
      contentPart = contentPart.slice(leadingCloses[0].length).trim();
    }

    const trailingCloses = /(?:\}+\s*)+$/.exec(contentPart);
    if (trailingCloses) {
      const closes = (trailingCloses[0].match(/\}/g) ?? []).length;
      const opens = braceDelta(contentPart).opens;
      const toClose = Math.max(0, closes - opens);
      for (let index = 0; index < toClose; index += 1) scopes.pop();
      contentPart = contentPart.slice(0, contentPart.length - trailingCloses[0].length).trim();
    }

    const stripped = stripBlockBraces(contentPart);
    const line = stripped.text;
    const opensBlock = stripped.opensBlock;

    // Blocos não reconhecidos (ex.: `package ... {`) herdam o escopo atual
    // para que o `}` correspondente não desempilhe o pai errado.
    const openScope = (identifier: string | null): void => {
      if (opensBlock) scopes.push(identifier ?? currentScope());
    };

    if (!line) {
      openScope(null);
      continue;
    }
    if (line.startsWith('@') || line.startsWith('!')) {
      openScope(null);
      continue;
    }

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
        if (!source || !target) {
          unrecognizedRelationships.push(line);
          continue;
        }
        const reverse = REVERSE_RELATION_MACROS.has(macro);
        const effectiveSource = reverse ? target : source;
        const effectiveTarget = reverse ? source : target;

        addRelationship(effectiveSource, effectiveTarget, relationshipDescription, technology);
        if (BIDIRECTIONAL_RELATION_MACROS.has(macro)) {
          addRelationship(target, source, relationshipDescription, technology);
        }
        continue;
      }

      if (BOUNDARY_MACROS.has(macro)) {
        // C4Arch não tem um tipo "boundary": a fronteira vira o elemento
        // estrutural do seu nível (sistema, container ou componente) para
        // preservar a hierarquia no modelo canônico e na exportação.
        // `Boundary(alias, label, type)` informa o nível no terceiro argumento.
        // Na exportação, `Type:Technology` preserva também a tecnologia, que
        // as boundaries específicas do C4 não possuem como argumento.
        const boundaryTypeValue = unquote(
          namedValue(args, ['type'], 2) ?? ''
        ).trim();
        const technologySeparator = boundaryTypeValue.indexOf(':');
        const boundaryType = (
          technologySeparator >= 0
            ? boundaryTypeValue.slice(0, technologySeparator)
            : boundaryTypeValue
        ).trim().toLowerCase();
        const boundaryTechnology =
          technologySeparator >= 0
            ? boundaryTypeValue.slice(technologySeparator + 1).trim() || null
            : null;
        const boundaryKind: CanonicalElementKind =
          macro === 'container_boundary' || boundaryType.includes('container')
            ? 'container'
            : macro === 'component_boundary' || boundaryType.includes('component')
              ? 'component'
              : 'software_system';
        const alias = normalizeAlias(
          namedValue(args, ['alias', 'id', 'key'], 0) ?? ''
        );
        const label =
          unquote(namedValue(args, ['label', 'name', 'title'], 1) ?? '') || alias;
        const descriptionIndex = macro === 'boundary' ? 5 : 4;
        const boundaryDescription = unquote(
          namedValue(args, ['descr', 'description'], descriptionIndex) ?? ''
        ) || null;
        if (alias && !identifiers.has(alias)) {
          addElement(
            alias,
            label,
            boundaryKind,
            boundaryDescription,
            macro === 'boundary' ? boundaryTechnology : null,
            parseTags(args)
          );
        }
        openScope(alias || currentScope());
        continue;
      }

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
        addElement(alias, label, kind, elementDescription, technology, parseTags(args));
        openScope(alias || currentScope());
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
        addElement(alias, label, genericKind, null, null, parseTags(args));
        openScope(alias || currentScope());
        continue;
      }

      if (/^(?:rel|birel)/.test(macro)) {
        unrecognizedRelationships.push(line);
        openScope(null);
        continue;
      }

      if (looksLikeUnsupportedElementMacro(macro)) {
        unrecognizedElements.push(line);
        openScope(null);
        continue;
      }

      openScope(null);
    }

    const genericMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(line);
    if (genericMatch) {
      const keyword = genericMatch[1].toLowerCase();
      const kind = KIND_BY_GENERIC_DECLARATION[keyword];
      if (kind) {
        const declaration = parseGenericDeclaration(kind, genericMatch[2]);
        if (declaration) {
          addElement(declaration.alias, declaration.label, kind, null, null);
          openScope(declaration.alias);
        } else {
          unrecognizedElements.push(line);
        }
        continue;
      }
      if (UNSUPPORTED_GENERIC_ELEMENT_KEYWORDS.has(keyword)) {
        unrecognizedElements.push(line);
        continue;
      }
    }

    const arrow = parseArrowStatement(line);
    if (arrow) {
      const source = resolveReference(arrow.left);
      const target = resolveReference(arrow.right);
      if (!source || !target) {
        unrecognizedRelationships.push(line);
        continue;
      }

      const direction = arrowDirection(arrow.arrow);
      if (direction.reverse) {
        addRelationship(target, source, arrow.description);
      } else {
        addRelationship(source, target, arrow.description);
      }
      if (direction.bidirectional) {
        addRelationship(target, source, arrow.description);
      }
    } else if (looksLikeRelationshipStatement(line)) {
      unrecognizedRelationships.push(line);
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
    unrecognizedRelationships,
    unrecognizedElements,
  };
}
