# ADR-0025 — PlantUML como formato de intercâmbio e pré-visualização server-side

- **Status:** Adotada (aprovada em 13/11/2026)
- **Data:** 14/11/2026 — time C4Arch
- **Relaciona-se com:** ADR-0003 (Docker + Compose), ADR-0021 (modelo canônico
  como fonte única de verdade), ADR-0022 (views como projeções do modelo)
- **Substitui:** o uso do Structurizr como formato de importação/exportação
  (removido nos commits de 13/11/2026)

## Contexto

O C4Arch mantém um **modelo canônico** no PostgreSQL e projeta esse modelo em
views, DAS e formatos de arquivo. A interoperabilidade precisava de um formato
textual que atendesse a três requisitos ao mesmo tempo:

1. **Legível e versionável** em Git, code review e documentação as-code.
2. **Editor e renderizador amplamente disponíveis**, sem amarrar o produto a um
   SaaS proprietário.
3. **Fidelidade ao C4**, com macros prontas para contexto, containers,
   componentes e dinâmica.

O Structurizr atendia ao C4, mas exigia um workspace proprietário e um servidor
próprio para renderização, além de não ter uma edição de texto simples no
produto. O PlantUML, com o padrão C4-PlantUML, cobre os requisitos e já é usado
pelo ecossistema de arquitetura.

O painel de código PlantUML (`PlantUmlSourcePanel`) permitia ver e reaplicar o
fonte, mas não mostrava o desenho. Sem pré-visualização, o usuário precisava
aplicar a alteração e sair do painel para conferir o resultado no canvas.

## Decisão

O PlantUML passa a ser o **formato textual de intercâmbio** do C4Arch, e a
pré-visualização é renderizada no servidor, nunca no navegador:

- **Importação** (`apps/api/src/c4/plantuml-import.ts`): o parser converte o
  diagrama C4-PlantUML em elementos, relações e views do modelo canônico. Existe
  também a importação como template (`plantuml-templates.ts`).
- **Exportação** (`apps/api/src/c4/exporters.ts`): `GET /api/models/{id}/export/plantuml`
  gera o `.puml` a partir do modelo canônico. É uma projeção descartável, não uma
  segunda fonte de verdade. O `!include` usa a biblioteca C4-PlantUML empacotada
  no próprio servidor PlantUML (`!include <C4/C4_Context>` e variantes), sem
  depender de `raw.githubusercontent.com`: em redes sem saída externa o include
  remoto falhava com `400` e derrubava a exportação.
- **Edição** (`apps/web/src/components/PlantUmlSourcePanel.tsx`): o painel exibe
  o fonte exportado, permite editar e aplicar (`replace`) de volta no modelo.
  Ele abre por três caminhos: pelo botão **PlantUML** do rodapé do editor, pelo
  botão **Editar código (PlantUML)** de cada linha da lista de arquivos (que
  abre o painel do modelo daquela linha sem sair da lista) e automaticamente em
  modelos criados ou importados via PlantUML. Nesse último caso a URL do editor
  recebe `?plantuml=1`, consumido no primeiro carregamento e removido da barra
  de endereços para não reabrir o painel a cada F5.
- **Pré-visualização** (`POST /api/plantuml/render`): a API codifica o fonte no
  formato de URL do PlantUML (`deflate` raw + base64 próprio, implementado em
  `apps/api/src/c4/plantuml-render.ts`) e busca o SVG em um servidor PlantUML
  configurado por `PLANTUML_RENDER_URL_TEMPLATE`. O endpoint exige JWT, aceita
  até 100 kB e aborta após 15 s, devolvendo `502` apenas em falha de transporte.
  Quando o PlantUML responde `400` com um SVG (erro de sintaxe ou `!include`
  inválido), esse desenho é encaminhado com `200 image/svg+xml` para que o
  usuário veja a mensagem do próprio PlantUML no painel. No navegador o SVG é
  exibido via `blob:`; a CSP da web libera `img-src 'self' data: blob:`.
- **Infraestrutura**: no Compose, o serviço `plantuml` usa a imagem oficial
  `plantuml/plantuml-server:jetty` e é acessível pela rede interna
  (`http://plantuml:8080/svg/{encoded}`). Em produção ele não publica porta no
  host. Fora do Docker, o padrão é o servidor público do PlantUML.
- **Documentação**: a skill em `.opencode/skills/plantuml/` registra sintaxe,
  C4-PlantUML, estilo e o contrato de integração com o C4Arch.

## Consequências

**Positivas**

- Intercâmbio em texto aberto, diffável, sem lock-in de fornecedor.
- A pré-visualização reflete exatamente o mesmo fonte que será aplicado ao
  modelo, reduzindo divergência entre código e canvas.
- O navegador não precisa carregar um renderizador PlantUML (Java/WASM) nem
  expor o token para serviços externos: a API faz o proxy autenticado.
- O modelo canônico permanece a única fonte de verdade; o SVG é descartável.

**Negativas / custos**

- Uma dependência de infraestrutura a mais (container `plantuml`, ~1,2 GB de
  imagem) e indisponibilidade do renderizador degrada apenas a pré-visualização.
- O limite de 100 kB do parser JSON vale para o fonte enviado; modelos muito
  grandes precisam de um endpoint com limite próprio antes de renderizar.
- O SVG não é cacheado (`Cache-Control: no-store`) para não servir desenho
  desatualizado após edições.

## Alternativas consideradas

| Alternativa | Motivo para não adotar |
|---|---|
| Renderizar no navegador com viz.js/PlantUML WASM | Bundle grande, divergência de versão do PlantUML e risco de bloquear a UI. |
| Manter Structurizr | Workspace proprietário, servidor extra e pouca aderência ao fluxo de edição textual. |
| Chamar o PlantUML público direto do navegador | Exigiria CORS/rede externa, exporia o conteúdo do modelo e não funcionaria atrás de firewalls corporativos. |
| Persistir o SVG renderizado no banco/storage | Precisa de invalidação a cada edição e não resolve o caso de fonte não aplicado. |
| Gerar a imagem a partir do modelo (sem PlantUML) | Duplicaria o renderizador e não cobriria fontes PlantUML editadas manualmente. |

## Referências

- `apps/api/src/c4/plantuml-render.ts` — codificação para o servidor PlantUML.
- `apps/api/src/controllers/plantuml.controller.ts` — endpoint de renderização.
- `apps/api/src/routes/plantuml.routes.ts` — rota autenticada.
- `apps/api/test/plantuml-render.test.ts` — round-trip do encoder.
- `.opencode/skills/plantuml/references/integracao-c4arch.md` — contrato de API.
