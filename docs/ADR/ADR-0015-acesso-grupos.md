# ADR-0015 — Perfis e grupos de acesso

- **Status:** Adotada
- **Data:** 2026-11-05 — time C4Arch

## Contexto

A gestão de usuários era limitada aos perfis fixos `owner`/`editor`/`viewer`. Equipes
precisavam agrupar usuários em conjuntos com perfil base comum para facilitar a
administração de acesso.

## Decisão

1. Manter os perfis fixos como base do RBAC (`memberships.role`).
2. Criar as tabelas `access_groups` e `access_group_members` por organização.
3. Um grupo possui `base_role` (owner/editor/viewer); ao adicionar um membro, o
   perfil base é aplicado à membership se for mais permissivo.
4. Rotas `/api/groups` (CRUD + membros) restritas a `owner` para mutações.
5. UI dedicada "Perfis/Grupos" no frontend (somente owner).

## Consequências

- + Agrupamento de usuários por perfil base.
- + Reutilização do RBAC existente sem migração de `memberships`.
- - Grupos não removem permissões já concedidas (papel permanece).
- - Sem permissões granulares por recurso (apenas por perfil base).

## Referências

- `apps/api/src/controllers/groups.controller.ts`
- `apps/api/src/routes/groups.routes.ts`
- `apps/web/src/pages/GroupManagement.tsx`
- `docs/PRD.md` (RF-18)
