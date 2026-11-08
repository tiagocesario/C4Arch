# ADR-0020 — Endurecimento de importação, grupos de acesso e exportação do DAS

- **Status:** Adotada
- **Data:** 08/11/2026 — time C4Arch
- **Relaciona-se com:** ADR-0014 (hardening), ADR-0015 (grupos de acesso),
  ADR-0019 (importação por URL e DAS automático)

## Contexto

A revisão de segurança do código encontrou quatro classes de problema que não
eram cobertas pelos testes existentes:

1. **Escalada de privilégio em grupos de acesso:** `editor` podia criar/editar
   grupos, adicionar membros e, como a entrada no grupo aplica o `base_role`,
   conceder `owner` a qualquer membro. A documentação já dizia que a gestão era
   exclusiva do `owner`; o código não.
2. **SSRF incompleto na importação por URL:** a checagem era apenas textual
   (sem DNS), seguia redirecionamentos automaticamente e lia o corpo inteiro com
   `response.text()`, sem limite quando não havia `Content-Length`. A cobertura
   de IPv6 e faixas reservadas também era parcial.
3. **XSS armazenado na exportação do DAS para PDF:** o título do modelo era
   interpolado sem escape em uma janela criada com `document.write`.
4. **Robustez/autenticação:** `scryptSync` bloqueava o event loop; UUIDs
   inválidos viravam erro de cast do Postgres (`500`); segredos e senhas de
   exemplo podiam passar pela validação de produção; e o merge de headers em
   `fetch` permitia sobrescrever `Authorization`/`Content-Type`.

## Decisão

1. **Grupos somente por `owner`:** `POST/PUT/DELETE /api/groups` e as rotas de
   membros exigem `requesterRole === 'owner'`. Leitura de grupos e membros
   continua disponível a qualquer membro da organização. A promoção automática
   de `memberships.role` permanece, mas só pode ser disparada por um `owner`.
2. **Módulo dedicado de URL segura:** `apps/api/src/security/url.ts` centraliza
   `parsePublicHttpUrl`, `isPrivateIpAddress`, `resolvePublicAddresses`,
   `assertPublicHttpUrl`, `readLimitedBody` e `fetchPublicText`.
   - Bloqueia IPv4/IPv6 privados, reservados, multicast, IPv4 mapeado e NAT64.
   - Resolve DNS e rejeita se **qualquer** endereço retornado for privado.
   - Segue no máximo 3 redirecionamentos manualmente, revalidando cada salto.
   - Lê o corpo em streaming com limite rígido de bytes.
3. **Escape sistemático na exportação:** `escapeHtml` passa a escapar também
   `"` e `'`; título do modelo e URL do preview são escapados antes de entrar no
   HTML de impressão. A URL só é aceita como `src` de iframe após o escape.
4. **KDF assíncrono e erros de banco:** `hashPassword` usa `crypto.scrypt` via
   Promise; corrida de e-mail único (`23505`) vira `409`; UUIDs são validados
   antes das queries, retornando `400`/`404`.
5. **Guardas de produção:** `JWT_SECRET`, `DB_PASSWORD` e `DEMO_ADMIN_PASSWORD`
   rejeitam placeholders em produção; seed demo com senha fraca impede o boot.
6. **Headers e corpo:** o cliente web usa `{ ...options, headers }` para não
   perder `Authorization`; a API rejeita corpos JSON que não sejam objetos.
7. **CORS da biblioteca draw.io:** mantém o wildcard necessário ao draw.io, mas
   remove `Access-Control-Allow-Private-Network`.
8. **Testes automatizados:** Node test runner + `tsx`, sem novas dependências.
   API cobre URL/SSRF, parsing do DAS e tokens; realtime cobre o merge parcial e
   a exclusão em cascata do CRDT.

## Consequências

- + `editor` deixa de conseguir se promover a `owner` por grupos de acesso.
- + A importação por URL resiste a DNS para rede interna, redirecionamentos
  maliciosos e respostas sem `Content-Length`.
- + Títulos e conteúdo do modelo não executam script na janela de impressão.
- + A API responde `400`/`404` a identificadores inválidos e não bloqueia o event
  loop durante login/registro.
- + Configurações de produção falham cedo quando usam segredos de exemplo.
- + Regressões passam a ser detectadas por `npm test`.
- - O risco de DNS rebinding foi mitigado fixando o IP validado no socket via
  `lookup` customizado; redirecionamentos continuam revalidados.
- - O endpoint de biblioteca draw.io não usa mais wildcard nem Private Network;
  depende da allowlist global de origens do draw.io.
- - `editor` que antes administrava grupos precisa ser promovido a `owner`.

## Referências

- `apps/api/src/security/url.ts`
- `apps/api/src/controllers/models.controller.ts` (`importModel`)
- `apps/api/src/controllers/groups.controller.ts`
- `apps/api/src/auth/access.ts`, `apps/api/src/auth/service.ts`
- `apps/api/src/config.ts`, `apps/api/src/db.ts`, `apps/api/src/server.ts`
- `apps/web/src/App.tsx` (exportação do DAS), `apps/web/src/services/api.ts`
- `apps/api/test/`, `apps/realtime/test/`
- `docs/SECURITY.md`
