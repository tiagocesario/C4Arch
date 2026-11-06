import { pool } from '../db.js';

export interface DasModel {
  id: string;
  title: string;
  description?: string | null;
  status?: string;
  c4_type?: string;
  c4_scope?: string | null;
  folder_id?: string | null;
  org_id?: string;
}

export interface DasElement {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  app_id?: string | null;
  service_id?: string | null;
}

export interface DasEdge {
  id: string;
  from_id?: string;
  to_id?: string;
  label?: string | null;
  type?: string;
}

/**
 * Gera o conteúdo Markdown do DAS a partir dos dados do modelo.
 * Usa o template `docs/DAS-template.md` como base.
 */
export function parseDrawio(xml: string | null | undefined): { shapes: string[]; edges: { source: string; target: string }[] } {
  const shapes: string[] = [];
  const edges: { source: string; target: string }[] = [];
  if (!xml) return { shapes, edges };

  // Extrai rótulos de shapes (object label ou mxCell value)
  const labelRegex = /(?:label|value)\s*=\s*"([^"]*)"/g;
  const cellRegex = /<mxCell\b[^>]*>/g;
  let m: RegExpExecArray | null;
  const cells: string[] = [];
  while ((m = cellRegex.exec(xml)) !== null) cells.push(m[0]);

  for (const cell of cells) {
    if (/vertex\s*=\s*"1"/.test(cell) || /vertex="1"/.test(cell)) {
      let label = '';
      const lm = cell.match(/(?:label|value)\s*=\s*"([^"]*)"/);
      if (lm) label = lm[1];
      // também procura em <object> envolvente? simplificado
      if (label) {
        const clean = label.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (clean && !shapes.includes(clean)) shapes.push(clean);
      }
    }
    if (/edge\s*=\s*"1"/.test(cell)) {
      const sm = cell.match(/source\s*=\s*"([^"]*)"/);
      const tm = cell.match(/target\s*=\s*"([^"]*)"/);
      if (sm && tm) edges.push({ source: sm[1], target: tm[1] });
    }
  }

  // object wrappers
  const objRegex = /<object\b[^>]*>/g;
  let om: RegExpExecArray | null;
  while ((om = objRegex.exec(xml)) !== null) {
    const tag = om[0];
    const lm = tag.match(/label\s*=\s*"([^"]*)"/);
    if (lm) {
      const clean = lm[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean && !shapes.includes(clean)) shapes.push(clean);
    }
  }

  return { shapes, edges };
}

export function generateDAS(
  model: DasModel,
  elements: DasElement[] = [],
  edges: DasEdge[] = [],
  folderName?: string | null,
  drawioXml?: string | null
): string {
  const now = new Date().toLocaleDateString('pt-BR');
  const typeLabel = model.c4_type ?? 'container';
  const scope = model.c4_scope ?? '—';

  const parsed = parseDrawio(drawioXml);
  // Se não houver elementos no Postgres, usa os shapes do draw.io
  const effectiveElements = elements.length ? elements : parsed.shapes.map((s, i) => ({
    id: `drawio-${i}`,
    type: 'container',
    title: s,
  }));

  const elementRows = effectiveElements.length
    ? elements
        .map(
          (e) =>
            `| ${e.title} | ${e.type} | ${e.description ?? '—'} | ${e.app_id ? 'app' : e.service_id ? 'service' : '—'} |`
        )
        .join('\n')
    : '| _nenhum elemento_ | — | — | — |';

  const edgeRows = edges.length
    ? edges
        .map((e) => {
          const from = effectiveElements.find((x) => x.id === e.from_id)?.title ?? e.from_id ?? '—';
          const to = effectiveElements.find((x) => x.id === e.to_id)?.title ?? e.to_id ?? '—';
          return `| ${from} | ${to} | ${e.label ?? '—'} | ${e.type ?? 'call'} |`;
        })
        .join('\n')
    : parsed.edges.length
    ? parsed.edges.map((e) => `| ${e.source} | ${e.target} | — | draw.io |`).join('\n')
    : '| _nenhuma conexão_ | — | — | — |';

  return `# Documento de Arquitetura de Soluções (DAS)

> Gerado automaticamente pelo C4Arch em ${now}.

## 1. Informações do documento

| Campo | Valor |
|---|---|
| Projeto | ${model.title} |
| Versão | 0.1.0 |
| Data | ${now} |
| Status | ${model.status ?? 'draft'} |
| Modelo C4 | ${typeLabel} |
| Escopo C4 | ${scope} |
| Pasta | ${folderName ?? 'Sem pasta'} |
| Referência | Modelo \`${model.id}\` |

---

## 2. Visão geral

### 2.1 Propósito

${model.description ?? '_Descrição não informada._'}

### 2.2 Escopo

- **Incluído:** modelo C4 "${model.title}" (${typeLabel}).
- **Excluído:** _a definir._
- **Fronteiras:** _a definir._

---

## 3. Requisitos e restrições

### 3.1 Requisitos funcionais

Referência: \`docs/PRD.md\`.

### 3.2 Requisitos não funcionais

| Categoria | Requisito | Métrica/Alvo |
|---|---|---|
| Desempenho | _a definir_ | _a definir_ |
| Disponibilidade | _a definir_ | _a definir_ |
| Segurança | RBAC owner/editor/viewer | _a definir_ |

---

## 4. Stakeholders e personas

| Stakeholder | Papel | Interesse principal |
|---|---|---|
| Arquiteto Sênior | owner | Aprovar e exportar modelos |
| Arquiteto de Soluções | editor | Construir sistemas e conexões |
| Arquiteto de Negócio | viewer | Ler e validar |

---

## 5. Visão de contexto (C4 — Nível 1)

### 5.1 Diagrama de contexto

_A inserir._

### 5.2 Descrição dos elementos

| Elemento | Tipo | Descrição |
|---|---|---|
${elementRows.replace(/\| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/, '| $1 | $2 | $3 |')}

---

## 6. Visão de containers (C4 — Nível 2)

### 6.1 Diagrama de containers

_A inserir._

### 6.2 Containers / Elementos

| Nome | Tipo | Descrição | App/Serviço |
|---|---|---|---|
${elementRows}

### 6.3 Conexões

| Origem | Destino | Rótulo | Tipo |
|---|---|---|---|
${edgeRows}

---

## 7. Desenho (draw.io)

### 7.1 Shapes encontrados no diagrama

${parsed.shapes.length ? parsed.shapes.map((s) => `- ${s}`).join('\n') : '_Nenhum shape encontrado._'}

### 7.2 Conexões do diagrama

${parsed.edges.length ? parsed.edges.map((e) => `- ${e.source} → ${e.target}`).join('\n') : '_Nenhuma conexão encontrada._'}

---

## 8. Visão de componentes (C4 — Nível 3)

_A detalhar._

---

## 9. Modelo de dados

_A definir._

---

## 10. Segurança

RBAC por organização (owner/editor/viewer). Ver \`docs/SECURITY.md\`.

---

## 11. Decisões de arquitetura

Referência: \`docs/ADR/\`.

---

## 12. Histórico

| Versão | Data | Autor | Descrição |
|---|---|---|---|
| 0.1.0 | ${now} | C4Arch (auto) | Geração inicial a partir do modelo |
`;
}
