# Integrações com APIs de outros sistemas

Este documento descreve o módulo de **integrações de saída** do C4Arch: como
configurar APIs de outros sistemas e como o C4Arch envia, automaticamente, o
desenho **draw.io** e o **DAS** de cada modelo para as URLs vinculadas.

## Visão geral

O C4Arch continua sendo a fonte de verdade do modelo C4. A integração é uma
**projeção de saída**: sempre que o modelo muda, a API monta o XML draw.io e o
DAS atuais e faz uma chamada HTTP para as URLs configuradas. O sistema externo
recebe o conteúdo e decide o que fazer com ele (publicar em um portal, indexar,
versionar etc.).

A entrega é **best-effort e assíncrona**:

- a requisição que originou a mudança responde normalmente, sem esperar o
  sistema externo;
- uma falha de rede, timeout ou resposta de erro do sistema externo **nunca**
  derruba a operação principal (salvar modelo, editar elemento etc.);
- o resultado do último envio fica registrado no vínculo (`last_sync_*`) e é
  exibido na tela **Integrações**.

## Conceitos

| Conceito | Escopo | Descrição |
|---|---|---|
| **Sistema externo** (`external_systems`) | Organização | Cadastro da API de destino: nome, URL base opcional, autenticação e headers extras. |
| **Vínculo** (`model_external_bindings`) | Modelo + sistema | Define a URL que recebe o draw.io, a URL que recebe o DAS, o método HTTP e o formato do corpo. |

Um modelo pode ter vários vínculos (um por sistema externo) e um sistema externo
pode atender vários modelos. O par `(model_id, external_system_id)` é único.

### Modelo de dados

`external_systems`:

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | UUID | PK |
| `org_id` | UUID | FK para `organizations`; isolamento por organização |
| `name` | TEXT | Único por organização |
| `base_url` | TEXT | Opcional; apenas informativo/referência |
| `auth_type` | TEXT | `none`, `bearer` ou `basic` |
| `auth_token` | TEXT | Token ou senha; **nunca** retornado pela API |
| `auth_user` | TEXT | Usuário do modo `basic` |
| `headers` | JSONB | Headers extras enviados em toda chamada |
| `enabled` | BOOLEAN | Desliga o sistema sem apagar os vínculos |

`model_external_bindings`:

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | UUID | PK |
| `model_id` | UUID | FK para `models` (cascade) |
| `external_system_id` | UUID | FK para `external_systems` (cascade) |
| `drawio_url` | TEXT | Destino do XML draw.io (opcional) |
| `das_url` | TEXT | Destino do DAS em Markdown (opcional) |
| `method` | TEXT | `POST`, `PUT` (padrão) ou `PATCH` |
| `format` | TEXT | `json` (padrão) ou `raw` |
| `enabled` | BOOLEAN | Desliga o envio sem apagar o vínculo |
| `last_sync_at` | TIMESTAMPTZ | Momento do último envio |
| `last_sync_status` | TEXT | `ok`, `partial` ou `error` |
| `last_sync_error` | TEXT | Detalhe das falhas (até 1000 caracteres) |
| `last_drawio_hash` | TEXT | Hash do último draw.io entregue com sucesso |
| `last_das_hash` | TEXT | Hash do último DAS entregue com sucesso |

Pelo menos uma das URLs (`drawio_url`/`das_url`) deve ser informada. Cada alvo é
enviado de forma independente: é possível publicar só o DAS, só o draw.io ou
ambos.

## Quando o envio acontece

A sincronização é disparada após as operações que alteram o conteúdo do modelo:

- salvar o XML no editor draw.io;
- importar/aplicar um diagrama PlantUML;
- criar, editar ou excluir elemento;
- criar, editar ou excluir relação;
- atualizar os dados do modelo;
- atualizar o DAS;
- adicionar um novo tipo de diagrama ao modelo;
- restaurar uma versão.

O envio manual pelo botão **Enviar agora** ignora o cache de hash e reenvia o
conteúdo atual.

## Contrato HTTP

### Cabeçalhos

Toda chamada envia:

| Header | Valor |
|---|---|
| `Content-Type` | `application/json; charset=utf-8` ou `application/xml`/`text/markdown` no formato `raw` |
| `Accept` | `application/json, text/plain, */*` |
| `User-Agent` | `C4Arch-Integrations/1.0` |
| `X-C4Arch-Event` | Evento que originou o envio |
| `X-C4Arch-Model-Id` | UUID do modelo |
| `X-C4Arch-Target` | `drawio` ou `das` |
| `Authorization` | `Bearer <token>` ou `Basic <base64(usuario:senha)>`, conforme o sistema |
| headers extras | Os configurados no sistema externo |

Eventos possíveis: `model.created`, `model.updated`, `model.das.updated`.

### Formato `json` (padrão)

```json
{
  "event": "model.updated",
  "target": "das",
  "content": "# DAS ...",
  "model": {
    "id": "60bfd0bd-ed00-4b08-a945-2d655af44f7d",
    "orgId": "…",
    "title": "Loja Online",
    "description": "Arquitetura de referência",
    "status": "draft",
    "c4Type": "container",
    "c4Scope": null,
    "updatedAt": "2026-11-26T12:00:00.000Z"
  },
  "drawio": { "xml": "<mxfile>…</mxfile>" },
  "das": { "content": "# DAS ..." },
  "plantuml": { "source": "@startuml ..." },
  "sentAt": "2026-11-26T12:00:01.000Z"
}
```

O campo `content` repete o conteúdo do alvo da chamada (`drawio.xml` ou
`das.content`), para que o receptor não precise saber qual alvo está sendo
enviado. O payload sempre inclui as duas projeções e o fonte PlantUML.

### Formato `raw`

O corpo é o conteúdo puro do alvo:

- draw.io: XML (`application/xml; charset=utf-8`);
- DAS: Markdown (`text/markdown; charset=utf-8`).

Indicado para receptores simples (um webhook que grava o arquivo recebido).

### Respostas e redirecionamentos

- Qualquer resposta `2xx` é sucesso.
- Respostas `3xx` são tratadas como falha: o cliente **não segue**
  redirecionamentos, para que um endpoint comprometido não desvie o envio para
  outro host.
- Respostas de erro são registradas em `last_sync_error` com status e um trecho
  do corpo (até 500 caracteres).
- O timeout padrão é de 10 segundos.

## Deduplicação por hash

Antes de cada envio, o C4Arch calcula um SHA-256 do conteúdo do alvo junto com
os metadados do modelo. Se o hash for igual ao último entregue com sucesso
(`last_drawio_hash`/`last_das_hash`), o envio daquele alvo é **ignorado**. Isso
evita tráfego redundante em autosaves e edições que não mudam o conteúdo.

O envio manual (`POST /api/models/{id}/integrations/{bindingId}/sync`) usa
`force: true` e ignora essa comparação.

## Segurança

- A configuração é restrita a `owner` e `editor` da organização; **remover** um
  sistema externo é exclusivo de `owner`.
- O token/senha nunca é devolvido pela API: a resposta expõe apenas
  `hasAuthToken: true|false`. Ao editar, deixar o campo vazio mantém o valor
  atual.
- URLs com credenciais embutidas (`https://user:senha@host`) são rejeitadas.
- Diferentemente da importação por URL, integrações **podem** apontar para
  serviços da rede interna (caso de uso principal). Por isso a validação é
  sintática (http/https, host válido, tamanho máximo) e não bloqueia faixas
  privadas. A configuração controlada por `owner`/`editor` é o limite de
  confiança.
- Headers extras são validados contra injeção de CR/LF, limitados a 30
  entradas e não podem sobrescrever headers controlados pelo cliente HTTP
  (`Host`, `Content-Length`, `Connection`, `Transfer-Encoding`, `Upgrade`,
  `Expect`).
- O envio é registrado em `audit_log` na criação, edição e remoção de sistemas
  e vínculos.

## API

Todas as rotas exigem `Authorization: Bearer <jwt>`.

### Sistemas externos

```http
GET    /api/integrations?orgId=<uuid>
POST   /api/integrations
PUT    /api/integrations/{systemId}
DELETE /api/integrations/{systemId}
```

Exemplo de criação:

```bash
curl -X POST http://localhost:4000/api/integrations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orgId": "…",
    "name": "Portal de arquitetura",
    "baseUrl": "https://portal.interno/api",
    "authType": "bearer",
    "authToken": "segredo",
    "headers": { "X-Ambiente": "prod" },
    "enabled": true
  }'
```

### Vínculos por modelo

```http
GET    /api/models/{id}/integrations
POST   /api/models/{id}/integrations
PUT    /api/models/{id}/integrations/{bindingId}
DELETE /api/models/{id}/integrations/{bindingId}
POST   /api/models/{id}/integrations/{bindingId}/sync
```

Exemplo de vínculo:

```bash
curl -X POST http://localhost:4000/api/models/$MODEL/integrations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "externalSystemId": "…",
    "drawioUrl": "https://portal.interno/api/modelos/123/drawio",
    "dasUrl": "https://portal.interno/api/modelos/123/das",
    "method": "PUT",
    "format": "json",
    "enabled": true
  }'
```

O envio manual devolve o resultado por alvo:

```json
{
  "ok": true,
  "results": [
    {
      "bindingId": "…",
      "externalSystemId": "…",
      "externalSystemName": "Portal de arquitetura",
      "deliveries": [
        { "target": "drawio", "url": "…", "status": 200, "ok": true, "skipped": false, "error": null },
        { "target": "das", "url": "…", "status": 204, "ok": true, "skipped": false, "error": null }
      ]
    }
  ]
}
```

## Interface

A tela **Integrações** (menu principal, visível para `owner` e `editor`) tem
duas seções:

1. **Sistemas externos** — cadastro, edição, ativação e remoção (owner).
2. **Vínculos por modelo** — seleção do modelo, cadastro do vínculo com as URLs
   de draw.io e DAS, método, formato, status do último envio, edição, remoção e
   **Enviar agora**.

## Operação e limitações

- Não há fila persistente nem retry automático nesta versão. Se o sistema
  externo estiver fora do ar no momento da mudança, o envio é perdido e o erro
  fica registrado; use **Enviar agora** para reconciliar.
- O envio é feito no processo da API, em background. Em modelos muito grandes o
  custo de exportar draw.io/PlantUML e regenerar o DAS pode ser relevante.
- Cada sistema externo é chamado em sequência; um destino lento consome até o
  timeout configurado (10 s por padrão).
- O receptor deve ser idempotente: o mesmo conteúdo pode ser reenviado após uma
  restauração de versão ou um envio manual.

## Testes

`apps/api/test/external-sync.test.ts` cobre:

- validação de URLs de integração (http/https, credenciais embutidas, tamanho);
- hash determinístico do conteúdo;
- montagem do payload JSON e do corpo `raw`;
- geração do draw.io a partir do grafo e uso do XML informado;
- entrega HTTP real em servidor local, incluindo método, headers, corpo, erro
  HTTP, recusa de redirecionamento e falha de conexão.

## Referências

- `apps/api/src/c4/external-sync.ts` — montagem do payload, hash e entrega.
- `apps/api/src/controllers/integrations.controller.ts` — CRUD e envio manual.
- `apps/api/src/routes/integrations.routes.ts` — rotas autenticadas.
- `apps/api/src/db/migrate.ts` — migration `004-external-integrations`.
- `apps/web/src/pages/IntegrationsPage.tsx` — tela de configuração.
- `docs/ADR/ADR-0026-integracoes-saida-http.md` — decisão de arquitetura.
