# Segurança — C4Arch

Este documento descreve os controles de segurança aplicados, como configurá-los e
quais riscos ainda são conhecidos. Ele complementa o `README.md` e o `docs/PRD.md`.

## Modelo de ameaça (resumo)

Ativos principais:

- credenciais e sessões de usuários;
- modelos C4, elementos, conexões e diagramas draw.io de cada organização;
- segredos de infraestrutura (JWT, banco, integrações Drive/GitLab).

Ameaças tratadas nesta revisão:

- acesso indevido a recursos de outra organização (IDOR);
- roubo de sessão por URL/histórico do navegador;
- força bruta e abuso de endpoints de autenticação;
- conexões WebSocket anônimas ou sem autorização por modelo;
- segredos fracos ou ausentes em produção;
- execução de container com privilégios desnecessários.

## Controles implementados

### Autenticação

- `JWT_SECRET` é obrigatório. Em produção a API não inicia com segredo ausente ou
  com menos de 32 caracteres; em desenvolvimento um segredo fraco gera aviso.
- Tokens de sessão são assinados com HS256, `issuer: c4arch` e expiração
  configurável (`JWT_EXPIRES_IN`, padrão `7d`).
- O middleware exige exatamente `Authorization: Bearer <token>`; não aceita
  token de sessão na query string.
- Senhas usam `scrypt` com salt aleatório por usuário e comparação
  `crypto.timingSafeEqual`.
- Login com e-mail inexistente executa o mesmo custo de KDF e retorna a mesma
  mensagem genérica, reduzindo enumeração de usuários.
- Política mínima: senha com 8–1024 caracteres; e-mail normalizado; nome limitado.
- Registro público pode ser desligado com `ALLOW_REGISTRATION=false`.

### Autorização

- Toda rota de modelo, elemento, conexão, pasta, aplicação e serviço verifica se
  o usuário é membro da organização do recurso.
- Recursos de outra organização retornam `404` (não revelam existência).
- Criação de modelo/pasta/aplicação/serviço valida se o `orgId` pertence ao usuário.
- Criação/edição de conexões valida se os elementos referenciados pertencem ao modelo.
- Criação de organização associa o criador como `owner` em transação.
- Adicionar membro exige papel `owner` na organização.

### draw.io

- O navegador não recebe mais o JWT de sessão na URL.
- `POST /api/models/:id/drawio/token` emite um token com `purpose: "drawio"`,
  `modelId`, audiência `c4arch-drawio` e validade de 5 minutos.
- O editor só aceita esse token para o modelo correspondente, ou um Bearer de
  sessão válido para uso via API.
- A página do editor define CSP restritiva, `Referrer-Policy: no-referrer` e
  `Cache-Control: no-store`.
- XML de importação é limitado a 100 kB e validado minimamente.

### API HTTP

- `helmet` com `x-powered-by` desabilitado.
- CORS com allowlist explícita em `CORS_ORIGIN` (separada por vírgula), sem wildcard.
- Corpo JSON limitado a 100 kB.
- Rate limit global em `/api` (300 req/15 min por IP) e mais restrito em
  `/api/auth/login` e `/api/auth/register` (10 req/15 min por IP).
- `/healthz` verifica a conexão com o PostgreSQL.
- Handler final de erros não vaza stack trace; 404 padronizado.
- `TRUST_PROXY=true` só deve ser usado atrás de proxy confiável.

### WebSocket (realtime)

- A conexão exige `?token=<JWT de sessão>`; o token é validado em
  `GET /api/auth/me`.
- Cada `join` é autorizado em `GET /api/models/:id`, garantindo que o usuário
  pertence à organização do modelo.
- Token inválido fecha a conexão com código `1008`; o cliente não entra em loop
  de reconexão.
- Payload máximo de 1 MB e limite de 300 mensagens por 10 s por conexão.
- `WS_ALLOW_ANONYMOUS=true` existe apenas para desenvolvimento e emite aviso.

### Containers

- `npm ci` estrito nos estágios de build e runtime; locks versionados por app.
- Runtime instala apenas dependências de produção com `--ignore-scripts`.
- Processos rodam como usuário `node` (não-root).
- `init: true`, `security_opt: no-new-privileges:true` e `cap_drop: ALL` nos
  serviços de aplicação.
- Healthchecks em API, web e realtime; `depends_on` com `service_healthy`.
- Em produção: `read_only: true`, `tmpfs: /tmp` e nenhuma porta de banco/API/WS
  publicada no host (apenas o web, atrás de reverse proxy).
- Em desenvolvimento: portas publicadas em `127.0.0.1` por padrão (`BIND_ADDR`).

## Configuração

Variáveis relevantes (ver `.env.example`):

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `JWT_SECRET` | — | Obrigatório; mínimo 32 caracteres. |
| `JWT_EXPIRES_IN` | `7d` | Expiração do token de sessão. |
| `CORS_ORIGIN` | `http://localhost:3000` | Origens permitidas, separadas por vírgula. |
| `ALLOW_REGISTRATION` | `true` em dev | Habilita `POST /api/auth/register`. |
| `SEED_DEMO` | `true` em dev | Cria dados/credenciais de demonstração. |
| `DEMO_ADMIN_PASSWORD` | `admin123` | Senha do admin de demonstração. |
| `TRUST_PROXY` | `false` | Confia no primeiro proxy para IP/rate limit. |
| `WS_ALLOW_ANONYMOUS` | `false` | Desliga autenticação do WebSocket. Só dev. |
| `BIND_ADDR` | `127.0.0.1` | Endereço de bind das portas em dev. |
| `API_TOKEN_REALTIME` | vazio | Token de serviço opcional para hidratação. |

Gere segredos com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Verificações executadas

- `npm audit --audit-level=low` na raiz e nos quatro workspaces: 0 vulnerabilidades.
- Build/typecheck de API, realtime, worker e web.
- Varredura por SQL interpolado, `eval`, `innerHTML`/`dangerouslySetInnerHTML`,
  `.env` versionado e literais de segredo no código.
- Testes manuais de API: login, `401` sem token, `403`/`404` para recurso de
  outra organização, rate limit, headers de segurança, token escopado do draw.io.
- Teste manual de WebSocket: conexão sem token rejeitada, conexão com token e
  `join` autorizado, `join` em modelo de outra organização negado.

Ferramentas SAST/DAST (Trivy, Semgrep, Gitleaks, Docker Scout) não estão
instaladas no ambiente; quando disponíveis, devem ser adicionadas ao CI.

## Riscos residuais conhecidos

- **RBAC por papel:** viewer e editor ainda não são diferenciados nas rotas de
  escrita; qualquer membro da organização pode editar. O papel existe no banco e
  é retornado, mas a checagem é apenas de pertencimento.
- **Estado do realtime:** o serviço mantém estado Yjs em memória e snapshots em
  arquivo, em paralelo ao PostgreSQL. Não há reconciliação transacional entre os
  dois; reinícios usam snapshot + hidratação da API.
- **Versões do worker:** o cálculo `COUNT(*) + 1` pode gerar corrida/duplicidade
  em múltiplas instâncias do worker. Use uma única instância ou evolua para
  sequência/transação no banco.
- **Rate limit em memória:** com múltiplas réplicas da API, cada réplica tem seu
  próprio contador. Para escala horizontal, use store compartilhado (Redis).
- **CSP da API:** o Helmet está com CSP desabilitada nas respostas JSON; a CSP
  específica é aplicada na página HTML do draw.io.
- **Segredos em variáveis de ambiente:** continuam visíveis para quem tem acesso
  ao runtime do container. Para produção madura, use Docker secrets/Vault.
- **Dependências:** `npm audit` cobre vulnerabilidades conhecidas publicamente;
  não substitui SAST/DAST nem revisão manual contínua.
