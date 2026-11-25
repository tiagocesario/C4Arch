import { deflateRawSync } from 'node:zlib';

/**
 * Codificação usada pelo servidor PlantUML para receber o diagrama na URL
 * (`/svg/{encoded}`): deflate raw + base64 com alfabeto próprio. O texto vai
 * completo, incluindo `@startuml`/`@enduml`, para preservar título e diretivas.
 */

function encode6bit(value: number): string {
  if (value < 10) return String.fromCharCode(48 + value);
  value -= 10;
  if (value < 26) return String.fromCharCode(65 + value);
  value -= 26;
  if (value < 26) return String.fromCharCode(97 + value);
  value -= 26;
  if (value === 0) return '-';
  if (value === 1) return '_';
  return '?';
}

function append3Bytes(b1: number, b2: number, b3: number): string {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3f;
  return encode6bit(c1) + encode6bit(c2) + encode6bit(c3) + encode6bit(c4);
}

export function encodePlantUml(text: string): string {
  const compressed = deflateRawSync(Buffer.from(text, 'utf8'));
  let result = '';
  for (let i = 0; i < compressed.length; i += 3) {
    const b1 = compressed[i];
    const b2 = i + 1 < compressed.length ? compressed[i + 1] : 0;
    const b3 = i + 2 < compressed.length ? compressed[i + 2] : 0;
    result += append3Bytes(b1, b2, b3);
  }
  return result;
}

/**
 * Macros que só existem na biblioteca C4-PlantUML. Um código escrito com elas
 * sem `!include` renderiza caixas UML genéricas (e às vezes erro), então a
 * pré-visualização injeta a diretiva antes de chamar o servidor PlantUML.
 */
const C4_MACRO_RE =
  /^(?:Person|Person_Ext|System|System_Ext|SystemDb|SystemDb_Ext|SystemQueue|SystemQueue_Ext|Container|ContainerDb|ContainerQueue|Component|ComponentDb|ComponentQueue|System_Boundary|Container_Boundary|Enterprise_Boundary|Boundary|Deployment_Node|Rel|Rel_Back|Rel_Neighbor|Rel_Up|Rel_Down|Rel_Left|Rel_Right|BiRel)\s*[(_]/m;

const C4_INCLUDE_RE = /!include\s+(?:<)?C4\//i;

/**
 * Garante o `!include` do C4-PlantUML na pré-visualização.
 *
 * O texto continua sendo do usuário; apenas a diretiva da biblioteca é
 * acrescentada quando o código usa macros C4 e não a declarou. Assim pessoas,
 * sistemas, containers e componentes aparecem sempre com os ícones oficiais do
 * C4 model, e não como retângulos UML sem estilo.
 */
export function ensureC4Include(source: string): string {
  if (!source.trim()) return source;
  if (C4_INCLUDE_RE.test(source)) return source;
  if (!C4_MACRO_RE.test(source)) return source;

  const include = /^(?:Component|ComponentDb|ComponentQueue)\s*[(_]/m.test(source)
    ? 'C4_Component'
    : /^(?:Container|ContainerDb|ContainerQueue)\s*[(_]/m.test(source)
      ? 'C4_Container'
      : 'C4_Context';
  const directive = `!include <C4/${include}>`;

  const start = source.match(/^\s*@startuml[^\n]*\n?/im);
  if (start) {
    const index = (start.index ?? 0) + start[0].length;
    return `${source.slice(0, index)}${directive}\n${source.slice(index)}`;
  }
  return `${directive}\n${source}`;
}
