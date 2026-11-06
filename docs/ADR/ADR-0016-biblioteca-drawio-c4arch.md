# ADR-0016 — Biblioteca draw.io `c4arch`

- **Status:** Adotada
- **Data:** 2026-11-05 — time C4Arch

## Contexto

Apps e serviços reutilizáveis precisavam aparecer no editor draw.io como uma
biblioteca nomeada, com visual alinhado à biblioteca C4.

## Decisão

1. Gerar a biblioteca dinamicamente a partir de `apps` e `services` da organização.
2. Nomear a biblioteca como `c4arch` (`<mxlibrary title="c4arch">`).
3. Registrar a biblioteca via `configure` do draw.io (`libraries` + `defaultCustomLibraries`)
   para que apareça em "Mais Formas".
4. Usar estilo C4 para os shapes (azul para apps, azul-claro para serviços).
5. Oferecer download do XML da biblioteca (`GET /api/apps/library`) e botão na UI.

## Consequências

- + Novos apps/serviços aparecem automaticamente na biblioteca.
- + Visual consistente com C4.
- + Download permite uso offline/importação manual.
- - Aparição em "Mais Formas" depende do suporte do embed do draw.io.

## Referências

- `apps/api/src/controllers/drawio.controller.ts`
- `apps/api/src/controllers/apps.controller.ts` (`library`)
- `apps/web/src/services/api.ts` (`downloadAppLibrary`)
- `docs/PRD.md` (RF-16, RF-17)
