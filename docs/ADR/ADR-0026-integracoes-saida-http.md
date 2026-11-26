# ADR-0026 — Integrações de saída por HTTP (draw.io e DAS por modelo)

- **Status:** Adotada
- **Data:** 26/11/2026 — time C4Arch
- **Relaciona-se com:** ADR-0021 (modelo canônico como fonte única de
  verdade), ADR-0023 (DAS como projeção), ADR-0025 (PlantUML/draw.io como
  projeções do modelo), ADR-0014 (hardening de segurança)

## Contexto

O C4Arch já mantém o modelo C4 canônico e projeta esse modelo em draw.io, DAS e
PlantUML. Faltava publicar essas projeções em outros sistemas da empresa (portais
de documentação, catálogos, wikis, pipelines) sem exigir exportação manual nem
um conector dedicado para cada fornecedor.

Os requisitos levantados foram:

1. Cadastrar, por organização, as APIs dos sistemas de destino.
2. Vincular, por modelo, a URL que recebe o desenho draw.io e a URL que recebe o
   DAS.
3. Sempre que o modelo mudar, enviar as atualizações automaticamente por HTTP.
4. Não acoplar o C4Arch a um formato proprietário de um fornecedor específico.
5. Não permitir que a indisponibilidade de um sistema externo afete a edição do
   modelo.

## Decisão

### 1. Integração genérica por HTTP, configurada por organização

Criamos duas entidades:

- `external_systems` — cadastro da API de destino por organização (nome, URL
  base opcional, autenticação `none`/`bearer`/`basic`, headers extras e flag
  `enabled`);
- `model_external_bindings` — vínculo de um modelo com um sistema externo,
  contendo `drawio_url`, `das_url`, `method` (`POST`/`PUT`/`PATCH`), `format`
  (`json`/`raw`) e a flag `enabled`.

O contrato é HTTP puro: o C4Arch não conhece a semântica do receptor. Quem
integra escolhe o método, o formato e os headers; o conteúdo é sempre uma
projeção atual do modelo.

### 2. Payload autodescritivo

No formato `json`, o corpo inclui `event`, `target`, `content`, metadados do
modelo, o XML draw.io, o DAS e o fonte PlantUML. Assim o receptor tem contexto
suficiente para decidir o que armazenar, sem precisar consultar a API do
C4Arch. No formato `raw`, envia-se apenas o XML ou o Markdown do alvo, para
receptores simples (webhooks que gravam arquivo).

### 3. Entrega best-effort, assíncrona e com deduplicação

O envio é disparado por `queueModelExternalSync`, que não bloqueia a resposta da
operação principal e captura qualquer falha. Cada alvo é enviado
independentemente, de modo que uma URL quebrada não impede a outra.

O hash SHA-256 do conteúdo (com os metadados do modelo) é comparado ao último
hash entregue com sucesso. Conteúdo idêntico não é reenviado, o que evita
tráfego redundante em autosaves. O envio manual usa `force` para reconciliar.

### 4. Segurança proporcional ao caso de uso

Diferentemente da importação por URL pública, as integrações podem apontar para
a rede interna — esse é o caso de uso principal (portais e APIs internas). A
validação é sintática: http/https, host válido, sem credenciais embutidas,
limite de tamanho; faixas privadas não são bloqueadas.

O limite de confiança é o papel do usuário: configuração permitida a `owner` e
`editor`, remoção de sistema externo restrita a `owner`. Tokens nunca são
devolvidos pela API (apenas `hasAuthToken`). Redirecionamentos HTTP não são
seguidos, headers são validados contra CR/LF e as operações são auditadas.

## Consequências

**Positivas**

- Um único mecanismo cobre qualquer destino que fale HTTP, sem conectores
  específicos.
- A edição do modelo não depende da disponibilidade dos sistemas externos.
- Deduplicação evita chamadas repetidas em autosave.
- O contrato OpenAPI documenta o payload e o estado do último envio fica
  visível na UI.
- A separação sistema externo × vínculo permite reutilizar a mesma configuração
  de autenticação em vários modelos.

**Negativas / custos**

- Sem fila persistente ou retry automático, uma falha transitória perde o envio;
  é preciso reconciliar manualmente.
- O receptor precisa ser idempotente e tolerar reenvios (restauração de versão,
  envio manual).
- O envio roda no processo da API; modelos grandes adicionam custo de exportação
  e regeneração do DAS.
- A permissão de rede interna exige confiança no papel `editor`; organizações
  com requisitos mais rígidos devem restringir a configuração a `owner`.

## Alternativas consideradas

| Alternativa | Motivo para não adotar |
|---|---|
| Conector dedicado por fornecedor (wiki, portal etc.) | Explosão de integrações e manutenção; o contrato HTTP genérico cobre os casos. |
| Fila persistente com retry nesta versão | Aumentaria o escopo (worker, DLQ, observabilidade) antes de validar o uso real. |
| Envio síncrono dentro da requisição de salvamento | Acoplaria a edição à latência/disponibilidade de terceiros. |
| Webhook de entrada no receptor (callback) | Inverte a direção e exige que o receptor exponha um endpoint; o cadastro de URLs de saída é mais simples para o usuário. |
| Reutilizar a validação de importação (bloquear rede interna) | Impediria o caso de uso principal (APIs internas). |
| Enviar somente o DAS ou somente o draw.io | Perde a possibilidade de o receptor manter as duas visões sincronizadas; o vínculo permite escolher por URL. |

## Referências

- `apps/api/src/c4/external-sync.ts`
- `apps/api/src/controllers/integrations.controller.ts`
- `apps/api/src/routes/integrations.routes.ts`
- `apps/api/src/db/migrate.ts` (migration `004-external-integrations`)
- `apps/web/src/pages/IntegrationsPage.tsx`
- `apps/api/test/external-sync.test.ts`
- `docs/INTEGRACOES.md`
