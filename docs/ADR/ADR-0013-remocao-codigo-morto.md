# ADR-0013 — Remoção de código morto e dependências não utilizadas

- **Status:** Adotada
- **Contexto:** O repositório mantinha uma cópia da lógica de realtime em
  `apps/api/src/realtime/sync.ts` que não era importada por ninguém, além de
  scripts manuais de seed/teste e dependências declaradas apenas por causa
  desse código. Isso aumentava o custo de manutenção e confundia qual serviço
  era o dono da sincronização.
- **Decisão:**
  1. Remover `apps/api/src/realtime/sync.ts` (duplicata não utilizada).
  2. Remover `apps/api/seed-manual.cjs` e `apps/realtime/test-ws.cjs`.
  3. Remover `apps/api/src/types/handler.ts` (sem consumidores).
  4. Remover o import não utilizado de `connectDb` em `apps/api/src/server.ts`.
  5. Remover `ws`, `y-websocket` e `@types/ws` das dependências de
     `apps/api`; o serviço de realtime continua com suas próprias dependências.
  6. Remover `sendPatch` do cliente WebSocket, que não era chamado.
  7. Remover artefatos gerados (`vite.config.js`, `vite.config.d.ts`,
     `tsconfig.tsbuildinfo`) e ignorar `*.tsbuildinfo`.
- **Consequências:**
  - `+` Uma única implementação de realtime (`apps/realtime`).
  - `+` Menos dependências e menor superfície de manutenção na API.
  - `+` Build do frontend não gera arquivos-fonte acidentais.
  - `-` Scripts manuais de depuração deixam de existir; novas verificações
    devem ser feitas por testes automatizados.
- **Data:** 04/11/2026 — time C4Arch
