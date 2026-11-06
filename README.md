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
│   └── worker/       # Serviço de sincronização (Drive/GitLab) + versões
├── docker-compose.yaml
├── compose.production.yaml
├── .env.example
├── .gitignore
├── .dockerignore
├── LICENSE
├── package.json
└── docs/
    ├── PRD.md          # PRD canônico e atualizado
    ├── PDR.md          # visão original (legado)
    └── ADR/
```

## Documentação

- `docs/PRD.md` — Product Requirements Document (visão, requisitos, fluxos,
  contratos e critérios de aceite).
- `docs/PDR.md` — Product Design Review original, mantido como registro histórico.
- `docs/DAS.md` — Documento de Arquitetura de Soluções (visão, containers,
  componentes, modelo de dados, segurança e deploy), com as imagens do desenho
  draw.io.
- `docs/ADR/` — Architecture Decision Records (decisões de arquitetura).

## Login de desenvolvimento

Com `SEED_DEMO=true` (padrão fora de produção), o seed cria o usuário
`admin@example.com` com a senha definida em `DEMO_ADMIN_PASSWORD` (`admin123`
por padrão) quando o banco está vazio. **Não use essas credenciais em
produção.** Em produção o seed é desabilitado por padrão (`SEED_DEMO=false`).

## Segurança

O stack aplica, por padrão:

- JWT obrigatório com mínimo de 32 caracteres; a API recusa subir em produção
  com segredo fraco ou ausente.
- Autorização por organização em modelos, elementos, conexões, pastas,
  aplicações, serviços e draw.io (sem IDOR).
- Token escopado de 5 minutos para abrir o draw.io, em vez do JWT de sessão na URL.
- Helmet, CORS com allowlist, rate limit global e rate limit no login/registro.
- WebSocket autenticado pelo token de sessão e autorizado por modelo.
- Senhas com scrypt e comparação em tempo constante; mensagens de login genéricas.
- Containers non-root, `no-new-privileges`, `cap_drop: ALL`, healthchecks e
  portas publicadas apenas em `127.0.0.1` por padrão.

Detalhes, configuração e riscos residuais: `docs/SECURITY.md`.

## Validação e build

```bash
# API, realtime e worker
cd apps/api && npx tsc --noEmit && npm run build
cd apps/realtime && npx tsc --noEmit && npm run build
cd apps/worker && npx tsc --noEmit

# Frontend (typecheck real + build)
cd apps/web && npm run typecheck && npm run build
```

O build do frontend executa `tsc --noEmit` no código React antes do Vite;
erros de tipo quebram o build.

## Docker

Stack completo via Compose:

- `docker compose up -d --build` — desenvolvimento (db, api, web, realtime, worker)
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
```

Não há ferramentas SAST/DAST obrigatórias no repositório; consulte
`docs/SECURITY.md` para o checklist manual e para os riscos residuais.

## Licença

MIT. Veja o arquivo `LICENSE`.
