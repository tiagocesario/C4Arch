# ADR-0018 — Multi-diagrama no mesmo modelo e persistência da tela

- **Status:** Adotada
- **Data:** 2026-11-06 — time C4Arch
- **Substitui parcialmente:** ADR-0017

## Contexto

A ADR-0017 vinculava novos tipos de diagrama criando **outras linhas** em
`models` com `parent_id`, o que gerava modelos/arquivos duplicados para o mesmo
sistema e dificultava a navegação. Além disso, o frontend voltava à lista de
modelos ao pressionar F5, perdendo o preview e o tipo de diagrama em uso, e a
tela de pastas não refletia corretamente a hierarquia nem filtrava por nome
enquanto o usuário digitava.

## Decisão

1. Manter o diagrama principal nas colunas históricas `models.c4_type` e
   `models.drawio_xml`.
2. Armazenar os tipos extras do **mesmo modelo** na coluna JSONB
   `models.diagrams`, no formato `[{ "c4Type": "...", "drawioXml": "..." }]`.
   Nenhuma nova linha/modelo/arquivo é criada ao adicionar um tipo.
3. Expor `POST /api/models/:id/diagrams` com `{ c4Type }` para anexar um tipo
   extra (idempotência por tipo; `409` se já existir) e normalizar a leitura
   com `parseDiagrams`/`resolveDiagramXml`.
4. Aceitar `?type=<c4Type>` nas rotas do draw.io (editor, preview, export e
   import) para operar no diagrama correto.
5. No frontend, o preview do modelo passa a ter abas por tipo de diagrama e
   botões de evolução (contexto → container → componente → código) que chamam
   a rota de diagramas.
6. Persistir em `localStorage` (`c4arch_view`) o modo atual, o modelo em
   edição, o preview aberto e o tipo de diagrama selecionado. A leitura
   acontece **antes** de qualquer gravação durante o bootstrap, para o F5 não
   sobrescrever o estado salvo com a lista inicial.
7. Renderizar pastas em árvore real (pai seguido dos filhos, com profundidade
   calculada) e filtrar por nome de forma insensível a acentos, mantendo
   ancestrais e descendentes visíveis. Mover para a raiz envia
   `parentId: null` e atualiza o estado imediatamente.

## Consequências

- + Um sistema passa a ter vários diagramas C4 no mesmo modelo, sem duplicação
  de modelos, arquivos ou pastas.
- + Navegação e evolução entre níveis ficam explícitas no preview.
- + F5 preserva o contexto de trabalho (lista, pastas, editor/preview e tipo).
- + A hierarquia de pastas fica estável e o filtro funciona durante a digitação.
- - `models.parent_id` e o índice único antigo permanecem por compatibilidade
  com dados existentes, mas não são mais o fluxo recomendado.
- - A migração de diagramas antigos criados via `parent_id` para
  `models.diagrams` não é automática; eles continuam acessíveis pelo fluxo
  legado.

## Referências

- `apps/api/src/db/migrate.ts` (coluna `models.diagrams`)
- `apps/api/src/c4/diagrams.ts` (`parseDiagrams`, `resolveDiagramXml`,
  `withDiagramXml`)
- `apps/api/src/controllers/models.controller.ts` (`addDiagram`)
- `apps/api/src/controllers/drawio.controller.ts` (`?type=`)
- `apps/api/src/routes/models.routes.ts` (`POST /api/models/:id/diagrams`)
- `apps/web/src/App.tsx` (abas de diagrama, evolução, árvore/filtro de pastas e
  persistência `c4arch_view`)
- `apps/web/src/services/api.ts` (`mapModel`, `addModelDiagram`,
  `getDrawioEditorUrl`/`getDrawioPreviewUrl` com tipo)
- `docs/PRD.md` (RF-19 a RF-22)
