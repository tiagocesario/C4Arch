# C4Arch — Product Requirements Document (PRD)

- **Versão:** 0.3.0 (revisada em 05/11/2026)
- **Status:** MVP em estabilização
- **Licença:** MIT
- **Substitui:** `docs/PDR.md` (mantido como registro histórico)

## 1. Visão

C4Arch é uma ferramenta aberta para arquitetos de soluções criarem e
evoluírem **um modelo C4 único e vivo** — Actor, System, Container e
Component, com suas conexões — em colaboração, com persistência no
PostgreSQL e edição em tempo real.

O produto nasce para equipes pequenas (4 arquitetos no MVP) que hoje mantêm
arquitetura em planilhas, apresentações e diagramas desatualizados.

## 2. Problema

- O desenho da arquitetura se descola do código e das decisões reais.
- Edições concorrentes sobrescrevem trabalho uns dos outros.
- Não há uma fonte única consultável e versionada.
- Exportar para formatos externos (draw.io, Drive, GitLab) é manual.

## 3. Público e personas

| Persona | Papel | Necessidade principal |
|---|---|---|
| Arquiteto Sênior | owner | Organizar o workspace, aprovar modelos e exportar |
| Arquiteto de Soluções | editor | Construir sistemas, contêineres e conexões |
| Arquiteto de Engenharia | editor | Detalhar componentes e integrar com o código |
| Arquiteto de Negócio | viewer | Ler, comentar e validar o modelo |

## 4. Escopo do MVP

### 4.1 Funcionalidades entregues

- Autenticação por e-mail e senha com JWT.
- Organizações e associação de usuários (membership).
- CRUD de modelos C4, com título, descrição, status (`draft`/`final`) e pasta.
- Listagem, busca e filtro de modelos por pasta.
- Editor visual com React Flow 12:
  - arrastar nós;
  - criar conexões entre elementos;
  - renomear elementos com duplo clique;
  - excluir elementos e conexões.
- Sincronização em tempo real via WebSocket + Yjs em memória.
- Persistência de snapshots JSON no volume `storage` do serviço realtime.
- Gestão de pastas, aplicações e serviços auxiliares.
- Abertura do editor draw.io a partir do modelo, inclusive logo após a criação.
- Importação/exportação do XML draw.io associado ao modelo.
- Modelos tipados pelos diagramas do C4 model (`c4_type`, `c4_scope`).
- Apps e serviços reutilizáveis como objetos C4 no draw.io, com propagação de edições.
- Lista de modelos dependentes de um app ou serviço.
- Biblioteca draw.io nomeada `c4arch` com download do XML.
- Listagem de modelos vinculados a uma pasta ao clicar nela.
- Módulo de perfis e grupos de acesso (owner/editor/viewer + grupos customizados).
- Vínculo de um novo tipo de diagrama a um modelo existente (`parent_id`),
  com filtro por título no cadastro e bloqueio de duplicidade de tipo por
  modelo/grupo.

### 4.2 Funcionalidades em estabilização / fora do MVP

- Comentários anexados a elementos.
- Histórico de versões e restauração.
- Exportação JSON/YAML (model-as-code).
- Sincronização com Google Drive e GitLab (ADR-0002 permanece rejeitada).
- Permissões granulares aplicadas em todas as rotas e na UI.
- Hierarquia C4 genérica em múltiplos níveis (o `parent_id` cobre apenas o
  vínculo de um novo tipo de diagrama a um modelo existente).
- Escala horizontal do serviço realtime.

## 5. Fluxos principais

### 5.1 Entrar e carregar o workspace

1. O usuário informa e-mail e senha.
2. A API devolve um JWT.
3. O frontend consulta `GET /api/auth/me`, descobre a organização e carrega
   modelos, pastas, aplicações e serviços.
4. Ao recarregar a página, a sessão é restaurada a partir do token salvo e
   validada novamente em `/api/auth/me`.

### 5.2 Criar um modelo

1. O usuário clica em **+ Novo modelo**.
2. Informa título, descrição opcional, pasta e se deseja abrir o draw.io.
3. A API valida organização, pasta, título e status.
4. O modelo é criado como `draft` e aberto no editor.
5. Se a opção estiver marcada, o draw.io é aberto em uma nova aba.

### 5.3 Editar um modelo

1. Na lista ou no rodapé do editor, o usuário clica em **Editar modelo**.
2. Altera título, descrição, status e pasta.
3. A API aplica atualização parcial e valida a pasta contra a organização.
4. A lista e o editor refletem os novos valores imediatamente.

### 5.4 Colaborar no diagrama

1. O cliente abre o modelo e envia `join` com o `modelId` (UUID).
2. O realtime carrega o snapshot do disco ou, se configurado, hidrata a partir
   da API.
3. Cada operação (`createElement`, `updateElement`, etc.) é aplicada ao
   documento Yjs e transmitida a todos os clientes do modelo.
4. `updateElement` faz **merge parcial**: mover um nó não apaga título, tipo,
   descrição ou metadados.
5. O snapshot é gravado de forma atômica (`.tmp` + `rename`).

## 6. Requisitos funcionais (numeração estável)

| ID | Requisito | Estado |
|---|---|---|
| RF-01 | Login e sessão persistente | Entregue |
| RF-02 | Organização e membership | Entregue (básico) |
| RF-03 | CRUD de modelo com título, descrição, status e pasta | Entregue |
| RF-04 | Busca e filtro por pasta | Entregue |
| RF-05 | Editor C4 com nós e conexões | Entregue |
| RF-06 | Edição concorrente sem perda de campos | Entregue |
| RF-07 | Acesso ao draw.io ao criar/editar modelo | Entregue |
| RF-08 | Importação/exportação draw.io | Entregue (XML) |
| RF-09 | Pastas, apps e serviços | Entregue (CRUD básico) |
| RF-10 | Comentários | Planejado |
| RF-11 | Versionamento e restauração | Planejado |
| RF-12 | Exportação JSON/YAML | Planejado |
| RF-13 | Drive/GitLab | Fora do MVP |
| RF-14 | Permissões owner/editor/viewer aplicadas ponta a ponta | Parcial |
| RF-15 | Modelos tipados por diagrama C4 (c4_type/c4_scope) | Entregue |
| RF-16 | Apps e serviços reutilizáveis com propagação e dependências | Entregue |
| RF-17 | Biblioteca draw.io `c4arch` com download | Entregue |
| RF-18 | Perfis e grupos de acesso customizados | Entregue |
| RF-19 | Vincular novo tipo de diagrama a modelo existente (`parent_id`), sem duplicar tipo | Entregue |

## 7. Requisitos não funcionais

- **Consistência:** uma operação de arrastar não pode remover campos do
  elemento. O merge deve ser parcial e determinístico.
- **Durabilidade:** snapshots devem ser gravados de forma atômica e salvos
  também quando o último cliente desconecta.
- **Segurança:** `modelId` é validado como UUID antes de compor caminhos de
  arquivo; o HTML do draw.io escapa título e atributos.
- **Qualidade:** o build do frontend executa typecheck real (`tsc --noEmit`)
  antes do `vite build`.
- **Portabilidade:** Node.js 20 LTS, PostgreSQL 16, Docker Compose.
- **Desempenho:** modelo com os quatro níveis e conexões deve permanecer
  fluido para 4 editores simultâneos.
- **Operabilidade:** variáveis sensíveis vêm do ambiente; containers não-root.

## 8. Arquitetura

```text
Navegador (React + React Flow)
   |  REST /api                        WebSocket /ws
   v                                      v
API (Express + JWT)                  Realtime (ws + Yjs)
   |                                      |
   +---------- PostgreSQL ----------------+--- snapshots JSON (storage)
   |
Worker (versões/sincronização futura)
```

### Fonte de verdade

- **PostgreSQL:** modelos, elementos, conexões, pastas, apps, serviços,
  usuários, organizações e permissões.
- **Realtime/Yjs:** estado ativo de edição em memória por modelo.
- **Snapshots JSON:** cache/recuperação de edição do realtime.

> **Risco conhecido:** ainda há duas fontes concorrentes (Postgres e Yjs). A
> consolidação definitiva — realtime persistindo no Postgres ou usando o
> Postgres como origem — está registrada como próximo passo de arquitetura.

## 9. Contratos

### 9.1 API REST

- Respostas do Postgres (`snake_case`) são normalizadas para `camelCase` no
  frontend por `apps/web/src/services/api.ts`.
- `POST /api/models` aceita `orgId`, `title`, `description`, `status`,
  `folderId`, `c4Type`, `c4Scope` e `parentId`. Quando `parentId` é informado,
  o novo modelo é um novo tipo de diagrama do modelo pai; a API rejeita com
  `409` se o tipo já existir no grupo (`parent_id`/`id`).
- `PUT /api/models/:id` aceita atualização parcial de `title`, `description`,
  `status` e `folderId`.
- `GET /api/models/:id` devolve o modelo com `elements` e `edges`.

### 9.2 WebSocket

```json
{ "type": "join", "modelId": "<uuid>" }
{ "type": "patch", "modelId": "<uuid>", "patch": { "op": "updateElement", "data": { "id": "<id>", "positionX": 120, "positionY": 80 } } }
```

Mensagens do servidor:

```json
{ "type": "state",  "modelId": "<uuid>", "model": { "elements": [], "edges": [] } }
{ "type": "update", "modelId": "<uuid>", "model": { "elements": [], "edges": [] } }
```

## 10. Critérios de aceite das correções (v0.2)

- [x] Mover um elemento preserva `title`, `type`, `description` e `metadata`.
- [x] IDs de elementos carregados de snapshots em array permanecem estáveis.
- [x] Conexões antigas com `from_id`/`to_id` são normalizadas e mantêm ID.
- [x] `modelId` inválido é rejeitado antes de qualquer escrita em disco.
- [x] Snapshot é gravado em arquivo temporário e renomeado.
- [x] `tsc -p tsconfig.app.json --noEmit` passa sem erros.
- [x] `npm run build` do frontend executa o typecheck antes do Vite.
- [x] Tipos de domínio têm uma única fonte (`services/types.ts`).
- [x] Criação de modelo grava descrição e valida pasta/status.
- [x] Edição de modelo permite título, descrição, status e pasta.
- [x] É possível abrir o draw.io ao criar um modelo e pelo editor.
- [x] Código morto e dependências não utilizadas foram removidos.

## 11. Roadmap

1. **Estabilização:** consolidar fonte de verdade, autorização em todas as
   rotas, tratamento de erros assíncronos, testes de integração.
2. **Colaboração completa:** comentários, presença, histórico de versões.
3. **Interoperabilidade:** exportação JSON/YAML e adaptador Drive/GitLab.
4. **Escala:** realtime com persistência robusta e suporte a múltiplas
   instâncias.
