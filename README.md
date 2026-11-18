# C4Arch — Arquitetura C4 colaborativa e viva

Ferramenta aberta (MIT) onde arquitetos de soluções desenham **um modelo único de C4 completo**
(Actor, System, Container, Component), compartilham em **tempo real** entre a equipe e
sincronizam o modelo com **Google Drive e/ou GitLab** como arquivo-fonte.

## Visão rápida

- **Frontend:** React + TypeScript + editor gráfico (React Flow).
- **Backend:** Node.js + TypeScript (ou Python/FastAPI).
- **Realtime:** Yjs (CRDT) + WebSocket.
- **Banco:** PostgreSQL.
- **Armazenamento do modelo:** snapshots JSON locais no MVP; Drive/GitLab na fase 2.
- **Ambiente:** Windows (WSL2 ou native).

## Recursos em destaque

- **Multi-diagrama por modelo:** contexto, container, componente e código no
  mesmo modelo, com abas de navegação no preview e evolução guiada entre níveis
  (contexto → container → componente → código).
- **Pastas e modelos unificados:** tela única **Arquivos** com árvore hierárquica de pastas, modelos vinculados e modelos sem pasta, criação categorizada (Pasta ou Modelo) e importação em lote.
- **Catálogo unificado:** tela única **Catálogo** para aplicações e serviços, com etiqueta de tipo, filtro por tipo e criação categorizada (Aplicação ou Serviço).
- **Continuidade de sessão:** ao pressionar F5, o C4Arch restaura a tela atual
  (arquivos, editor ou preview do modelo e o tipo de diagrama aberto).
- **Draw.io integrado por tipo de diagrama:** o editor, o preview e o
  import/export aceitam `?type=<c4Type>` para abrir o diagrama correto.
- **Importação em lote de modelos:** em **Arquivos → Importar**, carregue um ou
  vários arquivos `.drawio`/`.xml` de arquivo, pasta local, Google Drive (link
  público de arquivo) ou outra URL. O tipo C4 é detectado pelo nome e o
  resultado é reportado por item.
- **DAS automático:** o Documento de Arquitetura de Soluções é gerado a partir
  de todos os tipos de diagrama do modelo (inventário, elementos e conexões) e
  regenerado ao criar/editar o modelo, adicionar um tipo ou importar draw.io.
  No startup da API, a geração também é aplicada aos modelos antigos.
- **Interoperabilidade:** importação de diagramas C4-PlantUML e criação de
  modelos a partir de padrões PlantUML prontos (contexto, containers,
  microserviços, componentes ou modelo em branco), com exportação para
  C4-PlantUML, Mermaid, SVG, PNG, HTML e draw.io, com preview server-side e
  legenda. Modelos criados/importados via PlantUML abrem já com o painel de
  código e pré-visualização PlantUML; na lista de arquivos, o botão
  **Editar código (PlantUML)** abre o mesmo painel para o modelo da linha. A
  ida e volta preserva hierarquia (fronteiras/blocos), `$tags`, tecnologia de
  elementos e relações e os identificadores; comentários e formatação do fonte
  são descartados por serem projeção do canônico.
- **Colaboração em tempo real:** presença por view/sala, cursores e atualização
  do canvas via WebSocket + Yjs.
- **Contrato estável:** OpenAPI 3.1 em `/api/openapi.json`, Swagger UI em
  `/api/docs`, erros padronizados (`error`/`code`) e idempotência opcional via
  header `Idempotency-Key`.
- **Operação:** migrações versionadas (`schema_migrations`), backup/restore
  (`pg_dump` ou dump lógico JSON), SBOM CycloneDX e auditoria por organização.
- **MCP server:** `apps/mcp` expõe o modelo C4 a agentes (listar/consultar/criar
  modelos, DAS, inspections, views, autolayout, exportação, importação e
  comentários) via JSON-RPC sobre stdio.

## Quick start (Windows)

1. Instalar dependências: Node.js LTS, PostgreSQL, Git.
2. Clonar este repositório.
3. Subir o banco: `docker compose up -d db` (ou usar PostgreSQL nativo).
4. Configurar variáveis de ambiente a partir de `.env.example`.
5. Rodar o stack: `docker compose up -d --build`.
6. Acessar: `http://localhost:3000`.

Requisitos de ambiente para rodar local:
- Node.js 20 LTS
- PostgreSQL 16
- Docker (opcional, para containerização)

## Estrutura do repositório

```text
c4arch/
├── apps/
│   ├── api/          # Backend REST + auth + regras de negócio
│   ├── web/          # Frontend React + editor C4
│   ├── realtime/     # Serviço WebSocket (Yjs)
│   ├── worker/       # Serviço de sincronização (Drive/GitLab) + versões
│   └── mcp/          # Servidor MCP (stdio) sobre a API HTTP
├── scripts/          # OpenAPI/cliente, backup/restore e SBOM
├── docker-compose.yaml
├── compose.production.yaml
├── .env.example
├── .gitignore
├── .dockerignore
├── LICENSE
├── package.json
└── docs/
    ├── PRD.md          # PRD canônico e atualizado
    ├── DAS.md          # Documento de Arquitetura de Soluções
    ├── DAS-template.md # Template usado para gerar o DAS
    ├── SECURITY.md     # Segurança e riscos residuais
    ├── UX-DAS-EDITOR.md
    └── ADR/
```

## Documentação

- `docs/PRD.md` — Product Requirements Document (visão, requisitos, fluxos,
  contratos e critérios de aceite).
- `docs/DAS.md` — Documento de Arquitetura de Soluções (visão, containers,
  componentes, modelo de dados, segurança e deploy), com as imagens do desenho
  draw.io.
- `docs/DAS-template.md` — template usado para gerar o DAS dos modelos.
- `docs/SECURITY.md` — modelo de ameaças, configuração de segurança e riscos
  residuais.
- `docs/UX-DAS-EDITOR.md` — decisões de UX do editor de DAS.
- `docs/ADR/` — Architecture Decision Records (decisões de arquitetura).
  Destaques recentes: `ADR-0018` (multi-diagrama no mesmo modelo via
  `models.diagrams` e persistência de tela no F5), `ADR-0019` (importação de
  modelos por arquivo/Drive/URL e DAS automático) e `ADR-0020` (hardening de
  importação, grupos de acesso e exportação do DAS).
  Decisões da Onda 1: `ADR-0021` (modelo canônico e fonte única de verdade),
  `ADR-0022` (views como projeções do modelo), `ADR-0023` (DAS como projeção
  com overrides) e `ADR-0024` (versionamento restaurável e persistência do
  estado colaborativo). Interoperabilidade: `ADR-0025` (PlantUML como formato de
  intercâmbio e pré-visualização renderizada na API).

## Login de desenvolvimento

Com `SEED_DEMO=true` (padrão fora de produção), o seed cria o usuário
`admin@example.com` com a senha definida em `DEMO_ADMIN_PASSWORD` (`admin123`
por padrão) quando o banco está vazio. **Não use essas credenciais em
produção.** Em produção o seed é desabilitado por padrão (`SEED_DEMO=false`) e,
se for habilitado, a API exige `DEMO_ADMIN_PASSWORD` com 12+ caracteres e sem
valores de exemplo.

## Segurança

O stack aplica, por padrão:

- JWT obrigatório com mínimo de 32 caracteres; a API recusa subir em produção
  com segredo fraco, valor de exemplo/placeholder ou seed demo com senha padrão.
- Autorização por organização em modelos, elementos, conexões, pastas,
  aplicações, serviços e draw.io (sem IDOR).
- Grupos de acesso são administrados somente por `owner`; `editor` e `viewer`
  não podem criar grupos nem conceder papéis (evita escalada de privilégio).
- Token escopado de 5 minutos para abrir o draw.io, em vez do JWT de sessão na URL.
- Helmet, CORS com allowlist, rate limit global e rate limit no login/registro.
- WebSocket autenticado pelo token de sessão e autorizado por modelo.
- Login com Google via OAuth 2.0/OIDC, com filtro por domínio de e-mail e
  vínculo automático a uma organização com perfil configurável (padrão
  `viewer`). A gestão de domínios é exclusiva de `owner`.
- (Opcional) SSO corporativo via SAML v2 pode ser adicionado com o mesmo fluxo
  de domínio/papel; o suporte a SAML não está habilitado nesta versão.
- Importação por URL com validação de protocolo/host, resolução DNS, bloqueio de
  faixas privadas, redirecionamentos revalidados e limite de bytes (anti-SSRF).
- Conteúdo do DAS escapado antes de ser injetado na janela de impressão (anti-XSS).
- Containers non-root, `no-new-privileges`, `cap_drop: ALL`, healthchecks e
  portas publicadas apenas em `127.0.0.1` por padrão.

Detalhes, configuração e riscos residuais: `docs/SECURITY.md`.

## Validação e build

```bash
# Instalar dependências na raiz (workspaces)
npm install

# Typecheck/build por app
npm run build --workspace=apps/api
npm run build --workspace=apps/realtime
npm run build --workspace=apps/worker
npm run build --workspace=apps/web
npm run build --workspace=apps/mcp

# Testes automatizados (Node test runner + tsx)
npm test --workspace=apps/api
npm test --workspace=apps/realtime
npm test --workspace=apps/web
# ou tudo de uma vez
npm test

# E2E da web (Playwright + Chromium; API mockada)
npm run test:e2e --workspace=apps/web

# Contrato e cliente tipado
npm run openapi:client        # gera apps/web/src/services/generated-api.ts

# Operação
npm run db:migrate            # aplica migrações versionadas
npm run backup                # dump + storage em backups/
npm run restore -- <arquivo>  # restaura dump custom ou JSON gz
npm run sbom                  # gera sbom.json (CycloneDX)
```

O build do frontend executa `tsc --noEmit` no código React antes do Vite;
erros de tipo quebram o build. Os testes da API cobrem validação anti-SSRF,
parsing do draw.io para o DAS, exportadores, importação PlantUML, autolayout,
PNG, OpenAPI e escopo dos tokens; os do realtime cobrem merge parcial, exclusão
em cascata, hidratação do CRDT e pilha de undo/redo. Na web, os testes de
componente (React Testing Library + jsdom) cobrem header/login, painéis de
versões/inspeções, importação, editor do DAS e presença; o E2E do Playwright
cobre login, sessão e deep link com a API mockada.

## Docker

Stack completo via Compose:

- `docker compose up -d --build` — desenvolvimento (db, api, web, realtime, worker, plantuml)
- `docker compose -f docker-compose.yaml -f compose.production.yaml up -d` — produção

Pontos de atenção:

- `PUBLIC_API_URL` e `PUBLIC_WS_URL` definem as URLs usadas pelo **navegador**
  no build do frontend. Em produção, use `https://` e `wss://` com reverse proxy.
- Em produção a API e o realtime não publicam portas no host. Coloque um reverse
  proxy na rede `c4arch-network` encaminhando `/api` para `api:4000` e `/ws`
  para `realtime:4001`.
- `BIND_ADDR` controla o endereço de bind das portas em desenvolvimento
  (`127.0.0.1` por padrão; use `0.0.0.0` só quando a exposição for intencional).
- `DATABASE_URL` usa `${POSTGRES_PASSWORD}` (não placeholder).
- `PLANTUML_RENDER_URL_TEMPLATE` aponta a pré-visualização para o serviço
  `plantuml` do compose (`http://plantuml:8080/svg/{encoded}` por padrão). Fora
  do Docker, use o servidor público (`https://www.plantuml.com/plantuml/svg/{encoded}`)
  ou outra instância acessível; o marcador `{encoded}` é obrigatório.
- `worker` conecta em `db` via `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`.
- `web` serve `dist` com o binário local `serve` (sem `npx` em runtime).
- `worker` executa `node dist/index.js`.
- As imagens usam `npm ci` estrito, dependências de produção com
  `--ignore-scripts`, usuário `node`, `init: true` e filesystem somente-leitura
  em produção.

## Testes de segurança executados

```bash
npm audit --audit-level=low
npm audit --audit-level=low --workspace=@c4arch/api
npm audit --audit-level=low --workspace=@c4arch/web
npm audit --audit-level=low --workspace=@c4arch/realtime
npm audit --audit-level=low --workspace=@c4arch/worker
npm test
```

Em 14/11/2026: build/typecheck dos apps e 146 testes automatizados aprovados
(113 API + 9 realtime + 24 web). A última execução de `npm audit` registrada
(08/11/2026) não apontava vulnerabilidades; rode os comandos acima antes de
publicar.

Não há ferramentas SAST/DAST obrigatórias no repositório; consulte
`docs/SECURITY.md` para o checklist manual e para os riscos residuais.

## Licença

MIT. Veja o arquivo `LICENSE`.
