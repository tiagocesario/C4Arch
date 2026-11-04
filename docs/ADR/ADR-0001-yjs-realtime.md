# ADR-0001 — Sincronização em tempo real com Yjs + WebSocket

- **Status:** Adotada
- **Contexto:** O modelo precisa ser editado simultaneamente por vários usuários sem que um sobreescreva os outros. A equipe decidiu usar WebSocket como canais de comunicação e Yjs como suporte de estrutura (CRDT) para resistir a falhas de conexão e deduzir o estado.
- **Decisão:** Usar `apps/realtime` (serviço WebSocket standalone) com o protocolo Yjs. O estado ativo do modelo fica em memória no `realtime`; a persistência e as regras de negócio ficam no `apps/api` (PostgreSQL). A web (`apps/web`) envia operações (`patch`) via WebSocket e recebe `state`/`update` do `realtime`.
- **Consequências:** + edição simultânea real sem sobrescrever umas às outras; - complexidade de resolver conflitos de estrutura (dois editores deletando o mesmo elemento) e manutenção do `realtime` como serviço independente. Houve um escopo inicial para o storage em Drive/GitLab que ficou para a fase 2 (não implementado no MVP; o storage é JSON local).
