# ADR-0010 — Realtime: merge parcial, IDs estáveis e snapshot atômico

- **Status:** Adotada
- **Contexto:** O serviço `apps/realtime` aplicava `updateElement` substituindo
  o elemento inteiro. Como o frontend enviava apenas `id`, `positionX` e
  `positionY` ao arrastar um nó, os campos `title` e `type` eram sobrescritos
  por `undefined`. Além disso, o carregamento de snapshots usava
  `Object.entries` sobre um array, transformando o ID real em chave `"0"`.
  Conexões carregadas com `from_id`/`to_id` podiam perder a identidade, e a
  escrita do snapshot não era atômica.
- **Decisão:**
  1. `updateElement` monta um patch apenas com os campos definidos na
     mensagem e faz merge sobre o estado atual (`{ ...atual, ...patch }`),
     ignorando `id`, `modelId` e `model_id`.
  2. `createElement` usa o ID informado ou gera um UUID; conexões sem ID
     recebem UUID estável no momento da hidratação.
  3. `loadStorageModels` aceita tanto `elements` como array quanto como mapa
     `id -> elemento`, sem perder IDs.
  4. `from_id`/`to_id` e `position_x`/`position_y` são normalizados para
     `fromId`/`toId` e `positionX`/`positionY`.
  5. `modelId` é validado como UUID antes de compor o caminho do arquivo,
     impedindo path traversal.
  6. O snapshot é gravado em `<modelId>.json.tmp` e renomeado para
     `<modelId>.json`; também é salvo quando o último cliente desconecta.
  7. O carregamento do disco acontece antes de o servidor aceitar conexões.
- **Consequências:**
  - `+` Arrastar um nó não apaga mais título, tipo, descrição ou metadados.
  - `+` IDs de elementos e conexões permanecem estáveis entre recargas.
  - `+` Escrita de snapshot resiste a interrupções no meio da gravação.
  - `-` O realtime continua sendo uma fonte de estado paralela ao Postgres;
    a consolidação definitiva permanece como próximo passo.
- **Data:** 04/11/2026 — time C4Arch
