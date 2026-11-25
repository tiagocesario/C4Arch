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
  diagrama C4-PlantUML em elementos, relações e views do modelo canônico. Além
  das macros C4, aceita declarações genéricas do PlantUML (`actor`, `rectangle`,
  `database`, `component` etc.), setas como `-->`, `..>`, `<--`, `*--`, `--*`,
  `<|..`, `..|>`, `-[#red]->` e `-right->`, comentários de linha/bloco, macros
  multilinha e argumentos nomeados. As duas formas de alias genérico
  (`actor "Usuário" as user` e `actor user as "Usuário"`) preservam o alias
  estável e o label. O `title` e o `caption` do diagrama atualizam,
  respectivamente, o título e a descrição do modelo, inclusive quando contêm
  apóstrofos. Fronteiras (`System_Boundary`, `Container_Boundary`,
  `Enterprise_Boundary`) viram o elemento estrutural do seu nível (sistema,
  container ou componente) e os blocos aninhados viram `parent_element_id`;
  `technology`, `$tags` e a tecnologia das relações
  (`Rel(a, b, "x", "HTTPS")`) são persistidos no canônico. Se o parser
  encontrar uma relação que não conseguiu interpretar, a API responde `400`
  antes de qualquer escrita, evitando persistir um diagrama parcial. O template
  oficial `blank` é aceito na criação de um modelo novo; em um modelo existente,
  um `replace` sem elementos continua bloqueado para não apagar seu conteúdo.
  Existe também a importação como template (`plantuml-templates.ts`).
- **Exportação** (`apps/api/src/c4/exporters.ts`): `GET /api/models/{id}/export/plantuml`
  gera o `.puml` a partir do modelo canônico. É uma projeção descartável, não uma
  segunda fonte de verdade. O `!include` usa a biblioteca C4-PlantUML empacotada
  no próprio servidor PlantUML (`!include <C4/C4_Context>` e variantes), sem
  depender de `raw.githubusercontent.com`: em redes sem saída externa o include
  remoto falhava com `400` e derrubava a exportação. O fonte reemite hierarquia
  (blocos aninhados), `$tags`, tecnologia das relações e usa o `identifier`
  canônico como alias, para que exportar → editar → aplicar não renomeie
  elementos nem perca o layout de views que não vieram do import. `title` e
  `caption` são emitidos entre aspas e com escapes, de modo que um round-trip
  preserve textos com apóstrofos.
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
  configurado por `PLANTUML_RENDER_URL_TEMPLATE`. Antes de codificar, a API
  garante o `!include <C4/...>` quando o texto usa macros C4 sem declará-lo, de
  modo que a pré-visualização sempre mostre pessoas, sistemas, containers e
  componentes com os ícones oficiais do C4 model. O endpoint exige JWT, aceita
  até 100 kB e aborta após 15 s, devolvendo `502` apenas em falha de transporte.
  Quando o PlantUML responde `400` com um SVG (erro de sintaxe ou `!include`
  inválido), esse desenho é encaminhado com `200 image/svg+xml` para que o
  usuário veja a mensagem do próprio PlantUML no painel. No navegador o SVG é
  exibido via `blob:`; a CSP da web libera `img-src 'self' data: blob:`.
- **Exportação C4-PlantUML** (`renderPlantUml`): elementos com filhos viram
  boundaries oficiais (`System_Boundary`, `Container_Boundary` e
  `Boundary(..., "Component")`) em vez de caixas aninhadas, preservando a
  hierarquia e o visual C4 também no preview.
- **Desenho draw.io** (`renderDrawio`): o XML persistido na importação usa as
  shapes oficiais da biblioteca C4 do draw.io (`mxgraph.c4.person2` e as caixas
  de sistema, container e componente com as cores do c4model.com), os rótulos
  oficiais com placeholders (`%c4Name%`, `%c4Type%`, `%c4Technology%`,
  `%c4Description%`), boundaries pontilhadas para a hierarquia capturada de
  `parent_element_id` e relações no formato C4 (`endArrow=blockThin`). Assim um
  modelo importado do PlantUML abre no draw.io já no padrão C4, em vez de caixas
  genéricas.

- **Aplicação consistente**: o Postgres é a fonte de verdade, mas o canvas lê o
  documento Yjs. Ao aplicar, a API devolve o snapshot persistido e o painel
  envia `replaceModel` pelo WebSocket: na conexão principal quando o editor está
  aberto e em uma conexão dedicada quando o painel veio da lista (que também
  propaga a qualquer editor aberto em outra aba). Uma falha temporária na
  releitura dos metadados não impede a propagação do snapshot; se a conexão
  dedicada não confirmar a atualização, a interface informa a falha em vez de
  ignorá-la. A API sincroniza `model_state` com o grafo recém-aplicado e usa
  `model_state.revision` como token de concorrência: o Realtime envia a
  revisão-base, um `409` força a recarga do estado durável e impede que um
  snapshot antigo sobrescreva a importação. Importações concorrentes do mesmo modelo são
  serializadas por um advisory lock PostgreSQL até a sincronização de
  `model_state`. Ao projetar o Yjs, o projetor preserva os detalhes que o estado
  colaborativo não transporta (`identifier`, `url`, `tags`, hierarquia e
  tecnologia das relações) e ignora um flush cujo hash não corresponde mais ao
  de `model_state`. Views existentes também são preservadas; só a view do
  import é atualizada.
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
