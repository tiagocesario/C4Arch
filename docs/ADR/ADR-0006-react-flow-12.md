# ADR-0006 — Migração para React Flow 12

- **Status:** Adotada
- **Contexto:** O scaffolding original de `apps/web` usava React Flow 11.x (`RFEdge`, `Container`, `ReactFlow`), mas o pacote instalado foi atualizado para 12.x. As superfícies de API e tipos mudaram.
- **Decisão:** Atualizar `apps/web` para React Flow 12: `@xyflow/react` para `^12.12.0`, `vite-env.d.ts` com `/// <reference types="vite/client" />`, `RFEdge`→`Edge`, remoção de `Container`/`ReactFlow` v11, `onConnect`/`onNodeChange`/`onNodeDoubleClick` tipados para o domínio v12. `npm install --no-workspaces` dentro de `apps/web` (evitar node_modules raiz).
- **Consequências:** + alinhamento com a versão instalada e com o `Canvas` do React Flow 12; - re-escrita de tipos e testes de compilação (npm, tsc, vite). Finalmente `tsc --noEmit` e `vite build` saíram 0.
