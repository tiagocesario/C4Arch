# C4Arch — Checklist do M4 (UI)

- **Status:** M4 parcial concluído em 11/11/2026 (painel de versões + ativação de flags)
- **Plano:** `docs/PLANO-MIGRACAO-ONDA-1.md`
- **Pré-requisito:** `docs/M3-CHECKLIST.md`
- **Próxima fase:** M5 (cutover) — backend concluído; operação pendente

## 1. Escopo executado

O M4 completo (split em features, abas por view, drill-down, badges de escopo,
DAS por seção, painel de validação) é um esforço de 10–15 dias. Esta entrega
cobre a parte de maior valor imediato e ativa as flags do frontend:

- Painel de versões no modo de edição: lista versões (número, tipo, data,
  autor, hash) e permite restaurar com confirmação.
- Consumo das APIs de versões (`listModelVersions`, `getModelVersion`,
  `restoreModelVersion`) no frontend.
- Flags `VITE_CANONICAL_VIEWS`, `VITE_DAS_OVERRIDES` e `VITE_VERSION_HASH`
  passam a ter padrão `on` em `.env.example` e nos compose (build args).

## 2. Arquivos

**Novos**

- `docs/M4-CHECKLIST.md` (este arquivo)

**Alterados**

- `apps/web/src/services/api.ts` — tipos e funções de versões.
- `apps/web/src/App.tsx` — painel de versões no modo de edição.
- `.env.example`, `docker-compose.yaml`, `compose.production.yaml` — flags `on`.

## 3. Comandos

```text
npm run typecheck --workspace=@c4arch/web
npm run build --workspace=@c4arch/web
```

## 4. Evidências locais (11/11/2026)

```text
npm run typecheck --workspace=@c4arch/web → OK
npm run build --workspace=@c4arch/web     → OK
```

## 5. Limitações conhecidas

- A UI completa do M4 (abas por view, drill-down, badges de escopo, DAS por
  seção com edição/ocultação, painel de validação) permanece para iterações
  futuras; esta entrega foca no painel de versões e na ativação das flags.
- O painel de versões depende das rotas de versões do M3 (já implementadas).
- A edição por seção do DAS continua via textarea; a conversão em overrides
  ocorre no backend (`PUT /das`).
