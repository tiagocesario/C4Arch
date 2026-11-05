# ADR-0014 — Hardening de segurança da API, realtime e containers

- **Status:** Aceito
- **Data:** 2026-11-04
- **Contexto:** Revisão de segurança solicitada antes do commit e do deploy Docker.

## Contexto

A API expunha operações de modelos, elementos, conexões, pastas, aplicações e
serviços apenas com autenticação, sem verificar se o usuário pertencia à
organização do recurso. Isso permitia IDOR entre organizações. Além disso:

- o JWT de sessão (7 dias) era colocado na URL do draw.io;
- o WebSocket aceitava conexões anônimas e não autorizava o modelo por usuário;
- não havia headers de segurança, CORS restrito nem rate limit;
- o login tinha fallback de segredo vazio e comparação de hash não constante;
- containers rodavam com privilégios e portas expostas em todas as interfaces.

## Decisão

1. Centralizar configuração em `apps/api/src/config.ts` e falhar rápido em
   produção quando `JWT_SECRET` estiver ausente/curto.
2. Emitir tokens escopados de 5 minutos (`purpose: "drawio"`, `modelId`,
   audiência dedicada) para abrir o editor no navegador.
3. Criar helpers de autorização (`auth/access.ts`) e aplicá-los em todos os
   controllers de recursos organizacionais.
4. Autenticar o WebSocket pelo token de sessão validado em `/api/auth/me` e
   autorizar cada `join` em `/api/models/:id`.
5. Adicionar Helmet, CORS com allowlist, rate limit, `/healthz`, limite de corpo,
   tratamento de erro sem stack trace e política de senha.
6. Endurecer imagens e Compose: `npm ci`, runtime de produção com
   `--ignore-scripts`, non-root, healthchecks, `init`, `no-new-privileges`,
   `cap_drop: ALL`, filesystem somente-leitura em produção e bind local por padrão.

## Consequências

Positivas:

- elimina IDORs identificados entre organizações;
- reduz janela de uso de tokens vazados e remove o JWT de longa duração da URL;
- impede WebSocket anônimo e acesso a modelos de outras organizações;
- reduz superfície de ataque de containers e de endpoints de autenticação.

Negativas / trade-offs:

- o frontend precisa buscar o token do draw.io de forma assíncrona;
- o WebSocket precisa de um token válido e não reconecta em `1008`;
- viewers ainda podem escrever (RBAC por papel não foi implementado nesta ADR);
- rate limit em memória não é compartilhado entre réplicas.

## Alternativas consideradas

- **Manter JWT na URL do draw.io:** simples, mas vaza sessão longa em histórico,
  logs e referrer. Rejeitado.
- **Autorização apenas no frontend:** não protege contra chamadas diretas à API.
  Rejeitado.
- **WebSocket com token de serviço fixo:** não identifica o usuário e não permite
  autorização por modelo. Rejeitado.
- **`cap_drop: ALL` também no PostgreSQL:** maior risco de quebrar a inicialização
  do volume oficial; mantido apenas `no-new-privileges` no banco.

## Referências

- `apps/api/src/config.ts`
- `apps/api/src/auth/tokens.ts`
- `apps/api/src/auth/access.ts`
- `apps/realtime/src/sync.ts`
- `docker-compose.yaml`, `compose.production.yaml`
- `docs/SECURITY.md`
