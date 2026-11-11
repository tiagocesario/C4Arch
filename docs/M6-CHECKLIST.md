# C4Arch — Checklist do M6 (limpeza)

- **Status:** M6 parcial concluído em 11/11/2026
- **Plano:** `docs/PLANO-MIGRACAO-ONDA-1.md`
- **Pré-requisito:** `docs/M5-CHECKLIST.md`

## 1. Escopo executado

- Worker não executa mais migrações; o schema (`model_versions`,
  `model_version_counters`) é criado pela API.
- Documentação atualizada para refletir o cutover.

## 2. Limitações conhecidas

- A remoção completa de dual-write, fallback e colunas legadas exige validação
  de que nenhum leitor depende do legado; ficou para iteração posterior.
- `models.diagrams` ainda é usado para desenho; views canônicas coexistem.

## 3. Evidências

```text
npm run typecheck --workspace=@c4arch/worker → OK
npm run build --workspace=@c4arch/worker    → OK
```
