# ADR-0021 — Modelo canônico e fonte única de verdade

- **Status:** Adotada (aprovada em 11/11/2026; implementação na Onda 1)
- **Data:** 11/11/2026 — time C4Arch
- **Relaciona-se com:** ADR-0001 (Yjs), ADR-0017/0018 (multi-diagrama),
  ADR-0019 (DAS automático), ADR-0022 (views), ADR-0023 (DAS com overrides),
  ADR-0024 (versionamento e persistência do estado colaborativo)
- **Substitui parcialmente:** ADR-0018 (o armazenamento de diagramas em
  `models.diagrams` deixa de ser a definição do modelo)

## Contexto

O C4Arch nasceu com duas representações concorrentes de arquitetura:

1. **Relacional:** `elements` e `edges` no Postgres, usados pelo editor React
   Flow, pelo catálogo e pelo gerador de DAS.
2. **Draw.io:** `models.drawio_xml` e `models.diagrams` (JSONB), usados pelo
   preview, pelo editor draw.io e também pelo gerador de DAS.

Além disso, o serviço realtime mantém o estado de edição em um `Y.Doc`
(`apps/realtime/src/sync.ts`) e grava snapshots JSON em disco. O worker copia
esses snapshots para `model_versions` a cada 30 segundos.

O resultado é que existem **quatro fontes de verdade**:

```text
Postgres (elements/edges)  ──► DAS
Yjs em memória             ──► snapshot em disco ──► worker ──► model_versions
draw.io XML (models.*)     ──► DAS
```

Consequências observadas:

- Edições feitas no canvas colaborativo não são gravadas em `elements`/`edges`;
  portanto, não aparecem no DAS.
- Após reiniciar o realtime, o canvas recupera o snapshot do disco, mas o
  Postgres e o DAS continuam com o estado anterior.
- O mesmo sistema pode ter elementos, nomes e relações diferentes em cada tipo
  de diagrama (`models.diagrams`), porque cada tipo é um XML independente.
- `c4_scope` é texto livre; não há vínculo verificável entre a visão de contexto
  e a de container.

O produto se apresenta como “um modelo C4 único e vivo”. Sem uma fonte única,
essa promessa não se sustenta.

## Decisão

1. **Adotar um modelo canônico explícito**, independente do draw.io e do
   formato de transporte colaborativo:

   ```text
   model_elements
     id, model_id, parent_element_id, identifier, kind,
     name, description, technology, url, tags[], properties jsonb

   model_relationships
     id, model_id, source_id, target_id,
     description, technology, tags[], properties jsonb

   model_views
     id, model_id, key, type, scope_element_id,
     title, description, include jsonb, exclude jsonb, auto_layout boolean

   model_view_layout
     view_id, element_id, x, y, width, height, style jsonb
   ```

2. **`kind` passa a representar o nível C4**, não o desenho:

   ```text
   person | software_system | container | component |
   deployment_node | infrastructure_node |
   container_instance | software_system_instance
   ```

   Os tipos atuais `actor`, `system`, `container` e `component` são mapeados para
   `person`, `software_system`, `container` e `component` na migração.

3. **Tecnologia, tags, propriedades e URL são de primeira classe** em elementos
   e relações. `metadata` continua existindo como escape para dados
   específicos, mas não é mais o único lugar para tecnologia.

4. **O modelo canônico é a fonte de verdade lógica.** O estado colaborativo
   (`model_state`) é a representação durável do documento Yjs; um **projetor
   idempotente** é o único componente que escreve nas tabelas canônicas. O DAS,
   as views, o catálogo, as dependências e a exportação leem o modelo canônico.

   ```text
   Canvas ──► Yjs ──► model_state (Postgres)
                          │
                          └──► projetor ──► model_elements / model_relationships / model_views
                                                   │
                                                   ├──► DAS
                                                   ├──► API REST
                                                   └──► exportação
   ```

5. **O draw.io deixa de ser a definição do modelo.** Ele passa a ser:
   - um editor visual que lê/escreve o modelo canônico via IDs estáveis
     (`c4archElementId`), e
   - um formato de importação/exportação e renderização.

   `models.drawio_xml` e `models.diagrams` permanecem por compatibilidade e como
   artefato de renderização, mas não são mais a fonte de verdade.

6. **`c4_scope` é substituído por `model_views.scope_element_id`**, que aponta
   para o elemento de sistema/container no qual a visão está ancorada.

7. **Compatibilidade:** as rotas REST existentes continuam funcionando. As
   rotas de `elements`/`edges` passam a operar sobre o modelo canônico; as rotas
   de `diagrams` passam a criar uma `model_view`. O legado é lido com fallback
   até a migração ser concluída.

## Consequências

### Positivas

- Canvas, draw.io e DAS passam a refletir o mesmo modelo.
- Contexto, container e componente deixam de divergir: são visões do mesmo
  conjunto de elementos.
- O DAS deixa de depender de heurísticas sobre XML para saber o que existe.
- Fica possível validar arquitetura, exportar para Structurizr/PlantUML/Mermaid
  e calcular dependências com semântica confiável.
- O catálogo de apps/serviços pode referenciar elementos canônicos por ID, em
  vez de depender de marcadores no XML.

### Negativas e riscos

- **Migração lossy:** diagramas draw.io podem conter formas que não têm
  correspondência no modelo C4. A estratégia é manter o XML como artefato de
  renderização e fazer importação best-effort, sinalizando modelos legados.
- **Custo do projetor:** modelos grandes podem gerar muitas operações. O
  projetor deve ser batch, idempotente e com debounce.
- **Mudança de conceito para o usuário:** “diagrama” passa a ser “visão”. A UI
  precisa explicar a diferença sem jargão.
- **Dupla escrita temporária:** durante a transição, API e projetor podem
  escrever nos dois formatos. A reconciliação deve ser monitorada.
- **Risco de regressão:** a mudança toca banco, API, realtime e UI. Feature flag
  e fallback para o legado são obrigatórios.

### Alternativas descartadas

- **Manter draw.io como fonte de verdade e gerar o modelo a partir do XML:**
  descartado porque o XML não tem semântica C4 estável e depende de heurísticas
  frágeis.
- **Manter Yjs como fonte de verdade e gerar o DAS a partir do estado em
  memória:** descartado porque o estado não é durável nem consultável, e o DAS
  precisa sobreviver a restarts.
- **Criar um DSL próprio e exigir que o usuário escreva texto:** descartado
  porque descaracteriza a UX visual e o público-alvo do C4Arch.

## Plano de adoção

O detalhamento está em `docs/PLANO-MIGRACAO-ONDA-1.md`. Resumo:

1. Criar as tabelas canônicas e `model_state` sem alterar comportamento.
2. Fazer backfill best-effort dos modelos existentes.
3. Ativar dual-write para modelos novos atrás de feature flag.
4. Ligar o projetor e fazer o DAS ler do modelo canônico com fallback.
5. Migrar a UI para views canônicas.
6. Remover o fallback e o dual-write depois de um ciclo de estabilização.

## Referências

- `apps/api/src/db/migrate.ts` (schema atual)
- `apps/api/src/c4/diagrams.ts` (`parseDiagrams`, `resolveDiagramXml`)
- `apps/api/src/c4/das.ts` (`generateDAS`, `regenerateModelDAS`)
- `apps/realtime/src/sync.ts` (`applyOperation`, `saveSnapshot`, `loadStorageModels`)
- `apps/worker/src/index.ts` (`syncSnapshots`)
- `docs/ADR/ADR-0018-multi-diagrama-mesmo-modelo.md`
- `docs/ADR/ADR-0019-importacao-modelos-das-automatico.md`
- `docs/PLANO-MIGRACAO-ONDA-1.md`
