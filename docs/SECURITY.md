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

- `JWT_SECRET` é obrigatório. Em produção a API não inicia com segredo ausente,
  com menos de 32 caracteres ou com valores de exemplo/placeholder
  (`change-me`, `your-secret`, `dev-secret` etc.); em desenvolvimento um segredo
  fraco gera aviso.
- Tokens de sessão são assinados com HS256, `issuer: c4arch` e expiração
  configurável (`JWT_EXPIRES_IN`, padrão `7d`).
- O middleware exige exatamente `Authorization: Bearer <token>`; não aceita
  token de sessão na query string.
- Senhas usam `scrypt` assíncrono (`crypto.scrypt`) com salt aleatório por usuário
  e comparação `crypto.timingSafeEqual`. A versão assíncrona evita bloquear o
  event loop durante o KDF.
- Login com e-mail inexistente executa o mesmo custo de KDF e retorna a mesma
  mensagem genérica, reduzindo enumeração de usuários.
- Registro trata corrida de e-mail único (`23505`) como `409 Email já cadastrado`,
  em vez de vazar erro interno.
- Política mínima: senha com 8–1024 caracteres; e-mail normalizado; nome limitado.
- Registro público pode ser desligado com `ALLOW_REGISTRATION=false`.
- Login com Google (OAuth 2.0/OIDC) cria ou reutiliza o usuário com senha
  aleatória (não usada no SSO) e exige um domínio habilitado em
  `login_domain_rules`; o perfil aplicado vem da regra (padrão `viewer`).
- A gestão de domínios autorizados é exclusiva de `owner` da organização
  (`/api/auth/domains`); cada regra vincula um domínio a uma organização e a um
  papel (`viewer`, `editor` ou `owner`).
- SSO corporativo via SAML v2 não está implementado nesta versão; o fluxo
  atual cobre Google OAuth com os mesmos controles de domínio/papel.
- Seed de demonstração em produção exige `DEMO_ADMIN_PASSWORD` com 12+
  caracteres e sem placeholders; `SEED_DEMO=true` com senha padrão impede o boot.
- A conexão com o banco também recusa `DB_PASSWORD` de exemplo em produção.

### Autorização

- Toda rota de modelo, elemento, conexão, pasta, aplicação e serviço verifica se
  o usuário é membro da organização do recurso.
- O papel vem sempre de `memberships`: `owner` e `editor` podem escrever;
  `viewer` é somente leitura. A checagem é feita nas rotas de escrita e também
  no token/importação do draw.io.
- Recursos de outra organização retornam `404` (não revelam existência).
- IDs de rota/query/body são validados como UUID antes de chegar ao Postgres;
  identificadores inválidos retornam `400`/`404` em vez de virar erro de cast
  (`500`).
- Criação de modelo/pasta/aplicação/serviço valida se o `orgId` pertence ao usuário.
- Criação/edição de conexões valida se os elementos referenciados pertencem ao modelo.
- Criação de organização associa o criador como `owner` em transação.
- Gestão de membros exige papel `owner` na organização: listar é permitido a
  qualquer membro, mas adicionar, alterar perfil e remover são exclusivos do
  `owner`.
- Gestão de grupos de acesso (`/api/groups`) exige membership na organização para
  leitura e papel `owner` para criação, edição, exclusão e gestão de membros.
  A adição de um membro a um grupo aplica o perfil base do grupo à membership
  quando mais permissivo.
- A organização nunca fica sem owner: rebaixar ou remover o último `owner`
  retorna `409`. O owner também não pode remover a si mesmo.
- `GET /api/auth/me` devolve o papel lido de `memberships` apenas para a UI. O
  JWT não é usado para autorização; cada rota revalida o papel no banco.
- Convite por e-mail: se a conta não existir, é criada com senha temporária
  aleatória devolvida uma única vez ao owner; se já existir, apenas a membership
  é adicionada com o perfil escolhido.

### draw.io

- O navegador não recebe mais o JWT de sessão na URL.
- `POST /api/models/:id/drawio/token` emite um token com `purpose: "drawio"`,
  `modelId`, audiência `c4arch-drawio` e validade de 5 minutos.
- O editor só aceita esse token para o modelo correspondente, ou um Bearer de
  sessão válido para uso via API. Tokens escopados não são aceitos como sessão
  nas demais rotas.
- A página do editor abre o embed oficial (`https://embed.diagrams.net`) com
  `embed=1&proto=json`, carrega o XML salvo e persiste `save`/`autosave` via
  `POST /api/models/:id/drawio/import`.
- A página gera um token próprio, também escopado no modelo, para o autosave
  continuar funcionando após os 5 minutos do token da URL.
- A biblioteca de shapes é montada a partir do catálogo de aplicações e serviços
  e entregue como data URL (`clibs`), evitando CORS e conteúdo misto entre o
  draw.io HTTPS e uma API local em HTTP.
- O endpoint auxiliar `GET /api/models/:id/drawio/library` mantém
  `Access-Control-Allow-Origin: *` (somente leitura e token escopado), mas não
  habilita `Access-Control-Allow-Private-Network`, evitando que uma página pública
  alcance a rede privada do usuário.
- Cada objeto da biblioteca carrega marcadores (`c4archAssetId`,
  `c4archAssetKind`) que vinculam a shape ao catálogo. A edição de um app/serviço
  propaga nome, descrição e metadados para `elements` e para o `drawio_xml` de
  todos os modelos da organização que reutilizam o objeto.
- `GET /api/apps/:id/dependencies` e `GET /api/services/:id/dependencies` são
  somente leitura e exigem membership na organização (o vínculo pode vir de
  `elements` ou dos marcadores no XML).
- A página do editor define CSP restritiva, `Referrer-Policy: no-referrer` e
  `Cache-Control: no-store`.
- XML de importação é limitado a 100 kB e validado minimamente.

### Importação de modelos

- `POST /api/models/import` exige `orgId`, papel `owner`/`editor` e valida a
  pasta de destino contra a organização (sem IDOR).
- A fonte é exatamente uma: XML enviado pelo navegador ou URL baixada pelo
  servidor. O corpo total continua limitado a 100 kB e o XML remoto a 100 kB.
- A URL precisa ser `http(s)`, sem credenciais embutidas, com host público e não
  pode apontar para loopback/LAN/metadata. A validação cobre IPv4 e IPv6
  (`localhost`, `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`,
  `100.64/10`, `0/8`, multicast/reservados, `::1`, `fc00::/7`, `fe80::/10`,
  `ff00::/8`, IPv4 mapeado e NAT64, além de `.local`, `.localdomain`, `.internal`).
- O host é resolvido via DNS e **todos** os endereços retornados são validados
  antes do download (não apenas o texto da URL).
- Redirecionamentos são seguidos manualmente (máx. 3), revalidando protocolo,
  host e DNS em cada salto; `redirect: "follow"` não é usado.
- O corpo é lido em streaming com limite rígido de bytes, mesmo quando o servidor
  não informa `Content-Length` (evita consumo de memória/DoS).
- Download com timeout de 15 s, `Accept` de XML, `User-Agent` próprio e
  validação de que o conteúdo começa com `<` (XML draw.io).
- Links de pasta do Google Drive são rejeitados explicitamente; apenas links
  públicos de arquivo (`/file/d/<id>` ou `?id=<id>`) são normalizados para
  download direto. O arquivo precisa estar compartilhado como "Qualquer pessoa
  com o link".
- Cada item é importado em uma chamada independente; falhas retornam mensagem
  clara por item sem interromper o lote (erros de URL insegura retornam `400`, não
  `500`).

### API HTTP

- `helmet` com `x-powered-by` desabilitado.
- CORS com allowlist explícita em `CORS_ORIGIN` (separada por vírgula), sem
  wildcard. Exceção: `GET /api/models/:id/drawio/library` responde
  `Access-Control-Allow-Origin: *` porque é somente leitura e exige token
  escopado; as origens oficiais do draw.io também são aceitas.
- Corpo JSON limitado a 100 kB. Corpos que não sejam objetos JSON (`null`,
  arrays, escalares) são rejeitados com `400` antes dos controllers.
- Rate limit global em `/api` (1200 req/15 min por IP, dimensionado para o
  autosave do draw.io) e mais restrito em `/api/auth/login` e
  `/api/auth/register` (10 req/15 min por IP).
- `/healthz` verifica a conexão com o PostgreSQL.
- Handler final de erros não vaza stack trace; 404 padronizado.
- `TRUST_PROXY=true` só deve ser usado atrás de proxy confiável.
- A exportação do DAS para PDF escapa título, URL de preview e Markdown antes de
  escrever na janela de impressão (incluindo `"` e `'`), impedindo XSS armazenado
  via título do modelo ou conteúdo do diagrama.

### WebSocket (realtime)

- A conexão exige `?token=<JWT de sessão>`; o token é validado em
  `GET /api/auth/me`.
- Cada `join` é autorizado em `GET /api/models/:id`, garantindo que o usuário
  pertence à organização do modelo. A resposta também informa `member_role`.
- `patch` no CRDT só é aplicado para `owner`/`editor`. O papel é revalidado a
  cada 30 s, então um rebaixamento para `viewer` bloqueia escritas sem exigir
  reconexão. `viewer` recebe `error: "sem permissão de escrita"`.
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
| `JWT_SECRET` | — | Obrigatório; mínimo 32 caracteres e sem placeholder em produção. |
| `JWT_EXPIRES_IN` | `7d` | Expiração do token de sessão. |
| `CORS_ORIGIN` | `http://localhost:3000` | Origens permitidas, separadas por vírgula. |
| `ALLOW_REGISTRATION` | `true` em dev | Habilita `POST /api/auth/register`. |
| `SEED_DEMO` | `true` em dev | Cria dados/credenciais de demonstração. |
| `DEMO_ADMIN_PASSWORD` | `admin123` em dev | Em produção com seed ativo, exige 12+ caracteres sem placeholder. |
| `DB_PASSWORD` | — | Obrigatório em produção; valores de exemplo são recusados. |
| `TRUST_PROXY` | `false` | Confia no primeiro proxy para IP/rate limit. |
| `WS_ALLOW_ANONYMOUS` | `false` | Desliga autenticação do WebSocket. Só dev. |
| `BIND_ADDR` | `127.0.0.1` | Endereço de bind das portas em dev. |
| `GOOGLE_CLIENT_ID` | vazio | Habilita login com Google. |
| `GOOGLE_CLIENT_SECRET` | vazio | Segredo OAuth do Google. |
| `GOOGLE_CALLBACK_URL` | `http://localhost:4000/api/auth/google/callback` | Callback OAuth. |
| `FRONTEND_URL` | `http://localhost:3000` | Redirecionamento após SSO. |

Gere segredos com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Verificações executadas

- `npm audit --audit-level=low` na raiz e nos quatro workspaces: 0 vulnerabilidades.
- Build/typecheck de API, realtime, worker e web.
- Testes automatizados (`node --test` + `tsx`):
  - API: 20 testes — faixas privadas IPv4/IPv6, IPv4 mapeado, rejeição de
    protocolos/hosts internos, normalização do Google Drive, leitura limitada do
    corpo, parsing do draw.io (objetos/arestas/entidades), escopo dos tokens e
    regras de papel (`owner` vs `editor`/`viewer`).
  - Realtime: 6 testes — merge parcial de elemento, update em inexistente, exclusão
    em cascata de arestas, update/delete de aresta e hidratação única do CRDT.
- Varredura por SQL interpolado, `eval`, `innerHTML`/`dangerouslySetInnerHTML`,
  `.env` versionado e literais de segredo no código.
- Testes manuais de API: login, `401` sem token, `403`/`404` para recurso de
  outra organização, rate limit, headers de segurança, token escopado do draw.io.
- Draw.io validado ponta a ponta: emissão do token escopado, página do editor com
  CSP/`no-store`/`no-referrer`, URL do embed, biblioteca `<mxlibrary>` com apps e
  serviços, importação/exportação de XML e rejeição do token escopado como token
  de sessão.
- RBAC validado com usuário `viewer`: leitura permitida; criação de app, token
  draw.io e importação do diagrama negados com `403`.
- Gestão de membros validada ponta a ponta: `owner` lista/adiciona/altera/remove;
  `editor` e `viewer` recebem `403` em mutações; rebaixamento de `editor` para
  `viewer` passa a valer mesmo com o JWT antigo; último owner recebe `409`.
- Teste manual de WebSocket: conexão sem token rejeitada, conexão com token e
  `join` autorizado, `join` em modelo de outra organização negado e `patch` de
  `viewer` bloqueado com `error: "sem permissão de escrita"`.
- Importação de modelos validada: XML local com inferência de tipo, URL pública
  (httpbin) e rejeição de pasta do Google Drive e de `127.0.0.1` com `400`.
- DAS automático validado: geração no modelo importado, inventário e seções
  5.2–5.5 após adicionar container/componente/código, e backfill no startup.
- Fluxo de UI validado com navegador: abertura do modal, importação de dois
  arquivos, tipos inferidos e modelos visíveis após refresh.

Ferramentas SAST/DAST (Trivy, Semgrep, Gitleaks, Docker Scout) não estão
instaladas no ambiente; quando disponíveis, devem ser adicionadas ao CI.

## Riscos residuais conhecidos

- **Estado do realtime:** o serviço mantém estado Yjs em memória e snapshots em
  arquivo, em paralelo ao PostgreSQL. Não há reconciliação transacional entre os
  dois; reinícios usam snapshot + hidratação da API. Para produção com múltiplas
  réplicas, evolua para persistência/replicação do CRDT.
- **Rate limit em memória:** com múltiplas réplicas da API, cada réplica tem seu
  próprio contador. Para escala horizontal, use store compartilhado (Redis).
- **CSP da API:** o Helmet está com CSP desabilitada nas respostas JSON; a CSP
  específica é aplicada na página HTML do draw.io.
- **Segredos em variáveis de ambiente:** continuam visíveis para quem tem acesso
  ao runtime do container. Para produção madura, use Docker secrets/Vault.
- **Senha temporária de convite:** contas criadas pela gestão de usuários
  recebem uma senha aleatória exibida uma única vez ao owner. Ainda não existe
  fluxo de troca obrigatória no primeiro acesso; compartilhe por canal seguro e
  evolua para convite por e-mail com token de uso único.
- **Dependências:** `npm audit` cobre vulnerabilidades conhecidas publicamente;
  não substitui SAST/DAST nem revisão manual contínua.
- **DNS rebinding na importação:** mitigado. A URL é validada sintaticamente e o
  DNS é resolvido antes do download, e o socket é aberto para o IP previamente
  validado via `lookup` customizado, evitando nova resolução no momento da
  conexão. Redirecionamentos continuam revalidados em cada salto; a importação
  permanece restrita a `owner`/`editor`.
- **CORS da biblioteca draw.io:** o endpoint deixa de emitir wildcard ou
  `Access-Control-Allow-Private-Network`; passa a usar a allowlist global de
  origens do draw.io, com token escopado de curta duração e natureza somente
  leitura.
