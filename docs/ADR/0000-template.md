# C4Arch — Architecture Decision Records (ADR)

Pasta para documentar decisoes de arquitetura de forma permanente e reversivel.

Convenção de nomenclatura:

```text
ADR-<seq>-<curto>.md
```

Exemplo:

```text
ADR-0001-use-yjs-for-reactive-editing.md
```

Cada ADR deve seguir o template:

```markdown
# ADR-0001 — Tema conciso

## Status
Proposta / Adotada / Rejeitada / Obsoleto

## Contexto
O que esta decisao tenta resolver?

## Decisao
O que foi decidido?

## Consequencias
O que muda? Beneficios, custos, risco, alternativas descartadas.

## Data das
(dd/mm/aaaa) — autor
```

## Registros existentes

### ADR-0001 — Sincronizacao em tempo real com Yjs

- **Status:** Adotada
- **Contexto:** O modelo precisa ser editado simultaneamente por 4 arquitetos sem sobrescrever uns aos outros.
- **Decisao:** Usar Yjs (CRDT) para o documento do modelo (elements, edges, comments). O backend宰є a transmissao via WebSocket; o estado ativo fica em Yjs; o Postgres rege regras e historico.
- **Consequencias:** + edicao simultanea real; - complexidade de resolver conflitos de estrutura (dois editores deletando o mesmo elemento). Regra inicial: "previous wins" + overlay de conflito.
- **Data:** 03/11/2026 — time C4Arch

### ADR-0002 — Storage adapter para Google Drive e GitLab

- **Status:** Adotada
- **Contexto:** O modelo precisa ser exportado e sincronizado com sistemas externos (Drive/GitLab).
- **Decisao:** Criar a interface `ModelStorage` com adaptadores separados (DriveService, GitLabService). O backend escolhe o driver via variavel de ambiente (STORAGE_DRIVER=drive|gitlab).
- **Consequencias:** + suporte a dois drivers sem acoplar o dominio ao storage; - cobertura de testes para cada adapter.
- **Data:** 03/11/2026 — time C4Arch

### ADR-0003 — Docker + Compose para desenvolvimento e producao

- **Status:** Adotada
- **Contexto:** O produto velociza a adocao em ambientes Windows.
- **Decisao:** Usar Docker + docker-compose (compose.yaml para dev, compose.production.yaml para producao, com override de restart, NODE_ENV e ports).
- **Consequencias:** + unica forma de rodar e reproducible; - dependencia do Docker no ambiente de desenvolvimento.
- **Data:** 03/11/2026 — time C4Arch

### ADR-0004 — Licenca MIT para o repositorio

- **Status:** Adotada
- **Contexto:** Os arquitetos desejam código aberto, mas nao querem restringir uso interno.
- **Decisao:** Licenca MIT para todo o repositorio (source, docs, exemplo).
- **Consequencias:** + adocao ampla; - nenhuma restricao de uso comercico (evitar restringir licencas futuras de sub-packages).
- **Data:** 03/11/2026 — time C4Arch

### ADR-0005 — Nome do projeto C4Arch

- **Status:** Adotada
- **Contexto:** Definir nome e verificar disponibilidade de dominio/hospedagem.
- **Decisao:** C4Arch (abreviação de C4 Architecture). Verificar disponibilidade antes de publicar.
- **Consequencias:** - possível conflito de nome com marcas existentes; validar antes do publico.
- **Data:** 03/11/2026 — time C4Arch

## Como adicionar um novo ADR

1. Crie `docs/ADR/ADR-<seq>-tematica.md`.
2. Use o template padrão.
3. Registre a data, os envolvidos e o estado.
4. Atualize a lista de registros acima.
