# 🎨 Especificação Técnica de UX/UI: Editor do DAS

## 1. Identificação do Artefato

- **Autor/Arquiteto:** Time C4Arch
- **Data de Criação:** 09/11/2026
- **Status do Documento:** ✔ Aprovado
- **Link do Figma (Handoff/Dev Mode):** Não aplicável — implementação direta no design system existente (dark theme do C4Arch).

---

## 2. Configuração das Unidades do Editor

> **Adaptação do template:** o editor do DAS **não usa canvas React Flow**. As
> unidades navegáveis são as seções do documento Markdown gerado pela API. A
> tabela abaixo mantém a mesma intenção da seção original (tipo, estilo,
> entradas e saídas), aplicada a seções.

| Unidade | Tipo técnico | Estilo visual | Entradas | Saídas |
|---|---|---|---|---|
| Informações do documento | `preamble` | Item 01 na navegação; ponto verde quando preenchido | Título, versão, status e metadados antes do primeiro `##` | Markdown do cabeçalho |
| Seção de nível 2 | `section-<heading>` | Item numerado na navegação; ponto verde/âmbar | Conteúdo Markdown da seção | Markdown da seção |
| Painel da seção | `aside.das-editor-drawer` | Coluna direita, cartões de status e orientações | Seção ativa | Status, contagem e orientações |
| Navegação de seções | `nav.das-editor-section-list` | Lista vertical com índice, rótulo e indicador | Clique na seção | Seleção da seção ativa |

### Regras de estrutura

- A primeira unidade é sempre **Informações do documento** (`preamble`).
- As demais unidades vêm dos títulos `## ` do DAS, na ordem original.
- Os títulos das seções **não são editáveis** nesta versão; a estrutura é
  preservada para manter compatibilidade com a regeneração automática.
- A seção ativa é identificada por índice, com fallback para a primeira quando
  a lista diminui após regeneração.

---

## 3. Comportamento do Painel de Propriedades (Drawer)

O painel lateral direito exibe o contexto da seção selecionada. A edição
principal acontece na coluna central.

### Campos e controles

1. `Seleção de seção` → Lista de botões → Clique altera a seção ativa.
2. `Conteúdo da seção` → Textarea → Markdown livre; contador de caracteres,
   palavras e linhas.
3. `Status da seção` → Indicador → **Preenchida** (conteúdo não vazio) ou
   **Pendente** (vazio).
4. `Status do documento` → Indicador → **Salvo** ou **Alterações não salvas**.
5. `Seções pendentes` → Contador → `N de M`.
6. `Descartar alterações` → Botão → Restaura o conteúdo salvo (baseline).
7. `Salvar DAS` → Botão → Persiste via `PUT /api/models/:id/das`.
8. `Ctrl+S` → Atalho → Executa o mesmo fluxo do botão Salvar.

### Sincronização

- [ ] Salvar via Debounce automático
- [x] Requer clique no botão **Salvar DAS** (ou `Ctrl+S`)

**Justificativa:** o DAS é um artefato de governança e pode ser sobrescrito pela
regeneração automática. O salvamento explícito evita perda silenciosa e deixa
claro quando o conteúdo foi persistido.

### Validações de formulário

- Seção vazia: aviso âmbar, sem bloquear o salvamento.
- Salvamento: habilitado apenas quando há alterações pendentes.
- Descartar: habilitado apenas quando há alterações pendentes.
- Fechar com alterações: confirmação do navegador.
- Regenerar com alterações: confirmação explícita de substituição.

---

## 4. Validações de Regra de Negócio no Editor

> **Adaptação do template:** não existem arestas/conexões entre nós. As regras
> abaixo substituem as *edge rules* para proteger a integridade do documento.

- **Regra 1:** a unidade `preamble` deve permanecer antes de todas as seções.
- **Regra 2:** títulos `## ` não podem ser removidos ou renomeados pelo editor;
  a estrutura vem do documento gerado.
- **Regra 3:** uma seção pode ficar vazia, mas é sinalizada como **Pendente**.
- **Regra 4:** fechar o editor com alterações não salvas exige confirmação.
- **Regra 5:** regenerar com alterações não salvas exige confirmação e substitui
  o conteúdo pelo documento gerado.
- **Regra 6:** somente `owner` e `editor` podem salvar (validado também pela API).
- **Comportamento de erro:** avisos inline em âmbar; erros de API aparecem no
  banner global de erro. Nenhuma seção é apagada automaticamente.

---

## 5. Mapeamento de Performance e Estado

- **Gatilho de render:** o parsing do Markdown é memoizado com `useMemo` sobre
  `dasContent`. A seleção de seção é estado local (`dasActiveSection`), sem
  reparsear o documento ao trocar de seção.
- **Estratégia de cache:**
  - [ ] LocalStorage temporário
  - [x] Estado puramente em memória (reset ao fechar/atualizar)
- **Gerenciamento de estado:** React local (`useState`/`useMemo`). O projeto não
  usa Zustand; não foi adicionada dependência nova.
- **Persistência:** explícita na API (`updateModelDAS`), com baseline em memória
  para cálculo de “alterações não salvas”.
- **Responsividade:** três colunas em telas largas; duas colunas até 1080 px
  (drawer oculto); uma coluna abaixo de 760 px.

---

## 6. Critérios de Aceite

- [ ] O editor lista todas as seções `## ` do DAS, além do cabeçalho.
- [ ] Clicar em uma seção abre seu conteúdo na coluna central.
- [ ] O conteúdo editado é refletido no preview e no PDF.
- [ ] O status **Salvo / Alterações não salvas** acompanha a edição.
- [ ] `Ctrl+S` e o botão **Salvar DAS** persistem o documento.
- [ ] Fechar com alterações pendentes pede confirmação.
- [ ] Regenerar com alterações pendentes pede confirmação.
- [ ] Seções vazias são sinalizadas sem bloquear o salvamento.
- [ ] Layout funciona em desktop e em telas estreitas.

---

## 7. Implementação

- `apps/web/src/App.tsx`: parsing/serialização das seções, navegação, formulário,
  drawer, atalho e confirmações.
- `apps/web/src/index.css`: classes `das-editor-*`, `das-section-*`,
  `das-drawer-*` e `das-badge-*`.
- API: `PUT /api/models/:id/das` (`ModelController.updateDas`).
