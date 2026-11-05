# ADR-0011 — Contrato de tipos do frontend e typecheck no build

- **Status:** Adotada
- **Contexto:** O `npm run build` do frontend usava `tsc -b`, mas o
  `tsconfig.json` incluía apenas `vite.config.ts`. O código React não era
  typecheckado e o build passava mesmo com 15 erros reais. Os tipos de
  domínio estavam duplicados e divergentes entre `services/types.ts` e
  `types/user.ts`; a API devolvia `snake_case` do Postgres, enquanto o
  realtime devolvia `camelCase`.
- **Decisão:**
  1. `apps/web/src/services/types.ts` passa a ser a fonte única dos tipos de
     domínio (`Model`, `Element`, `Edge`, `Folder`, `AppObject`,
     `ServiceObject`, inputs e `ModelDetail`).
  2. `apps/web/src/types/user.ts` mantém apenas tipos de usuário e permissões.
  3. `services/api.ts` centraliza a normalização de `snake_case` para
     `camelCase` e mapeia todos os DTOs de entrada/saída.
  4. O build passa a executar
     `tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit`
     antes do `vite build`.
  5. `tsconfig.json` estende `tsconfig.app.json` e inclui `src`; os artefatos
     gerados (`vite.config.js`, `vite.config.d.ts`, `*.tsbuildinfo`) deixam de
     ser produzidos e são ignorados pelo Git.
  6. O cliente WebSocket torna o socket nulo-seguro, preserva o modelo
     pendente entre reconexões, reenvia `join` ao abrir e ignora callbacks de
     sockets antigos.
- **Consequências:**
  - `+` Erros de tipo no código React passam a quebrar o build.
  - `+` Um único formato (`camelCase`) circula pelo frontend.
  - `+` Reconexão não perde o modelo aberto nem entra em loop de sockets.
  - `-` O frontend depende de um mapper explícito; novos campos da API
    precisam ser adicionados ao DTO correspondente.
- **Data:** 04/11/2026 — time C4Arch
