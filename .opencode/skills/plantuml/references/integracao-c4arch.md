# IntegraÃ§Ã£o com o C4Arch

Como o C4Arch consome PlantUML: endpoints, templates, contrato do importador,
limitaÃ§Ãµes e fluxo de UI/MCP. O exportador gera C4-PlantUML a partir do modelo
canÃ´nico; o importador faz o caminho inverso.

## Mapa do cÃ³digo

| Arquivo | Papel |
| --- | --- |
| `apps/api/src/c4/plantuml-import.ts` | DetecÃ§Ã£o e parser C4-PlantUML â†’ `ImportedWorkspace` |
| `apps/api/src/c4/import-guards.ts` | Guardas contra importaÃ§Ã£o parcial/destrutiva |
| `apps/api/src/c4/model-import.ts` | PersistÃªncia genÃ©rica (legado + canÃ´nico, views, autolayout, draw.io) |
| `apps/api/src/c4/plantuml-templates.ts` | `PLANTUML_TEMPLATES` (5 padrÃµes prontos) |
| `apps/api/src/controllers/imports.controller.ts` | ValidaÃ§Ã£o, autorizaÃ§Ã£o, auditoria e endpoints |
| `apps/api/src/c4/exporters.ts` | `renderPlantUml` e metadados do formato `plantuml` |
| `apps/web/src/components/PlantUmlImportPanel.tsx` | Painel de importaÃ§Ã£o (novo modelo ou modelo existente) |
| `apps/web/src/components/PlantUmlSourcePanel.tsx` | Editor de fonte PlantUML do modelo |
| `apps/web/src/services/collaboration.ts` | `listPlantUmlTemplates`, `importPlantUmlWorkspace`, `importPlantUmlIntoModel` |
| `apps/mcp/src/index.ts` | Ferramenta `c4_import_plantuml` |

## Endpoints

### `GET /api/models/import/plantuml/templates`

Retorna os padrÃµes prontos:

```json
{
  "templates": [
    {
      "id": "containers",
      "name": "Sistema e containers",
      "description": "AplicaÃ§Ã£o web, API e banco de dados...",
      "c4Type": "container",
      "format": "plantuml",
      "content": "@startuml\n!include <C4/C4_Container>\n..."
    }
  ]
}
```

### `POST /api/models/import/plantuml`

Cria um modelo novo a partir do diagrama.

```json
{
  "orgId": "uuid",
  "content": "@startuml ... @enduml",
  "title": "Loja",
  "c4Type": "container",
  "folderId": "uuid|null",
  "parentId": "uuid|null",
  "format": "plantuml"
}
```

- `content` Ã© obrigatÃ³rio; limite de **5 MB**.
- `format` Ã© opcional, mas sÃ³ aceita `"plantuml"`.
- `c4Type` precisa ser um tipo C4 vÃ¡lido (`system-context`, `container`,
  `component`, `system-landscape`, `dynamic`, `deployment`, ...).
- Exige papel de escrita na organizaÃ§Ã£o.
- Cria o modelo como `draft`, importa em modo `replace`, regenera o DAS,
  grava auditoria (`model.import.plantuml`) e devolve `201` com o modelo e
  `import` (contagens).
- `folderId` e `parentId` sÃ£o validados contra a organizaÃ§Ã£o.
- O template oficial `blank` Ã© aceito: uma criaÃ§Ã£o nova pode comeÃ§ar sem
  elementos.
- RelaÃ§Ãµes que o parser nÃ£o interpretou cancelam a importaÃ§Ã£o com `400`
  antes de criar o modelo; um resultado parcial nunca Ã© persistido.

### `POST /api/models/{id}/import/plantuml`

Importa/substitui o conteÃºdo de um modelo existente.

```json
{
  "content": "@startuml ... @enduml",
  "mode": "replace",
  "title": "Loja",
  "c4Type": "container"
}
```

- `mode`: `replace` (padrÃ£o) ou `merge`.
- `replace` substitui elementos e relaÃ§Ãµes do modelo. Views existentes sÃ£o
  preservadas (a view do import Ã© atualizada por upsert), e elementos com o
  mesmo `identifier` mantÃªm o id canÃ´nico â€” com isso o layout manual das views
  preservadas e os vÃ­nculos com apps/serviÃ§os continuam vÃ¡lidos. Elementos que
  saÃ­ram do diagrama sÃ£o removidos.
- `merge` casa elementos por `identifier` e atualiza os existentes; relaÃ§Ãµes
  sÃ£o recriadas.
- Exige permissÃ£o de escrita no modelo.
- Uma relaÃ§Ã£o nÃ£o interpretada ou um `replace` sem elementos em um modelo
  existente responde `400` e nÃ£o altera o modelo.
- Resposta: `{ "ok": true, "das_content": "...", "import": { ... }, "model": { "elements": [...], "edges": [...] } }`.
  O snapshot Ã© o conteÃºdo recÃ©m-persistido e deve ser usado para sincronizar o
  canvas, sem depender de uma releitura concorrente.

### ExportaÃ§Ã£o

`GET /api/models/{id}/export/plantuml` gera `.puml` (`text/plain`). O formato
tambÃ©m aparece em `GET /api/models/{id}/exports`.

### PrÃ©-visualizaÃ§Ã£o

`POST /api/plantuml/render` renderiza um diagrama PlantUML em SVG, usado pela
prÃ©-visualizaÃ§Ã£o do painel de cÃ³digo. Recebe `{ "content": "..." }` (atÃ© ~100 kB,
limitado pelo parser de JSON da API) e retorna `image/svg+xml`. Requer
autenticaÃ§Ã£o e responde `502` quando o servidor PlantUML falha ou demora mais de
15 s.

Em Docker, o serviÃ§o `plantuml` (porta 8080 interna) Ã© usado; fora do Docker,
configure `PLANTUML_RENDER_URL_TEMPLATE` (padrÃ£o: servidor pÃºblico do PlantUML).
O valor precisa conter o marcador `{encoded}`.

Antes de codificar, a API chama `ensureC4Include`: se o texto usa macros C4
(`Person`, `System`, `Container`, `Component`, `Rel`, boundaries) sem declarar
`!include`, a diretiva do nÃ­vel adequado Ã© injetada. Assim a prÃ©-visualizaÃ§Ã£o
sempre desenha os Ã­cones oficiais do C4 model, mesmo quando o cÃ³digo colado veio
sem o include.

## Templates prontos

| `id` | Nome | `c4Type` | ConteÃºdo |
| --- | --- | --- | --- |
| `system-context` | Contexto do sistema | `system-context` | pessoas, sistema, sistemas externos |
| `containers` | Sistema e containers | `container` | web, API, banco |
| `microservices` | MicroserviÃ§os | `container` | gateway, serviÃ§os, fila, banco |
| `components` | Containers e componentes | `component` | componentes dentro de web e API |
| `blank` | Modelo em branco | `container` | sÃ³ `@startuml` + include |

Todos usam `!include <C4/C4_...>` e sÃ£o aceitos pelo parser.

## Contrato do importador

### DetecÃ§Ã£o

`detectPlantUmlFormat(content)` retorna `true` quando o texto contÃ©m
`@startuml` **ou** um `!include` que mencione `c4` (case-insensitive). Sem isso,
a importaÃ§Ã£o responde `400 Diagrama PlantUML invÃ¡lido`.

### Leitura

O parser percorre as declaraÃ§Ãµes lÃ³gicas do diagrama:

1. Remove comentÃ¡rios de linha (`'`, `//`) e de bloco (`/' ... '/`) sem
   alterar textos entre aspas; junta macros divididas em vÃ¡rias linhas.
2. Reconhece `title`/`caption` com texto simples ou entre aspas (inclusive
   `title("...")`) e usa o Ãºltimo valor de cada diretiva. O texto direto pode
   conter apÃ³strofos sem ser truncado como comentÃ¡rio.
3. Reconhece macros C4 no formato `Macro(arg1, arg2, ...)` e declaraÃ§Ãµes
   genÃ©ricas como `actor "UsuÃ¡rio" as user`, `actor user as "UsuÃ¡rio"` ou
   `database "Banco" as db`.
4. Elementos suportados (nomes case-insensitive):

| Macros | `kind` canÃ´nico |
| --- | --- |
| `Person`, `Person_Ext`, `Actor` | `person` |
| `System`, `System_Ext`, `SystemDb`, `SystemQueue` | `software_system` |
| `Container`, `Container_Ext`, `ContainerDb`, `ContainerQueue` | `container` |
| `Component`, `Component_Ext`, `ComponentDb`, `ComponentQueue` | `component` |
| `Deployment_Node`, `Node` | `deployment_node` |
| `Rectangle` | `software_system` |
| `Database`, `Queue` | `container` |
| `Interface`, `UseCase`, `Artifact` | `component` |

Fronteiras (`System_Boundary`, `Container_Boundary`, `Enterprise_Boundary` e
`Boundary`) nÃ£o existem como tipo no C4Arch: viram o elemento estrutural do seu
nÃ­vel (`software_system`, `container` ou `component`) para preservar a
hierarquia. Por isso elas aparecem na exportaÃ§Ã£o como `System(...)`,
`Container(...)` ou `Component(...)` com bloco.

5. RelaÃ§Ãµes: macros `Rel*`/`BiRel` e setas genÃ©ricas como `-->`, `..>`, `<--`,
   `<|--`, `*--`, `--*`, `<|..`, `..|>`, `-[#red]->` e `-right->`. A direÃ§Ã£o
   das setas reversas Ã© preservada; `Rel_Back*` inverte a direÃ§Ã£o e `BiRel*`
   cria uma relaÃ§Ã£o em cada sentido. Uma linha que pareÃ§a uma relaÃ§Ã£o, mas nÃ£o
   possa ser interpretada, Ã© registrada em `unrecognizedRelationships` e a API
   recusa a importaÃ§Ã£o para evitar um `replace` parcial.

Argumentos:

- `splitArgs` respeita aspas e parÃªnteses aninhados.
- Macros aceitam posiÃ§Ã£o (`alias`, `label`, ...) ou nomes (`$alias`, `$label`,
  `$descr`, `$technology`, `$tags`).
- 1Âº argumento Ã© o **alias**; aliases repetidos sÃ£o ignorados. Em declaraÃ§Ãµes
  genÃ©ricas, tanto `actor "Label" as alias` quanto `actor alias as "Label"`
  mantÃªm o alias estÃ¡vel e o label.
- `Person`/`System`: 2Âº = nome, 3Âº = descriÃ§Ã£o.
- `Container`/`Component`: 2Âº = nome, 3Âº = **tecnologia**, 4Âº = descriÃ§Ã£o.
- `Rel`: 1Âº origem, 2Âº destino, 3Âº rÃ³tulo, 4Âº tecnologia.
- `$tags` (separadas por `+`, `,` ou `;`) viram `tags` canÃ´nicas.
- `parentIdentifier` Ã© o elemento do bloco/boundary que contÃ©m a declaraÃ§Ã£o.
- `$sprite`, `$link`, `$url` e propriedades arbitrÃ¡rias continuam ignorados.

### Views

Uma Ãºnica view, com chave `default`. O tipo Ã© inferido do texto:

| Sinal no conteÃºdo | Tipo da view |
| --- | --- |
| `C4_Component` | `component` |
| `C4_Container` | `container` |
| `C4_Dynamic` | `dynamic` |
| `C4_Deployment` | `deployment` |
| nenhum | `system_context` |

### PersistÃªncia

`importWorkspaceIntoModel` grava:

- `elements`/`edges` (legado, usado pelo canvas);
- `model_elements`/`model_relationships`/`model_views` (canÃ´nico);
- `model_view_layout` e posiÃ§Ãµes com autolayout (`LR`, `gapX=90`,
  `gapY=32`). Em `replace`, sÃ³ as views do import sÃ£o reposicionadas; views
  preservadas mantÃªm o layout manual;
- `model_state` sincronizado com o grafo aplicado (Yjs durÃ¡vel). A revisÃ£o do
  estado Ã© usada como token CAS: o Realtime envia `expectedRevision`, a API
  responde `409` em divergÃªncia e o Realtime recarrega o estado durÃ¡vel. Um
  advisory lock PostgreSQL por `model_id` serializa importaÃ§Ãµes concorrentes atÃ©
  a conclusÃ£o dessa sincronizaÃ§Ã£o;
- XML draw.io inicial no padrÃ£o C4 (shapes oficiais do draw.io, rÃ³tulos com
  placeholders `%c4Name%`/`%c4Type%`/`%c4Technology%`/`%c4Description%` e
  boundaries pontilhadas para a hierarquia);
- tÃ­tulo, descriÃ§Ã£o (`caption`) e `c4_type` quando informados. O `title` do
  PlantUML atualiza o tÃ­tulo do modelo quando a requisiÃ§Ã£o nÃ£o envia um tÃ­tulo
  explÃ­cito; o `caption` atualiza a descriÃ§Ã£o persistida.

Em `replace`, elementos com o mesmo `identifier` reaproveitam o id canÃ´nico,
preservando `model_view_layout`, vÃ­nculos com apps/serviÃ§os e referÃªncias. O que
nÃ£o aparece no diagrama Ã© removido depois do upsert. Views que nÃ£o vieram do
import nÃ£o sÃ£o apagadas.

RelaÃ§Ãµes cujo destino/origem nÃ£o foi importado (ou self-loop) sÃ£o contadas em
`skippedRelationships`.

## LimitaÃ§Ãµes do parser

- **Sem tipo prÃ³prio para boundaries.** Fronteiras viram o elemento estrutural
  do nÃ­vel; a exportaÃ§Ã£o PlantUML mostra uma caixa a mais em relaÃ§Ã£o ao
  `*_Boundary` original e o desenho draw.io as representa como boundaries
  pontilhadas ao redor dos filhos.
- **Sprites, links e propriedades nÃ£o sÃ£o lidos.** `$sprite`, `$link`, `$url`,
  `AddElementTag` e propriedades arbitrÃ¡rias sÃ£o ignorados; `$tags` na prÃ³pria
  declaraÃ§Ã£o Ã© suportado.
- **`RelIndex` e `BiRel_D` nÃ£o sÃ£o suportados.** `RelIndex` e variantes
  `BiRel_*` diferentes de `BiRel` podem ser rejeitados como relaÃ§Ãµes nÃ£o
  interpretadas; a importaÃ§Ã£o nÃ£o persiste um resultado parcial.
- **Ãndices de relaÃ§Ã£o sÃ£o ignorados.** `$index` nÃ£o Ã© confundido com a
  tecnologia da relaÃ§Ã£o.
- **Tecnologia sÃ³ em container/componente.** Em `Person`/`System`, o 3Âº
  argumento Ã© descriÃ§Ã£o.
- **Sem atualizaÃ§Ã£o incremental de relaÃ§Ãµes no `merge`.** Elementos sÃ£o
  casados por identificador; relaÃ§Ãµes sÃ£o recriadas.
- **Um Ãºnico `title` e um Ãºnico `caption`.** O Ãºltimo valor de cada diretiva
  vence; a exportaÃ§Ã£o os coloca entre aspas para preservar apÃ³strofos.
- **Sem validaÃ§Ã£o semÃ¢ntica de C4.** O parser nÃ£o impede, por exemplo,
  componente ligado a pessoa.

## Checklist para diagrama importÃ¡vel

- [ ] Bloco comeÃ§a com `@startuml` e termina com `@enduml`.
- [ ] `!include <C4/C4_...>` Ã© recomendado para macros C4, mas nÃ£o Ã©
      obrigatÃ³rio em diagramas genÃ©ricos.
- [ ] Aliases sem espaÃ§os, hÃ­fens ou acentos.
- [ ] `Container`/`Component` com tecnologia no 3Âº argumento.
- [ ] RelaÃ§Ãµes com verbo e, quando fizer sentido, tecnologia no 4Âº; setas
      genÃ©ricas devem estar entre as formas suportadas.
- [ ] `$tags` opcional, separadas por `+` (`$tags="externo+critico"`).
- [ ] Sem `$index`, `RelIndex` ou `BiRel_D`.
- [ ] `title` opcional, mas consistente com o nome do modelo.

Exemplo mÃ­nimo importÃ¡vel:

```plantuml
@startuml
!include <C4/C4_Container>
title Loja

Person(cliente, "Cliente", "Compra na loja")
System_Boundary(loja, "Loja") {
  Container(web, "Web", "React", "Interface")
  Container(api, "API", "Node.js", "Regras")
  ContainerDb(banco, "Banco", "PostgreSQL", "Pedidos")
}

Rel(cliente, web, "Usa", "HTTPS")
Rel(web, api, "Chama", "REST")
Rel(api, banco, "LÃª e grava", "SQL")
@enduml
```

Resultado: 5 elementos (a fronteira `loja` vira um `software_system` pai de
`web`, `api` e `banco`), 3 relaÃ§Ãµes e 1 view `container`.

## ExportaÃ§Ã£o (`renderPlantUml`)

- Escolhe o include pelo maior nÃ­vel presente: `C4_Component.puml` se houver
  componente, senÃ£o `C4_Container.puml` se houver container, senÃ£o
  `C4_Context.puml`.
- Emite `Person`, `System`, `Container` ou `Component` usando o `identifier`
  canÃ´nico como alias; sem identificador, cai em `e0`, `e1`, ... Aliases sÃ£o
  sanitizados (sem espaÃ§os/acentos) e desambiguados quando colidem.
- Reproduz a hierarquia com boundaries oficiais: `System_Boundary`,
  `Container_Boundary` e `Boundary(alias, label, "Component")` para os
  elementos que tÃªm filhos (`parent_element_id`). O elemento estrutural aparece
  como fronteira, nÃ£o como caixa sÃ³lida, igual ao desenho draw.io.
- Reemite `$tags`, tecnologia de elemento e tecnologia da relaÃ§Ã£o.
- Inclui `title` e `caption` entre aspas, com escapes para preservar apÃ³strofos
  e aspas no round-trip.
- Usa `!include <C4/C4_...>`; a biblioteca C4 Ã© empacotada no servidor
  PlantUML e funciona sem acesso externo.

## UI

- **`PlantUmlImportPanel`**: cria modelo novo ou importa em modelo existente.
  Aceita colar conteÃºdo, escolher template, carregar `.puml`/`.plantuml`/
  `.txt`, definir tÃ­tulo, `c4Type` e modo (`replace`/`merge`). Mostra erros da
  API e as contagens do resultado.
- **PlantUmlSourcePanel**: carrega o modelo exportado como `plantuml`,
  permite editar e aplica com `mode: 'replace'`; avisa sobre alterações não
  aplicadas.

- **`DrawioController.import`** agora chama `syncModelFromDrawio`: elementos e
  relaÃ§Ãµes do XML salvo sÃ£o sincronizados (upsert) no modelo, o DAS Ã©
  regenerado e o estado colaborativo Ã© invalidado. Componentes inseridos no
  draw.io aparecem automaticamente no cÃ³digo PlantUML.
- O canvas Ã© sincronizado pela operaÃ§Ã£o realtime `replaceModel` apÃ³s a
  importaÃ§Ã£o; a API tambÃ©m atualiza o `model_state` durÃ¡vel com o snapshot
  persistido e devolve esse snapshot na resposta. Uma falha na releitura dos
  metadados nÃ£o cancela a propagaÃ§Ã£o do snapshot, e uma conexÃ£o realtime que
  nÃ£o confirma a atualizaÃ§Ã£o Ã© reportada Ã  interface. O Realtime usa
  `expectedRevision`; em `409`, recarrega o estado durÃ¡vel em vez de persistir
  o snapshot local antigo. O projetor preserva `identifier`, `url`, `tags`,
  hierarquia e tecnologia das relaÃ§Ãµes, que o Yjs nÃ£o transporta, e ignora
  flush com hash desatualizado.

## MCP

Ferramenta `c4_import_plantuml`:

```json
{
  "orgId": "uuid",
  "content": "@startuml ... @enduml",
  "title": "Loja",
  "c4Type": "container",
  "folderId": "uuid",
  "parentId": "uuid"
}
```

Cria um modelo novo (nÃ£o importa em modelo existente). Para exportar, use a
ferramenta de exportaÃ§Ã£o com `format: "plantuml"`.

## DiagnÃ³stico

| Sintoma | Causa provÃ¡vel |
| --- | --- |
| `400 Diagrama PlantUML invÃ¡lido` | falta `@startuml`/`!include` com `c4` |
| `400 Nenhum elemento C4 foi reconhecido` | o texto nÃ£o contÃ©m declaraÃ§Ã£o de elemento compatÃ­vel ou o `replace` seria destrutivo |
| Elemento sumiu | macro nÃ£o suportada, alias repetido ou referÃªncia que nÃ£o corresponde a um elemento |
| Tecnologia no lugar errado | 3Âº argumento de `Person`/`System` Ã© descriÃ§Ã£o |
| RelaÃ§Ã£o nÃ£o importada | origem/destino nÃ£o existe, self-loop ou `BiRel_D` |
| Estrutura achatada | o fonte nÃ£o usa blocos `{ ... }` (fronteiras e aninhamento sÃ£o preservados) |
| `413` | conteÃºdo acima de 5 MB |
| `403` | usuÃ¡rio sem papel de escrita |
| `404` | `folderId`/`parentId`/modelo fora da organizaÃ§Ã£o |

## Testes

- `apps/api/test/plantuml-import.test.ts` cobre detecÃ§Ã£o, elementos,
  tecnologia, relaÃ§Ãµes, `$tags`, boundaries/aninhamento, comentÃ¡rios, aliases
  repetidos e templates.
- `apps/api/test/exporters.test.ts` cobre a escolha do include, aliases
  canÃ´nicos, hierarquia, tags, tecnologia das relaÃ§Ãµes e round-trip
  exportar â†’ importar.
- `apps/api/test/projector.test.ts` cobre a preservaÃ§Ã£o de detalhes canÃ´nicos
  (`identifier`, `url`, `tags`, pai e tecnologia) durante a projeÃ§Ã£o do Yjs.
- `apps/web/test/components.test.tsx` cobre o painel de importaÃ§Ã£o.
- `apps/web/e2e/app.spec.ts` cobre o fluxo de UI.
