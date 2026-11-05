# C4Arch — Product Design Review (PDR)

> **Documento legado.** O PRD canônico e atualizado está em
> [`docs/PRD.md`](./PRD.md). Este arquivo é mantido como registro histórico
> da visão original do produto.

Documenta a visão, requisitos, arquitetura, pilha de tecnologias e decisões
abertas do produto C4Arch.

## 1) Visão do produto

C4Arch é uma ferramenta aberta (MIT) onde arquitetos de soluções desenham
**um modelo único de C4 completo** (Actor, System, Container, Component),
compartilham em **tempo real** entre a equipe e sincronizam o modelo com
**Google Drive e/ou GitLab** como arquivo-fonte.

## 2) Problema

A modelagem de arquitetura hoje tende a ficar em planilhas, documentos
escassos ou diagramas desatualizados. Quando o código muda, a arquitetura
entra em desacordo silencioso. Equipes pequenas (4 arquitetos) precisam de
um espaço vivo, compartilhado e versionado, que entenda C4 completo,
permita edição simultânea e exporte para sistemas externos (Drive/GitLab).

## 3) Público e usuários

- **Público alvo:** times de arquitetura de soluções (4 integrantes no MVP)
- **Personas:**
  - Arquiteto Sênior (owner) — aprova, delega, exporta
  - Arquiteto de Soluções (editor) — constrói Contêineres e conexões
  - Arquiteto de Engenharia (editor) — detalha Componentes, conecta código
  - Arquiteto de Negócio (viewer) — lê, comenta, sugere
- **Caso de uso principal:** colaborar em tempo real em um mapa C4 completo
  e exportar para o Drive/GitLab como fonte única do modelo.

## 4) Requisitos

### Funcionais
- Registro/login e organizações (workspace)
- Modelo C4 completo: Actor, System, Container, Component + conexões
- Editor visual com arrastar, conectar, metadados e posicionamento
- Edição simultânea (4 integrantes) via Yjs (CRDT)
- Comentários anexados a elementos e a subárvores
- Histórico de versões e restauração
- Exportação JSON/YAML (model-as-code)
- Sincronização com Google Drive e GitLab (adapter)
- Permissões: owner/editor/viewer

### Não funcionais
- Disponibilidade: alta em producao (restart policy, healthchecks)
- Seguranca: nao expor secrets, rodar containers nao-root
- Multiplicidade: escalavel de 4 para n integrantes
- Portabilidade: rodar local (Docker) ou em servidores próprios
- Performance: modelo C4 com os 4 niveis + conexoes renderizados fluidos

## 5) Arquitetura (resumo)

```text
                   +----------------------+
                   |       Web (React)   |
                   +----------+-----------+
                              |
                              | WebSocket (Yjs)
                   +----------v-----------+
                   |        API           |
                   |  realtime (ws/worker)|
                   |  storage (Drive/Git) |
                   +----------+-----------+
                              |
              PostgreSQL (relacional + JSONB)
              Google Drive / GitLab (storage)
```

- **Frontend:** React + TypeScript + editor gráfico (React Flow)
- **Realtime:** Yjs + WebSocket (c4arch-network interna)
- **Backend:** Node.js + TypeScript (ou Python/FastAPI)
- **Banco:** PostgreSQL (relacional + JSONB)
- **Storage:** Adapter Google Drive e GitLab
- **Deploy:** Docker + docker-compose (dev e producao)

## 6) Stack de tecnologias

- **Frontend:** React, TypeScript, Vite, React Flow
- **Backend:** Node.js + TypeScript (recomendado para alinhamento com Yjs e googleapis)
- **Banco:** PostgreSQL (via row / prisma ou pg)
- **Realtime:** Yjs, WebSocket (ws / Socket.io)
- **Storage:** googleapis (Drive), GitLab API (gitlab package)
- **Container:** Docker, Docker Compose
- **Documentacao:** PDR (este), ADR (architecture decision records)

## 7) Caminho de entrega (roadmap)

- **Meta 0:** estrutura + CRUD do modelo C4 + CRUD no banco + export JSON/YAML
- **Meta 1:** sincronizacao em tempo real (Yjs) com 4 editores + comentarios
- **Meta 2:** exportacao e sincronizacao (Drive/GitLab) + versoes
- **Meta 3:** permissoes granulares, templates, exportacao de imagem

### Correções de bugs (11/2026)
- **Edicao/nome do modelo:** `PUT /api/models/:id` atualiza `title` e `status`.
- **Vinculacao a pasta:** `folderId` no `POST /api/models` é validado e gravado
  no `folder_id`.
- **Exclusao:** `DELETE /api/models/:id` retorna carga uida previsivel
  (`{ok:true}` ou 404).
- **WebSocket cliente:** singleton com reconnect automatico; "Desconectar"
  interrompe o reconnect.
- **Estado do modelo:** preenchido a partir do WebAPI no realtime quando vazio.

## 8) Decisões marcantes

Veja a pasta `docs/ADR/` para os registros de decisao de arquitetura (ADR),
como:
- ADR-0001: Sincronizacao em tempo real com Yjs
- ADR-0002: Storage adapter para Google Drive e GitLab
- ADR-0003: Docker + Compose para desenvolvimento e producao
- ADR-0004: Licenca MIT
- ADR-0005: Nome do projeto C4Arch
- ADR-0006: React Flow 12
- ADR-0007: API autossuficiente (`apps/api`)
- ADR-0008: WebSocket cliente: singleton, reconnect automático e estado inicial
- ADR-0009: API do modelo: update de título/status e associação a pasta
- ADR-0010: Realtime: merge parcial, IDs estáveis e snapshot atômico
- ADR-0011: Contrato de tipos do frontend e typecheck no build
- ADR-0012: CRUD de modelo e acesso ao draw.io
- ADR-0013: Remoção de código morto e dependências não utilizadas

## 9) Perguntas abertas / riscos

- Conflito de dois editores deletando o mesmo elemento: regra inicial "previous wins"
  + overlay visual de conflito.
- Google Drive tem cotas de requisição; modelos pequenos/medios sao suficientes.
- Sincronizacao offline parcial: o app pode manter estado local (Yjs) e reconciliar.
