# C4Arch — Arquitetura C4 colaborativa e viva

Ferramenta aberta (MIT) onde arquitetos de soluções desenham **um modelo único de C4 completo**
(Actor, System, Container, Component), compartilham em **tempo real** entre a equipe e
sincronizam o modelo com **Google Drive e/ou GitLab** como arquivo-fonte.

## Visão rápida

- **Frontend:** React + TypeScript + editor gráfico (React Flow).
- **Backend:** Node.js + TypeScript (ou Python/FastAPI).
- **Realtime:** Yjs (CRDT) + WebSocket.
- **Banco:** PostgreSQL.
- **Armazenamento do modelo:** adapter para Google Drive e/ou GitLab.
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
├── packages/
│   ├── model/        # Tipos e validação do modelo C4
│   ├── realtime/     # Schema Yjs + lógica de merge
│   ├── storage/      # Adapter Google Drive e GitLab
│   └── shared/       # Utilitários e constantes
├── infra/            # docker-compose, scripts de dev, seed
├── docs/
│   ├── PDR.md        # Product Design Review
│   └── ADR/          # Architecture Decision Records
├── docker-compose.yaml
├── compose.production.yaml
├── Dockerfile        # (padrão raiz, usado por alguns serviços)
├── .dockerignore
├── .gitignore
├── .env.example
└── package.json      # npm workspaces (opcional)
```

## Documentação

- `docs/PDR.md` — Product Design Review (visão, requisitos, arquitetura, stack).
- `docs/ADR/` — Arquitetura Decision Records (decisões registradas de arquitetura).

## Licença

MIT. Veja o arquivo `LICENSE`.
