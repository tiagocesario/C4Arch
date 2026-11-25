import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { encodePlantUml, ensureC4Include } from '../src/c4/plantuml-render.js';

// Decodificador de referência do formato de URL do PlantUML. Serve para provar
// que o encoder da API é reversível (deflate raw + base64 próprio).
function decode6bit(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 90) return code - 65 + 10;
  if (code >= 97 && code <= 122) return code - 97 + 36;
  if (char === '-') return 62;
  if (char === '_') return 63;
  throw new Error(`caractere inválido: ${char}`);
}

function decodePlantUml(encoded: string): string {
  assert.equal(encoded.length % 4, 0, 'saída deve ter múltiplos de 4 caracteres');
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i += 4) {
    const c1 = decode6bit(encoded[i]);
    const c2 = decode6bit(encoded[i + 1]);
    const c3 = decode6bit(encoded[i + 2]);
    const c4 = decode6bit(encoded[i + 3]);
    bytes.push(((c1 << 2) | (c2 >> 4)) & 0xff);
    bytes.push((((c2 & 0xf) << 4) | (c3 >> 2)) & 0xff);
    bytes.push((((c3 & 0x3) << 6) | c4) & 0xff);
  }
  return inflateRawSync(Buffer.from(bytes)).toString('utf8');
}

const diagram = `@startuml
!include <C4/C4_Container>
title Loja
Person(cliente, "Cliente", "Compra produtos")
System_Boundary(loja, "Loja") {
  Container(api, "API", "Node.js", "Backend")
  ContainerDb(banco, "Banco", "PostgreSQL", "Persistência")
}
Rel(cliente, api, "usa", "HTTPS")
@enduml`;

test('encodePlantUml preserva o texto completo no round-trip', () => {
  const encoded = encodePlantUml(diagram);
  assert.match(encoded, /^[0-9A-Za-z_-]+$/);
  assert.equal(decodePlantUml(encoded), diagram);
});

test('encodePlantUml aceita Unicode e é determinístico', () => {
  const text = '@startuml\nnote "Ação, coração e §" as N\n@enduml';
  const first = encodePlantUml(text);
  assert.equal(encodePlantUml(text), first);
  assert.equal(decodePlantUml(first), text);
});

test('ensureC4Include injeta o include C4 quando o código usa macros sem declarar', () => {
  const source = '@startuml\ntitle Teste\nPerson(usuario, "Usuário")\nSystem(sistema, "Sistema")\nRel(usuario, sistema, "usa")\n@enduml';
  const withInclude = ensureC4Include(source);
  assert.match(withInclude, /^@startuml\n!include <C4\/C4_Context>/);
  assert.equal(withInclude.includes('Person(usuario'), true);
});

test('ensureC4Include escolhe o include do nível mais profundo', () => {
  const containers = '@startuml\nContainer(api, "API", "Node.js")\n@enduml';
  assert.match(ensureC4Include(containers), /!include <C4\/C4_Container>/);

  const components = '@startuml\nComponent(rotas, "Rotas")\n@enduml';
  assert.match(ensureC4Include(components), /!include <C4\/C4_Component>/);
});

test('ensureC4Include preserva código que já declara include ou não é C4', () => {
  const declared = '@startuml\n!include <C4/C4_Container>\nPerson(usuario, "Usuário")\n@enduml';
  assert.equal(ensureC4Include(declared), declared);

  const generic = '@startuml\nclass Pedido\n@enduml';
  assert.equal(ensureC4Include(generic), generic);
});
