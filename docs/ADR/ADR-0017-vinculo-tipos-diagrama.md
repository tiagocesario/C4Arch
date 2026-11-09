# ADR-0017 — Vínculo de novos tipos de diagrama a um modelo existente

- **Status:** Substituída parcialmente pela ADR-0018
- **Data:** 2026-11-06 — time C4Arch

> **Nota:** o fluxo por `parent_id` descrito abaixo permanece apenas por
> compatibilidade com dados existentes. O fluxo atual grava os tipos extras no
> **mesmo modelo** em `models.diagrams` (JSONB), conforme a
> [ADR-0018](./ADR-0018-multi-diagrama-mesmo-modelo.md).

## Contexto

Um mesmo sistema pode ser representado por vários diagramas C4 (contexto,
container, componente, código, landscape, dinâmico, implantação). Antes, cada
diagrama exigia um novo modelo isolado, sem relação com o modelo original, e
nada impedia a criação de dois diagramas do mesmo tipo para o mesmo sistema.

## Decisão

1. Adicionar `models.parent_id` (auto-referência, `ON DELETE CASCADE`) para
   vincular um novo modelo a um modelo existente como um **novo tipo de
   diagrama** do mesmo sistema.
2. No cadastro (**Arquivos → + Novo modelo**), oferecer a opção
   "Vincular a um modelo existente (novo tipo de diagrama)", com filtro por
   título para localizar o modelo pai.
3. Impedir duplicidade de tipo no grupo por meio do índice único
   `(COALESCE(parent_id, id), c4_type)` e validação explícita na API
   (`409 Já existe um diagrama deste tipo vinculado a este modelo`).
4. `POST`/`PUT /api/models` aceitam `parentId`; a API valida que o pai
   pertence à mesma organização.

## Consequências

- + Vários tipos de diagrama passam a compor um mesmo modelo C4.
- + Consistência garantida no banco e na API (não só na UI).
- + Filtro por título facilita localizar o modelo pai em workspaces grandes.
- - A hierarquia é de apenas um nível de vínculo; hierarquia C4 genérica em
  múltiplos níveis permanece fora do MVP.
- - `ON DELETE CASCADE` remove os diagramas vinculados ao excluir o modelo pai.

## Referências

- `apps/api/src/db/migrate.ts` (`parent_id`, `idx_models_group_c4type`)
- `apps/api/src/controllers/models.controller.ts` (validação de `parentId`)
- `apps/web/src/App.tsx` (checkbox, filtro e seletor de modelo pai)
- `apps/web/src/services/types.ts` (`Model.parentId`, `CreateModelInput.parentId`)
- `docs/PRD.md` (RF-19)
