# Documento de Arquitetura de Soluções (DAS) — Template

> **Versão:** 1.0.0
> **Status:** Template
> **Licença:** MIT
> **Baseado em:** arc42, TOGAF ADM, C4 Model, Well-Architected Framework

---

## 1. Informações do documento

| Campo | Valor |
|---|---|
| Projeto | _nome do projeto_ |
| Versão | _x.y.z_ |
| Data | _dd/mm/aaaa_ |
| Autor(es) | _nomes_ |
| Revisores | _nomes_ |
| Aprovador | _nome_ |
| Status | Rascunho / Em revisão / Aprovado |
| Referências | PRD, ADRs, C4 Model |

---

## 2. Visão geral

### 2.1 Propósito

Descrever a arquitetura da solução, seus componentes, decisões técnicas e
restrições, servindo como fonte única para stakeholders técnicos e não técnicos.

### 2.2 Escopo

- **Incluído:** _o que a solução cobre._
- **Excluído:** _o que está fora do escopo._
- **Fronteiras:** _sistemas externos e integrações._

### 2.3 Glossário

| Termo | Definição |
|---|---|
| _termo_ | _definição_ |

---

## 3. Requisitos e restrições

### 3.1 Requisitos funcionais (resumo)

Referência: `docs/PRD.md` (RF-xx).

### 3.2 Requisitos não funcionais

| Categoria | Requisito | Métrica/Alvo |
|---|---|---|
| Desempenho | _latência, throughput_ | _ex.: p95 < 200ms_ |
| Disponibilidade | _uptime_ | _ex.: 99.9%_ |
| Escalabilidade | _carga esperada_ | _ex.: 1000 usuários simultâneos_ |
| Segurança | _autenticação, autorização, criptografia_ | _ex.: JWT + RBAC_ |
| Portabilidade | _ambientes suportados_ | _ex.: Docker, Node 20_ |
| Observabilidade | _logs, métricas, tracing_ | _ex.: healthcheck /healthz_ |
| Manutenibilidade | _testes, cobertura_ | _ex.: ≥ 80%_ |

### 3.3 Restrições

- Técnicas: _linguagens, frameworks, plataformas obrigatórias._
- Organizacionais: _prazos, equipe, orçamento._
- Regulatórias: _LGPD, compliance, retenção de dados._

### 3.4 Premissas

- _premissa 1_
- _premissa 2_

---

## 4. Stakeholders e personas

| Stakeholder | Papel | Interesse principal |
|---|---|---|
| _Arquiteto Sênior_ | owner | Aprovar e exportar modelos |
| _Arquiteto de Soluções_ | editor | Construir sistemas e conexões |
| _Arquiteto de Engenharia_ | editor | Detalhar componentes |
| _Arquiteto de Negócio_ | viewer | Ler e validar |

---

## 5. Visão de contexto (C4 — Nível 1)

### 5.1 Diagrama de contexto

```text
[Personas] --> [Sistema em foco] --> [Sistemas externos]
```

### 5.2 Descrição dos elementos

| Elemento | Tipo | Descrição |
|---|---|---|
| _Sistema em foco_ | Software System | _descrição_ |
| _Sistema externo_ | Software System | _descrição_ |
| _Usuário_ | Person | _descrição_ |

### 5.3 Interfaces externas

| Sistema externo | Protocolo | Contrato | SLA |
|---|---|---|---|
| _ex.: PostgreSQL_ | TCP/5432 | SQL | 99.9% |

---

## 6. Visão de containers (C4 — Nível 2)

### 6.1 Diagrama de containers

```text
Navegador (Web)
   | REST /api   WebSocket /ws
   v
API (Express + JWT)   Realtime (ws + Yjs)
   |                      |
   +------ PostgreSQL ----+--- Storage (snapshots JSON)
```

### 6.2 Containers

| Container | Tecnologia | Responsabilidade | Porta/Endpoint |
|---|---|---|---|
| Web | React + Vite + React Flow | UI e editor visual | 3000 |
| API | Node.js + Express + TypeScript | Regras de negócio, REST | 4000 |
| Realtime | Node.js + ws + Yjs | Edição colaborativa (CRDT) | 4001 |
| Worker | Node.js | Versões/sincronização | — |
| DB | PostgreSQL 16 | Fonte de verdade | 5432 |

### 6.3 Comunicação entre containers

| Origem | Destino | Protocolo | Formato | Autenticação |
|---|---|---|---|---|
| Web | API | HTTPS/REST | JSON (camelCase) | JWT Bearer |
| Web | Realtime | WSS | Yjs patch | JWT (query) |
| API | DB | TCP | SQL | credenciais env |
| Realtime | API | HTTP | JSON | token de serviço |

---

## 7. Visão de componentes (C4 — Nível 3)

### 7.1 Componentes por container

#### API
- `AuthController`, `ModelController`, `ElementController`, `EdgeController`
- `FolderController`, `AppController`, `ServiceController`
- `DrawioController`, `GroupController`
- Middlewares: `verifyToken`, `verifyDrawioAccess`
- Acesso: `auth/access.ts` (RBAC)

#### Web
- `App.tsx` (orquestração), `Canvas.tsx` (React Flow)
- `UserManagement`, `GroupManagement`
- `services/api.ts`, `services/ws.ts`, `services/types.ts`

#### Realtime
- `sync.ts` (Yjs, merge parcial, snapshots atômicos)

### 7.2 Diagrama de componentes (opcional)

```text
[Componente A] --> [Componente B]
```

---

## 8. Visão de código (C4 — Nível 4) — opcional

- Pacotes/módulos principais e dependências.
- Padrões aplicados (Clean Architecture, DDD tático, etc.).

---

## 9. Modelo de dados

### 9.1 Entidades principais

| Entidade | Descrição | Chave |
|---|---|---|
| users | Usuários | id (UUID) |
| organizations | Organizações/workspaces | id (UUID) |
| memberships | Vínculo usuário-org com papel | (org_id, user_id) |
| models | Modelos C4 | id (UUID) |
| elements | Elementos C4 (actor/system/container/component) | id (UUID) |
| edges | Conexões entre elementos | id (UUID) |
| folders | Pastas (hierárquicas) | id (UUID) |
| apps / services | Objetos reutilizáveis C4 | id (UUID) |
| access_groups | Grupos de acesso | id (UUID) |
| access_group_members | Membros dos grupos | (group_id, user_id) |

### 9.2 Relacionamentos

- `organizations 1..n memberships n..1 users`
- `organizations 1..n models`, `models n..1 folders`
- `models 1..n elements`, `models 1..n edges`
- `elements n..1 apps/services` (opcional)
- `folders 1..n folders` (self-reference via parent_id)

### 9.3 Persistência

- **PostgreSQL:** fonte de verdade (modelos, elementos, conexões, usuários, orgs, permissões).
- **Realtime/Yjs:** estado ativo de edição em memória por modelo.
- **Snapshots JSON:** cache/recuperação do realtime (volume `storage`).

---

## 10. Segurança

### 10.1 Autenticação

- JWT HS256, `issuer: c4arch`, expiração configurável.
- Senhas com `scrypt` + salt, comparação `timingSafeEqual`.
- Token de sessão apenas em header `Authorization: Bearer`.

### 10.2 Autorização (RBAC)

- Papéis: `owner`, `editor`, `viewer`.
- Papel vem sempre de `memberships`, nunca do JWT.
- Recursos de outra organização retornam `404`.
- Grupos de acesso (`access_groups`) aplicam perfil base.

### 10.3 Controles adicionais

- Helmet, CORS com allowlist, rate limit.
- Tokens escopados para draw.io (5 min).
- Containers não-root, `cap_drop: ALL`, filesystem read-only em produção.
- Validação de UUID para `modelId` (path traversal).

### 10.4 Riscos residuais

- Estado realtime em memória (sem reconciliação transacional).
- Rate limit em memória (não compartilhado entre réplicas).
- Segredos em variáveis de ambiente.

---

## 11. Decisões de arquitetura (ADRs)

Referência: `docs/ADR/`. Principais:

| ADR | Tema | Status |
|---|---|---|
| 0001 | Sincronização em tempo real com Yjs + WebSocket | Adotada |
| 0002 | Storage local JSON vs Drive/GitLab | Rejeitada (MVP) |
| 0003 | Docker + Compose | Adotada |
| 0004 | Licença MIT | Adotada |
| 0005 | Nome do projeto C4Arch | Adotada |
| 0006 | React Flow 12 | Adotada |
| 0007 | API autossuficiente | Adotada |
| 0008 | WebSocket cliente singleton + reconnect | Adotada |
| 0009 | API do modelo CRUD + pasta | Adotada |
| 0010 | Realtime merge parcial, IDs estáveis, snapshot atômico | Adotada |
| 0011 | Tipos frontend e typecheck no build | Adotada |
| 0012 | CRUD de modelo e acesso ao draw.io | Adotada |
| 0013 | Remoção de código morto | Adotada |
| 0014 | Hardening de segurança | Adotada |
| 0015 | Perfis e grupos de acesso | Adotada |
| 0016 | Biblioteca draw.io `c4arch` | Adotada |

---

## 12. Infraestrutura e deploy

### 12.1 Topologia

Serviços: `db`, `api`, `web`, `realtime`, `worker`, `storage-init`.

### 12.2 Variáveis de ambiente

Ver `.env.example`. Principais: `JWT_SECRET`, `POSTGRES_*`, `CORS_ORIGIN`, `BIND_ADDR`.

### 12.3 Portas

| Serviço | Porta (dev) |
|---|---|
| web | 3000 |
| api | 4000 |
| realtime | 4001 |
| db | 5432 |

### 12.4 Volumes

- `pgdata`: dados do PostgreSQL.
- `c4arch_storage`: snapshots JSON.

---

## 13. Qualidade e testes

- Typecheck real no build do frontend (`tsc --noEmit`).
- `npm audit` sem vulnerabilidades.
- Testes manuais de API e WebSocket.
- SAST/DAST pendentes (Trivy, Semgrep, Gitleaks) para CI.

---

## 14. Roadmap e riscos

### 14.1 Roadmap

1. Estabilização (fonte de verdade única, autorização em todas as rotas).
2. Colaboração completa (comentários, presença, versões).
3. Interoperabilidade (exportação JSON/YAML, Drive/GitLab).
4. Escala (realtime com persistência robusta, múltiplas instâncias).

### 14.2 Riscos conhecidos

- Duas fontes de estado (Postgres e Yjs) — consolidação pendente.
- Rate limit em memória por réplica.
- Segredos em variáveis de ambiente.

---

## 15. Aprovação

| Papel | Nome | Data | Assinatura |
|---|---|---|---|
| Arquiteto Sênior | _ | _ | _ |
| Tech Lead | _ | _ | _ |
| Product Owner | _ | _ | _ |

---

## Histórico de versões

| Versão | Data | Autor | Descrição |
|---|---|---|---|
| 1.0.0 | _dd/mm/aaaa_ | _nome_ | Versão inicial do template |
