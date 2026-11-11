# ADR-0023 — DAS como projeção com overrides

- **Status:** Adotada (aprovada em 11/11/2026; implementação na Onda 1)
- **Data:** 11/11/2026 — time C4Arch
- **Relaciona-se com:** ADR-0019 (importação e DAS automático), ADR-0021
  (modelo canônico), ADR-0022 (views), ADR-0024 (versionamento)
- **Substitui parcialmente:** ADR-0019 no ponto em que afirma que o DAS é
  “derivado e não editável”

## Contexto

O DAS é o artefato mais valorizado do C4Arch. Ele é gerado em português por
`generateDAS` (`apps/api/src/c4/das.ts`), a partir de:

- `elements`/`edges` do Postgres;
- XMLs draw.io (`models.drawio_xml` e `models.diagrams`);
- dados do modelo, organização e metadados.

O texto gerado é salvo em `models.das_content`. Existe também
`PUT /api/models/:id/das` (`updateDas`), e a UI oferece edição por seções
(`docs/UX-DAS-EDITOR.md`). Além disso, `regenerateModelDAS` roda:

- ao criar/editar o modelo;
- ao adicionar um tipo de diagrama;
- na importação draw.io;
- no startup da API para modelos antigos (`regenerateAllDAS`).

O problema é direto: **qualquer regeneração sobrescreve silenciosamente o texto
editado à mão**. O usuário investe tempo ajustando o DAS e perde o trabalho no
próximo evento. A ADR-0019 diz que o DAS é derivado e não editável; o código e a
UI dizem o contrário. A documentação, o produto e a implementação não estão
alinhados.

Há ainda um segundo problema: como o DAS lê `elements`/`edges` do Postgres e o
canvas colaborativo não grava nessas tabelas (ver ADR-0021), o DAS pode não
refletir o que o usuário desenhou. Regenerar, nesse cenário, pode até “piorar” o
documento.

## Decisão

1. **O DAS é uma projeção do modelo canônico com uma camada de overrides.**
   Separam-se três coisas:

   ```text
   modelo canônico  ──►  DAS gerado (determinístico)
                              │
                              ▼
                        overrides manuais (por seção)
                              │
                              ▼
                        DAS renderizado
   ```

2. **Novo armazenamento de overrides:**

   ```text
   model_das_overrides
     id            UUID PK
     model_id      UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE
     section_key   TEXT NOT NULL   -- '1', '2.1', '5.3', '6.2', 'custom:riscos', ...
     content       TEXT            -- Markdown substituindo a seção gerada
     mode          TEXT NOT NULL DEFAULT 'replace'
                   CHECK (mode IN ('replace','append','hide'))
     updated_by    UUID REFERENCES users(id) ON DELETE SET NULL
     updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
     UNIQUE (model_id, section_key)
   ```

   - `replace`: o conteúdo manual substitui a seção gerada.
   - `append`: o conteúdo manual é adicionado ao final da seção gerada.
   - `hide`: a seção é omitida do DAS renderizado.

3. **`models.das_content` deixa de ser a fonte.** Ele passa a guardar o último
   **DAS renderizado** (gerado + overrides), para leitura rápida, exportação e
   compatibilidade. A fonte continua sendo modelo + overrides.

4. **Regeneração nunca destrói override.** `regenerateModelDAS`:

   1. gera o DAS determinístico a partir do modelo canônico e das views;
   2. aplica `model_das_overrides`;
   3. grava o resultado em `models.das_content`;
   4. registra `das_generated_at`, `das_source_hash` e
      `das_override_count`.

   Overrides órfãos (seção que deixou de existir) são preservados e marcados
   como `orphan` na UI, nunca apagados automaticamente.

5. **A UI distingue claramente “gerado” de “editado”.** Cada seção tem um badge:

   | Badge | Significado |
   |---|---|
   | **Gerado** | Conteúdo vem do modelo; regenerar atualiza |
   | **Editado** | Existe override; regenerar preserva |
   | **Anexado** | Override em modo `append` |
   | **Oculto** | Seção escondida por override |
   | **Órfão** | Override de seção que não existe mais |

   Ações por seção: **Editar**, **Restaurar gerado** (remove o override) e
   **Ocultar/Mostrar**.

6. **Edição manual cria override, não texto solto.** `PUT /api/models/:id/das`
   continua funcionando, mas passa a gravar overrides por seção. Um campo
   legado de texto integral é aceito apenas para migração e convertido em um
   override `replace` na seção `document` (ou distribuído quando o texto tiver
   marcadores de seção reconhecíveis).

7. **O DAS lê do modelo canônico, não do XML.** A geração usa
   `model_elements`, `model_relationships` e `model_views` (ADR-0021/0022). O
   XML draw.io é usado apenas como fallback para modelos ainda não migrados.
   Isso elimina a divergência “canvas atualizado, DAS antigo”.

8. **Novas rotas:**

   ```text
   GET    /api/models/:id/das                    → DAS renderizado + metadados
   GET    /api/models/:id/das/overrides          → lista de overrides
   PUT    /api/models/:id/das/overrides/:section → cria/atualiza override
   DELETE /api/models/:id/das/overrides/:section → remove override (restaura gerado)
   POST   /api/models/:id/das/regenerate         → regenera preservando overrides
   GET    /api/models/:id/das/preview            → HTML/PDF sem persistir
   ```

   `GET /das` devolve, além do conteúdo:

   ```json
   {
     "content": "...",
     "generatedAt": "2026-11-11T12:00:00Z",
     "sourceHash": "sha256:...",
     "sections": [
       { "key": "5.2", "title": "Diagramas C4 — Container", "mode": "replace", "edited": true }
     ]
   }
   ```

9. **Determinismo e hash.** A geração deve ser determinística para o mesmo
   modelo + overrides. `das_source_hash` é o hash de
   `(model_content_hash + overrides_hash + template_version)`. Se o hash não
   mudou, `regenerateModelDAS` não reescreve `das_content` nem cria versão.

10. **Exportação preserva overrides.** PDF, Markdown e HTML exportados usam o
    DAS renderizado. A exportação nunca regenera por conta própria.

## Consequências

### Positivas

- Edições manuais deixam de ser perdidas — o problema mais grave do DAS atual.
- O DAS passa a refletir o canvas, porque ambos vêm do modelo canônico.
- A UI comunica com honestidade o que é gerado e o que é manual.
- Regeneração fica idempotente e barata (hash).
- O DAS pode ser versionado junto com o modelo (ADR-0024), incluindo overrides.
- A documentação, o produto e o código passam a contar a mesma história;
  ADR-0019 é corrigida em vez de ficar contraditória.

### Negativas e riscos

- **Granularidade de seção:** o template do DAS precisa ter chaves estáveis. Se
  a numeração mudar entre versões, overrides viram órfãos. Mitigação: chaves
  semânticas (`context.diagram`, `elements.table`) além da numérica, e aliases.
- **Migração de `das_content` existente:** textos editados hoje não têm
  informação de qual seção foi alterada. Mitigação: comparar com o DAS gerado e
  criar overrides apenas nas seções divergentes; o restante fica gerado.
- **Complexidade de merge:** `append` + `replace` + `hide` exigem ordem clara.
  Ordem definida: gerar → aplicar `hide` → aplicar `replace` → aplicar `append`.
- **Expectativa do usuário:** quem espera que “regenerar” sobrescreva tudo pode
  estranhar a preservação. A UI deve oferecer “Regenerar tudo (descartar
  edições)” como ação explícita e confirmada, separada de “Atualizar”.
- **PDF/HTML:** a renderização atual precisa continuar funcionando com o novo
  pipeline; testes de snapshot são necessários.

### Alternativas descartadas

- **Tornar o DAS totalmente imutável (como diz a ADR-0019):** descartado porque
  a UI e os usuários já editam, e o DAS precisa de contexto específico do
  projeto que o modelo não captura.
- **Tornar o DAS totalmente manual:** descartado porque perde o principal
  diferencial (geração automática em português a partir do modelo).
- **Guardar o DAS em documento separado (fora do modelo):** descartado porque
  cria mais uma fonte de verdade e complica versionamento e permissões.
- **Fazer merge por diff de texto:** frágil e imprevisível; overrides por seção
  são mais simples e auditáveis.

## Plano de adoção

Detalhado em `docs/PLANO-MIGRACAO-ONDA-1.md`:

1. Criar `model_das_overrides` e as colunas de metadados em `models` (M1).
2. Extrair chaves estáveis das seções do template atual (M2).
3. `regenerateModelDAS` passa a aplicar overrides e a respeitar hash (M3).
4. Backfill: converter `das_content` editado em overrides por seção (M3).
5. UI: badges, edição por seção, “Restaurar gerado”, “Regenerar tudo” (M4).
6. Exportação e startup passam a usar o pipeline novo (M5).

## Referências

- `apps/api/src/c4/das.ts` (`generateDAS`, `regenerateModelDAS`,
  `regenerateAllDAS`)
- `apps/api/src/controllers/models.controller.ts` (`das`, `updateDas`,
  `importModel`)
- `docs/UX-DAS-EDITOR.md`
- `docs/DAS-template.md`
- `docs/ADR/ADR-0019-importacao-modelos-das-automatico.md`
- `docs/ADR/ADR-0021-modelo-canonico-fonte-unica.md`
- `docs/PLANO-MIGRACAO-ONDA-1.md`
