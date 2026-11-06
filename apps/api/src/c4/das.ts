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
export function generateDAS(
  model: DasModel,
  elements: DasElement[] = [],
  edges: DasEdge[] = [],
  folderName?: string | null
): string {
  const now = new Date().toLocaleDateString('pt-BR');
  const typeLabel = model.c4_type ?? 'container';
  const scope = model.c4_scope ?? '—';

  const elementRows = elements.length
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
          const from = elements.find((x) => x.id === e.from_id)?.title ?? e.from_id ?? '—';
          const to = elements.find((x) => x.id === e.to_id)?.title ?? e.to_id ?? '—';
          return `| ${from} | ${to} | ${e.label ?? '—'} | ${e.type ?? 'call'} |`;
        })
        .join('\n')
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

## 7. Visão de componentes (C4 — Nível 3)

_A detalhar._

---

## 8. Modelo de dados

_A definir._

---

## 9. Segurança

RBAC por organização (owner/editor/viewer). Ver \`docs/SECURITY.md\`.

---

## 10. Decisões de arquitetura

Referência: \`docs/ADR/\`.

---

## 11. Histórico

| Versão | Data | Autor | Descrição |
|---|---|---|---|
| 0.1.0 | ${now} | C4Arch (auto) | Geração inicial a partir do modelo |
`;
}
