# ADR-0008 — WebSocket cliente: singleton, reconnect automático e estado inicial

- **Status:** Adotada
- **Contexto:** O cliente React perdia a conexão WebSocket e exibia `WS: offline` permanentemente. O botão "Desconectar" não interrompia o reconnect automático, e o estado do modelo vinha vazio ao abrir (sem arquivo de storage). Isso quebrou a edição do modelo e a sensação de que "o app não está conectado".
- **Decisão:** Utilizar um singleton `WebSocket` no frontend com reconnect automático (800ms) sempre que o `disconnect()` não for chamado. O botão "Desconectar" define `closedManually = true`, impedindo o reconnect. O `join` do modelo é enviado somente quando o socket está `OPEN`. O estado inicial do modelo é preenchido a partir do WebAPI (`API_URL` + `API_TOKEN`) quando o documento Yjs estiver vazio, antes de enviar a mensagem `state`.
- **Consequências:**
  - `+` Conexão resiliente; exibição "online/offline" fiel.
  - `+` O estado do modelo não sai vazio ao abrir, preservando os elementos carregados por REST.
  - `-` A taxa de reconnect é controlada por `setTimeout` (não adaptativa).
  - `-` O container `realtime` precisa de `API_URL`/`API_TOKEN` para consultar o Postgres via WebAPI.
- **Data:** 03/11/2026 — time C4Arch
