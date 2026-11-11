# C4Arch — Estudo comparativo com o Structurizr

- **Versão:** 1.0.0
- **Data:** 11/11/2026
- **Status:** Estudo concluído; recomendações registradas em ADRs e no plano da Onda 1
- **Licença:** MIT
- **Escopo:** comparar o modelo, a arquitetura e as capacidades do Structurizr
  com a solução C4Arch e propor melhorias evolutivas, sem descaracterizar o
  produto.

## 1. Objetivo e método

Este estudo responde a três perguntas:

1. O que o Structurizr faz que o C4Arch ainda não faz?
2. O que o C4Arch faz melhor e não deve perder?
3. Quais mudanças trazem mais valor sem transformar o C4Arch em um clone do
   Structurizr?

Foram analisados:

- **Structurizr:** site oficial, documentação de workspace, DSL, language
  reference, views, inspections, exportação, servidor (versões, branches,
  editor de diagramas), MCP server, OpenAPI e a organização dos módulos no
  repositório GitHub (`structurizr-core`, `-dsl`, `-json`, `-export`,
  `-inspection`, `-autolayout`, `-client`, `-component`, `-import`, `-themes`,
  `-application`, `-mcp`).
- **C4Arch:** `docs/PRD.md`, `docs/DAS.md`, `docs/SECURITY.md`, ADRs 0018 a
  0020, código de `apps/api`, `apps/web`, `apps/realtime` e `apps/worker`,
  `docker-compose.yaml`, Helm chart e histórico Git.

### 1.1 Documentos derivados

| Documento | Conteúdo |
|---|---|
| `docs/ADR/ADR-0021-modelo-canonico-fonte-unica.md` | Modelo canônico e fonte única de verdade |
| `docs/ADR/ADR-0022-views-projecoes-do-modelo.md` | Views como projeções do modelo |
| `docs/ADR/ADR-0023-das-projecao-overrides.md` | DAS como projeção com overrides |
| `docs/ADR/ADR-0024-versionamento-restauravel.md` | Versionamento restaurável e persistência do estado colaborativo |
| `docs/PLANO-MIGRACAO-ONDA-1.md` | Plano detalhado de schema, endpoints, UI e rollout |

## 2. Resumo executivo

1. O Structurizr é **model-first**: um modelo único gera várias visões; o
   layout é separado do modelo; validação, versionamento e exportação são
   cidadãos de primeira classe.
2. O C4Arch é **colaboração-first + draw.io-first + DAS-first**. Esse é o
   diferencial do produto e deve ser preservado.
3. A maior lacuna conceitual é que o C4Arch tem **vários diagramas no mesmo
   registro**, mas ainda não tem **um modelo com várias visões**. Os tipos C4
   vivem em XMLs independentes (`models.diagrams`), então contexto, container e
   componente podem divergir.
4. A maior lacuna técnica é a existência de **quatro fontes de verdade**:
   Postgres (`elements`/`edges`), Yjs em memória, snapshots JSON em disco e o
   XML draw.io. O canvas colaborativo não persiste no Postgres; o DAS é gerado
   do Postgres + draw.io. Na prática, o desenho e o documento podem contar
   histórias diferentes.
5. O maior ganho de curto prazo é tornar o **modelo canônico** explícito e
   fazer DAS, draw.io e canvas serem **projeções/adaptadores** dele.
6. O segundo maior ganho é adotar três ideias de baixo risco e alto valor do
   Structurizr: **inspections**, **exportação/interoperabilidade** e
   **versionamento com restauração**.
7. Não se recomenda virar um clone do Structurizr. Recomenda-se um
   **Strangler Pattern**: adicionar a camada de modelo canônico por baixo da UX
   atual, sem quebrar o que já funciona.

## 3. O modelo mental do Structurizr

O Structurizr organiza tudo em um **workspace**:

```text
workspace
├── model          → pessoas, sistemas, containers, componentes,
│                    deployment nodes, infraestrutura e relações
├── views          → systemLandscape, systemContext, container, component,
│                    dynamic, deployment, filtered, custom, image
├── documentation  → Markdown/AsciiDoc
└── decisions      → ADRs Markdown/AsciiDoc
```

### 3.1 Ideias que valem para o C4Arch

| Ideia | Como o Structurizr faz | Por que importa |
|---|---|---|
| Modelo único | Elementos e relações existem uma vez; visões são projeções | Evita contexto/container/component divergentes |
| Layout separado | O JSON compilado guarda layout; o DSL guarda semântica | Editar o modelo não perde posicionamento manual |
| Hierarquia C4 rígida | `person → softwareSystem → container → component`; deployment à parte | Garante consistência e validação |
| Views com include/exclude | `include *`, expressões, `exclude`, `autoLayout` | Uma visão é uma consulta ao modelo, não um desenho solto |
| Inspections | Regras com severidade `error`/`warning`/`info`/`ignore` | “Lint” de arquitetura; melhora a qualidade do modelo |
| Exportação | PlantUML, C4-PlantUML, Mermaid, WebSequenceDiagrams, site estático, PNG/SVG, JSON | Interoperabilidade e publicação |
| Versionamento | 30 versões por padrão, visualização e “Revert to” | Histórico útil, não infinito |
| Branches | Publicar `main` e `dev` no mesmo workspace | Separação de ambientes sem duplicar workspace |
| Docs/ADRs no workspace | `!docs` e `!adrs` anexados ao sistema/container | A decisão fica perto do elemento que ela afeta |
| MCP/IA | Validar DSL, parsear, inspecionar, exportar e gerenciar workspaces | Torna o modelo consultável por agentes |
| OpenAPI + regras | Schema aberto e regras de validação documentadas | Contratos estáveis e tooling previsível |

### 3.2 O que o Structurizr não tenta ser

A colaboração do Structurizr é baseada em **versões, branches, lock/unlock e
publicação** — não em edição simultânea CRDT. O C4Arch é mais forte nesse ponto
e deve manter essa vantagem.

## 4. Como o C4Arch está estruturado hoje

### 4.1 Fluxo real de dados

```text
Canvas React Flow ──WS──► Yjs em memória ──► snapshot JSON em disco
                                                    │
                                                    └──► worker ──► model_versions

REST /elements /edges ──► Postgres ──► DAS (generateDAS/regenerateModelDAS)
draw.io XML ──► models.drawio_xml + models.diagrams (JSONB) ──► DAS
```

O canvas **não grava** `elements`/`edges` no Postgres. O realtime salva snapshots
em disco (`apps/realtime/src/sync.ts`, `saveSnapshot`/`loadStorageModels`) e o
worker copia esses snapshots para `model_versions` a cada 30 segundos
(`apps/worker/src/index.ts`, `syncSnapshots`). O DAS lê o Postgres e o XML
draw.io (`apps/api/src/c4/das.ts`, `regenerateModelDAS`).

### 4.2 Pontos fortes que precisam ser preservados

- Colaboração em tempo real com Yjs.
- Editor draw.io integrado, com biblioteca `c4arch` e catálogo de apps/serviços.
- DAS automático em português, com inventário e seções por tipo C4.
- Multi-tenant por organização, pastas em árvore, catálogo, grupos de acesso e
  Google SSO.
- Importação em lote de arquivo/pasta/Drive/URL com proteção anti-SSRF.
- Postura de segurança acima da média para um MVP: tokens escopados, RBAC,
  containers non-root, Helm chart.

## 5. Comparativo direto

| Dimensão | Structurizr | C4Arch hoje | Leitura |
|---|---|---|---|
| Fonte de verdade | Workspace (DSL/JSON) | Postgres + Yjs + disco + XML draw.io | C4Arch precisa consolidar |
| Unidade central | Modelo + views | “Modelo” que contém XMLs por tipo | Conceito diferente com o mesmo nome |
| Níveis C4 | Pessoa, sistema, container, componente, deployment | `actor`, `system`, `container`, `component` | Falta `person`/`software_system` explícitos e deployment real |
| Tecnologia no elemento | Campo de primeira classe | Só em `metadata` ou no rótulo draw.io | DAS e diagramas ficam pobres |
| Relacionamentos | Descrição + tecnologia + tags + properties | `label` + `type` (`call/http/message/depends`) | `type` mistura estilo de interação com semântica C4 |
| Visões | Múltiplas views do mesmo modelo | Um XML por tipo, sem inclusão/exclusão | Maior lacuna conceitual |
| Layout | Separado, com autolayout e editor dedicado | Dentro do XML draw.io | Trocar modelo pode perder layout |
| Colaboração | Versões, branches, lock/unlock | CRDT em tempo real | Vantagem do C4Arch |
| Documentação | Docs/ADRs dentro do workspace | DAS gerado + ADRs no repositório | DAS é forte; ADRs não aparecem no produto |
| Validação | Inspections com severidade | Nenhuma validação de arquitetura | Oportunidade clara |
| Versionamento | 30 versões + restore | Worker cria versão a cada 30s, sem restore | Precisa correção |
| Exportação | PlantUML, Mermaid, site estático, PNG/SVG, JSON | Draw.io XML + DAS Markdown/PDF | Falta interoperabilidade |
| Extensibilidade/IA | MCP server, scripts, plugins | Nenhum | Oportunidade de diferenciação |
| Operação enterprise | S3/Azure, Redis, Lucene/Elastic, SAML, branches | Postgres, disco local, Google SSO | Suficiente para MVP; evoluir depois |
| UX | DSL-first, poderosa e íngreme | Visual, simples, em português | Não copiar a frieza do DSL-first |

## 6. Lacunas críticas

### L1. “Um modelo, várias visões” ainda não existe de fato

`models.c4_type` + `models.drawio_xml` guardam o diagrama primário;
`models.diagrams` guarda um XML independente por tipo extra
(`apps/api/src/c4/diagrams.ts`, ADR-0018). Ao “evoluir para container”, cria-se
um desenho novo, não uma visão derivada do contexto. Isso permite que o mesmo
sistema tenha nomes, elementos e relações diferentes em cada aba.

Além disso, `c4_scope` é texto livre, não um vínculo a um elemento de
sistema/container. Não há como validar se a visão de container pertence ao
sistema do contexto.

### L2. Quatro fontes de verdade

- `apps/realtime/src/sync.ts`: patches são aplicados no `Y.Doc`, serializados e
  salvos em disco. Não há `UPDATE` em `elements`/`edges` do Postgres.
- `apps/worker/src/index.ts`: a cada 30s copia cada snapshot para
  `model_versions`, sem deduplicação.
- `apps/api/src/c4/das.ts`: o DAS lê `elements`/`edges` do Postgres e o XML
  draw.io. Portanto, **edições feitas no canvas não aparecem no DAS**.
- O canvas carrega `model.elements` do REST, mas recebe updates do WS; após
  restart, o realtime carrega o snapshot do disco, então o canvas “volta” com as
  edições, mas o Postgres/DAS continuam desatualizados.

Esse é o risco mais grave para a proposta de “modelo único e vivo”.

### L3. DAS é derivado, mas editável — e a regeneração sobrescreve

ADR-0019 diz que `das_content` é derivado e não editável. Mas existe
`PUT /api/models/:id/das` (`updateDas`) e a UI tem editor por seções. Qualquer
`regenerateModelDAS` sobrescreve o conteúdo manual. O usuário pode perder
trabalho sem aviso claro.

### L4. Semântica C4 rasa

- `ElementType = actor | system | container | component` não distingue pessoa de
  sistema, nem permite deployment nodes/instances.
- Não há `technology` de primeira classe em elementos e relações.
- Não há `tags`, `properties`, `url`, `perspectives`, grupos/boundaries.
- `EdgeType` (`call`, `http`, `message`, `depends`) não é a mesma coisa que a
  descrição/tecnologia C4 de uma relação.
- `dynamic` e `deployment` são apenas “tipos de desenho”, não visões com
  semântica de sequência/instância.

### L5. Nenhuma validação de arquitetura

Não há equivalente às inspections do Structurizr: elemento sem descrição,
container sem tecnologia, relação sem descrição, elemento desconectado,
elemento fora de qualquer visão, nome duplicado no escopo, visão vazia. Hoje o
DAS é gerado mesmo com um modelo incompleto, o que transmite falsa sensação de
completude.

### L6. Interoperabilidade limitada

Só há exportação draw.io XML e DAS. Não há exportação para Structurizr JSON/DSL,
PlantUML, C4-PlantUML, Mermaid, site estático, PNG/SVG. Também não há importação
de DSL/JSON do Structurizr. Isso impede o C4Arch de ser adotado por quem já tem
modelo as code.

### L7. Versionamento com crescimento sem controle

O worker cria uma versão a cada 30 segundos por arquivo de snapshot, mesmo sem
mudança. Não há hash de conteúdo, retenção, autor, label ou API/UI de
restauração. Em poucos dias o histórico fica inútil e o banco cresce. O
Structurizr retém 30 versões e oferece “Revert to”.

### L8. Qualidade de engenharia e operação

- `apps/web/src/App.tsx` tem **2.820 linhas**, com estilos inline, sem router e
  sem separação por feature.
- A suíte tem 5 arquivos de teste na API + 1 no realtime; não há testes de
  frontend, e2e ou contrato.
- Não existe `.github/` com CI.
- `migrate.ts` cria `apps` e `services` duas vezes e engole erros de `ALTER` com
  `try/catch`.
- O worker tem migrações próprias (`model_versions`, `integrations`) diferentes
  das da API — dois donos do schema.
- `apps/api/storage/34d6c940-....json` está versionado no Git; snapshot de
  runtime não deveria estar no repositório.
- Há divergência de documentação: `docs/PRD.md` e `docs/SECURITY.md` falam em
  100 kB de importação, enquanto o código aceita 5 MB.
- `package.json` da web declara `eslint .`, mas não há dependência/config de
  ESLint.

### L9. draw.io como dependência externa e limite de URL

`getDrawioPreviewUrl` coloca o XML inteiro no hash da URL do
`viewer.diagrams.net`. Isso funciona para diagramas pequenos, mas:

- URLs muito longas podem falhar em navegadores/proxies;
- o conteúdo do modelo sai da infraestrutura do C4Arch;
- não há renderização server-side (PNG/SVG) para embed/publicação.

### L10. Colaboração ainda não usa todo o potencial do Yjs

O servidor aplica operações e transmite o **estado completo** a cada patch. Não
há protocolo de sync do Yjs, awareness/presença, cursores, undo/redo, salas por
visão, nem merge offline. Para 4 editores funciona, mas não escala e não entrega
a experiência “Google Docs” que o produto promete.

## 7. Melhorias recomendadas

As melhorias estão organizadas em três ondas. O detalhamento de schema,
endpoints e UI da Onda 1 está em `docs/PLANO-MIGRACAO-ONDA-1.md`.

### 7.1 Onda 1 — Fundação do modelo (2 a 4 sprints)

| # | Melhoria | Resultado esperado |
|---|---|---|
| 1 | Modelo canônico (`model_elements`, `model_relationships`, `model_views`) | Canvas, draw.io e DAS passam a falar a mesma língua |
| 2 | Persistência do estado colaborativo no Postgres (`model_state` + projetor) | Fim da divergência entre canvas e DAS |
| 3 | DAS como projeção com overrides (`model_das_overrides`) | Edição manual não é mais sobrescrita |
| 4 | Versionamento por hash, com autor, label, retenção e restore | Histórico útil e recuperável |
| 5 | Quick wins de documentação, Git, worker e CI | Redução de ruído e regressões |

### 7.2 Onda 2 — Valor visível (1 a 2 quarters)

| # | Melhoria | Resultado esperado |
|---|---|---|
| 6 | Inspections / “saúde da arquitetura” | Modelos incompletos ficam visíveis e corrigíveis |
| 7 | Exportação Structurizr JSON/DSL, C4-PlantUML, Mermaid, site estático, PNG/SVG | Interoperabilidade e publicação |
| 8 | Importação de Structurizr DSL/JSON | Adoção por equipes que já usam model-as-code |
| 9 | Layout separado, autolayout, chave/legenda, estilos e temas | Melhor experiência visual |
| 10 | Presença, comentários por elemento, undo/redo, salas por view | Colaboração de verdade |
| 11 | Preview server-side (PNG/SVG) e adapter draw.io com IDs estáveis | Menos dependência do viewer externo |

### 7.3 Onda 3 — Escala e qualidade (contínuo)

| # | Melhoria | Resultado esperado |
|---|---|---|
| 12 | Split do frontend por features, router, camada de dados | Manutenibilidade |
| 13 | Testes de componente, e2e, integração e contrato; CI obrigatório | Qualidade sustentável |
| 14 | Migrações versionadas, um único dono do schema | Operação previsível |
| 15 | OpenAPI, cliente gerado, erros padronizados, idempotência | Contratos estáveis |
| 16 | MCP server do C4Arch (validar, inspecionar, exportar, gerar DAS) | Diferenciação em IA |
| 17 | Observabilidade, auditoria, backup/restore, SBOM | Operação enterprise |

## 8. Roadmap sugerido

| Onda | Foco | Entregáveis | Critério de aceite |
|---|---|---|---|
| **1 (0–6 semanas)** | Fundação | Modelo canônico + views; persistência do realtime no Postgres; DAS com overrides; versionamento com hash/restore; quick wins | Canvas e DAS contam a mesma história após restart; nenhuma edição manual do DAS é perdida; versões só mudam quando há mudança |
| **2 (6–14 semanas)** | Valor visível | Inspections; exportação Structurizr JSON/DSL/PlantUML/Mermaid; layout separado + autolayout; presença/comentários | Modelo de exemplo passa com 0 erros; export/import round-trip sem perda; usuários veem presença e comentários |
| **3 (14–26 semanas)** | Escala e qualidade | Split do frontend; CI/testes/e2e; OpenAPI; MCP; observabilidade | PR com CI verde e cobertura mínima; API documentada; MCP validando e exportando |

## 9. Quick wins (1 a 2 dias cada)

| # | Ação | Onde |
|---|---|---|
| 1 | Remover snapshot de runtime do Git e ignorar `storage/` | `apps/api/storage/`, `.gitignore` |
| 2 | Corrigir 100 kB vs 5 MB na documentação | `docs/PRD.md`, `docs/SECURITY.md`, `README.md` |
| 3 | Normalizar `positionx`/`positiony` legados | `apps/realtime/src/sync.ts` |
| 4 | Worker: hash de conteúdo, pular inalterados, retenção 30 | `apps/worker/src/index.ts` |
| 5 | Adicionar CI básico | `.github/workflows/ci.yml` |
| 6 | Configurar ESLint ou remover script quebrado | `apps/web/package.json` |
| 7 | Endpoint de validação com 5 regras simples + badge na UI | `apps/api`, `apps/web` |
| 8 | Indicador “DAS gerado/editado” + preservar overrides | `apps/web/src/App.tsx`, `apps/api` |
| 9 | Concorrência otimista em `PUT /models/:id` | `apps/api/src/controllers/models.controller.ts` |
| 10 | OpenAPI parcial (auth, models, views, DAS) | `apps/api` |

## 10. Guardrails: o que não mudar

- **Não remover a colaboração em tempo real.** É o principal diferencial contra
  o Structurizr.
- **Não abandonar o draw.io.** Ele deve virar um adaptador/editor visual do
  modelo canônico, não o modelo em si.
- **Não abandonar o DAS em português.** Ele é o artefato que o público
  brasileiro valoriza; só precisa ser confiável e derivado de verdade.
- **Não impor DSL como entrada principal.** DSL é interoperabilidade e power
  user, não a UX padrão.
- **Não quebrar APIs/UX existentes.** Use strangler + feature flags + fallback
  para o legado.
- **Não copiar código Apache-2.0 sem observar NOTICE/atribuição.** Conceitos e
  o schema JSON aberto podem ser implementados de forma independente.

## 11. Decisões aprovadas

As quatro decisões pendentes foram respondidas em 11/11/2026 e passam a valer
para a Onda 1:

1. **O draw.io é um adaptador, não o editor canônico.** O modelo canônico fica
   no Postgres e o draw.io lê/escreve via IDs estáveis (`c4archElementId`).
2. **Sincronização com Git/Drive é integração opcional.** Funciona como
   espelho/histórico, nunca como fonte de verdade.
3. **Rigor C4:** hierarquia completa + inspections, mantendo a UX simples.
   `dynamic` e `deployment` entram na Onda 2.
4. **Produto self-host.** Não é SaaS multi-tenant nesta fase; isso simplifica
   versionamento, storage, busca e observabilidade.

O plano da Onda 1 foi aprovado. O M0 (preparação) e o M1 (schema canônico)
foram concluídos em 11/11/2026. As evidências estão em
`docs/M0-CHECKLIST.md` e `docs/M1-CHECKLIST.md`; o M2 (backfill) ainda não foi
iniciado.

## 12. Referências

- Structurizr — site: <https://structurizr.com/>
- Structurizr — documentação: <https://docs.structurizr.com/>
- Structurizr — DSL: <https://docs.structurizr.com/dsl>
- Structurizr — workspaces: <https://docs.structurizr.com/workspaces>
- Structurizr — inspections: <https://docs.structurizr.com/workspaces/inspections>
- Structurizr — exportação: <https://docs.structurizr.com/export>
- Structurizr — versionamento: <https://docs.structurizr.com/server/workspace-versions>
- Structurizr — branches: <https://docs.structurizr.com/server/workspace-branches>
- Structurizr — editor de diagramas: <https://docs.structurizr.com/server/diagrams/editor>
- Structurizr — MCP server: <https://docs.structurizr.com/ai/mcp>
- Structurizr — OpenAPI: <https://docs.structurizr.com/openapi>
- Repositório Structurizr: <https://github.com/structurizr/structurizr>
- C4 model: <https://c4model.com/>
- C4Arch — `docs/PRD.md`, `docs/DAS.md`, `docs/SECURITY.md`
- C4Arch — ADR-0018, ADR-0019, ADR-0020
