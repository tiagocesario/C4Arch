# ADR-0022 — Views como projeções do modelo

- **Status:** Adotada (aprovada em 11/11/2026; implementação na Onda 1)
- **Data:** 11/11/2026 — time C4Arch
- **Relaciona-se com:** ADR-0017 (vínculo de tipos de diagrama), ADR-0018
  (multi-diagrama no mesmo modelo), ADR-0021 (modelo canônico),
  ADR-0023 (DAS como projeção)
- **Substitui parcialmente:** ADR-0017 e ADR-0018 no que se refere a
  `models.diagrams` como definição das visões

## Contexto

Hoje o C4Arch chama de “multi-diagrama” o que, na prática, são **XMLs draw.io
independentes** guardados no mesmo registro de modelo:

```text
models
├── c4_type      = 'context'      (tipo do diagrama primário)
├── drawio_xml   = <XML do contexto>
└── diagrams     = [ { c4Type: 'container',  drawioXml: <XML> },
                     { c4Type: 'component',  drawioXml: <XML> },
                     { c4Type: 'code',       drawioXml: <XML> } ]
```

`resolveDiagramXml` escolhe o XML pelo tipo (`apps/api/src/c4/diagrams.ts`).
Cada XML é um desenho completo e autônomo. Isso tem três consequências:

1. **Divergência semântica:** o sistema “Pedidos” pode aparecer como
   “Pedidos API” no contexto, “Order Service” no container e “pedidos-svc” no
   componente. Não há nada que garanta que seja o mesmo elemento.
2. **Evolução não é derivação:** ao “evoluir” do contexto para o container, a UI
   cria um XML novo. O container não é uma projeção do contexto; é um desenho
   paralelo.
3. **Escopo frágil:** `models.c4_scope` é texto livre. Não é possível validar se
   a visão de container pertence ao sistema mostrado no contexto, nem navegar do
   elemento do contexto para a visão correspondente.

O Structurizr resolve isso com um modelo único e **views** que incluem/excluem
elementos por expressão, com layout separado. O C4Arch não precisa copiar o DSL,
mas precisa do mesmo conceito: **uma visão é uma consulta ao modelo, não um
desenho solto**.

## Decisão

1. **Adotar `model_views` como a definição de cada visão.** A view referencia
   elementos canônicos (ADR-0021) por ID; não contém cópia do modelo.

   ```text
   model_views
     id                UUID PK
     model_id          UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE
     key               TEXT NOT NULL          -- 'context', 'containers', 'components', ...
     type              TEXT NOT NULL          -- system_context | container | component |
                                              -- dynamic | deployment | filtered | image
     scope_element_id  UUID REFERENCES model_elements(id) ON DELETE SET NULL
     title             TEXT
     description       TEXT
     include           JSONB NOT NULL DEFAULT '[]'::jsonb
     exclude           JSONB NOT NULL DEFAULT '[]'::jsonb
     auto_layout       BOOLEAN NOT NULL DEFAULT FALSE
     created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
     updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
     UNIQUE (model_id, key)
   ```

2. **`include` e `exclude` são listas de regras declarativas**, avaliadas pelo
   resolvedor de views. O formato mínimo é:

   ```json
   { "kind": "person|software_system|container|component|relationship|*",
     "elementId": "uuid opcional",
     "parentElementId": "uuid opcional",
     "tag": "opcional",
     "depth": 1 }
   ```

   Regras são aplicadas em ordem: `include` primeiro, `exclude` depois. O
   resolvedor sempre inclui os ancestrais necessários para dar contexto
   (pessoa → sistema → container → componente) e as relações cujas duas pontas
   estão visíveis.

3. **`scope_element_id` substitui `c4_scope`.** Uma view de container tem
   `scope_element_id` apontando para o `software_system`; uma view de componente
   aponta para o `container`. Isso permite:

   - validar que a view pertence ao escopo;
   - navegar “drill-down” do contexto para containers e daí para componentes;
   - gerar o DAS na ordem correta.

4. **Layout é separado do modelo.** Posição, tamanho e estilo ficam em
   `model_view_layout`, por view e por elemento:

   ```text
   model_view_layout
     id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
     view_id     UUID NOT NULL REFERENCES model_views(id) ON DELETE CASCADE
     element_id  UUID REFERENCES model_elements(id) ON DELETE CASCADE
     object_key  TEXT            -- anotações visuais sem elemento C4
     x, y, width, height  DOUBLE PRECISION
     style       JSONB NOT NULL DEFAULT '{}'::jsonb
     UNIQUE (view_id, element_id) WHERE element_id IS NOT NULL
     UNIQUE (view_id, object_key) WHERE object_key IS NOT NULL
   ```

   O mesmo elemento pode estar em várias views com posições diferentes. Mudar o
   nome de um elemento não mexe no layout; mudar o layout não mexe no modelo.

5. **`models.diagrams` deixa de ser a definição das views.** Na migração, cada
   item de `diagrams` vira uma `model_view` com:

   - `key` = `c4Type` (`context`, `container`, `component`, `code`);
   - `type` derivado do `c4Type`;
   - `scope_element_id` inferido do modelo pai (`parent_id`) quando existir;
   - `include` inicial equivalente a “tudo que estiver no XML”, para preservar o
     comportamento atual;
   - `model_view_layout` extraído das posições das formas do XML, quando
     possível.

   O XML original é preservado em `models.drawio_xml`/`models.diagrams` como
   artefato de renderização e fallback, mas novas edições passam a atualizar o
   modelo canônico e o layout, não o XML como fonte.

6. **Draw.io vira um editor de view.** Ao abrir uma view no draw.io, o adapter:

   - resolve a view para o subconjunto de elementos/relações;
   - injeta `c4archElementId` e `c4archViewId` nos `mxCell`;
   - ao salvar, traduz alterações de volta para `model_elements`,
     `model_relationships` e `model_view_layout`.

   Formas sem `c4archElementId` são tratadas como anotações visuais da view
   (notas, legendas, imagens) e não criam elementos C4.

7. **Compatibilidade de API:**

   - `POST /api/models/:id/diagrams` continua aceitando `{ c4Type, drawioXml }`
     e cria/atualiza a `model_view` correspondente.
   - `GET /api/models/:id/drawio/xml?type=...` continua devolvendo XML, agora
     gerado a partir da view canônica (ou do XML legado, se a view ainda não
     existir).
   - Novas rotas (`/model`, `/views`, `/views/:viewId/layout`) são aditivas e
     documentadas em `docs/PLANO-MIGRACAO-ONDA-1.md`.

8. **Views padrão são criadas automaticamente** para modelos novos:

   | key | type | escopo |
   |---|---|---|
   | `context` | `system_context` | nenhum (landscape) |
   | `containers` | `container` | sistema principal, se existir |
   | `components` | `component` | primeiro container, se existir |

   O usuário pode criar views adicionais (dynamic, deployment, filtradas) sem
   duplicar o modelo.

## Consequências

### Positivas

- Contexto, container e componente passam a compartilhar os mesmos elementos.
- Drill-down deixa de ser “criar outro desenho” e vira navegação entre views.
- Layout sobrevive a mudanças de modelo e vice-versa.
- O DAS pode gerar seções por view com escopo confiável.
- Validação fica possível: view vazia, elemento fora de todas as views, view de
  container apontando para escopo inexistente.
- Exportação para Structurizr/PlantUML/Mermaid ganha uma estrutura clara
  (modelo + views + layout).

### Negativas e riscos

- **Migração de XML para view é lossy.** Formas livres, cores e agrupamentos
  visuais não têm equivalente C4. Mitigação: manter o XML como artefato e
  marcar views migradas como `legacy`.
- **Resolvedor de include/exclude é código novo e crítico.** Precisa de testes
  de unidade e de snapshot para não “sumir” elementos.
- **Usuários podem estranhar a mudança de “diagrama” para “visão”.** A UI deve
  manter o vocabulário atual (“Contexto”, “Container”, “Componente”) e explicar
  “visão” apenas onde agrega.
- **Duas fontes temporárias:** durante a transição, o adapter draw.io pode ler
  do XML legado e escrever no modelo canônico. Precisa de feature flag e
  reconciliação.
- **Performance:** resolver views grandes a cada request pode custar. Mitigação:
  cache por `(model_id, view_id, model_version_hash)` e invalidação por hash.

### Alternativas descartadas

- **Continuar com um XML por tipo:** mantém a divergência e impede validação,
  drill-down e DAS confiável.
- **Guardar o modelo inteiro dentro de cada view:** duplica dados e volta ao
  problema atual com outro nome.
- **Adotar o DSL do Structurizr como formato interno:** descaracteriza a UX
  visual e cria dependência conceitual desnecessária. O DSL pode ser suportado
  como import/export na Onda 2.

## Plano de adoção

Detalhado em `docs/PLANO-MIGRACAO-ONDA-1.md`:

1. Criar `model_views` e `model_view_layout` (M1).
2. Backfill: uma view por `c4Type` existente, com `include` amplo e layout
   extraído do XML (M2).
3. Endpoints de leitura de views e layout (M3).
4. UI passa a listar views e a abrir o editor por view (M4).
5. Adapter draw.io lê/escreve views canônicas atrás de flag (M5).
6. Remover leitura de `models.diagrams` como definição (M6).

## Referências

- `apps/api/src/c4/diagrams.ts`
- `apps/api/src/c4/model-types.ts`
- `apps/api/src/db/migrate.ts` (`models`, `elements`, `edges`)
- `docs/ADR/ADR-0017-vinculo-tipos-diagrama.md`
- `docs/ADR/ADR-0018-multi-diagrama-mesmo-modelo.md`
- `docs/ADR/ADR-0021-modelo-canonico-fonte-unica.md`
- `docs/PLANO-MIGRACAO-ONDA-1.md`
- Structurizr — views: <https://docs.structurizr.com/dsl/views>
