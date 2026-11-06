---
name: Testes de Software
description: Implementar rotinas mínimas de testes unitários e de integração para garantir a estabilidade das entregas.
---

# Testes de Software

Competência para garantir estabilidade das entregas por meio de testes unitários
e de integração bem desenhados.

## Quando usar

- Ao implementar novas funcionalidades ou corrigir bugs.
- Ao refatorar código existente (testes como rede de segurança).
- Ao validar integrações com banco de dados, APIs externas ou filas.
- Ao definir critérios de aceite e cobertura mínima.

## Princípios

1. **Pirâmide de testes**: muitos testes unitários rápidos, menos de integração,
   poucos end-to-end.
2. **Teste comportamento, não implementação**: valide resultados observáveis, não
   detalhes internos que podem mudar.
3. **AAA (Arrange, Act, Assert)**: estruture cada teste em três blocos claros.
4. **Um motivo por teste**: cada teste deve falhar por uma única razão.
5. **Testes determinísticos**: sem dependência de tempo, ordem ou estado externo
   não controlado; use mocks/stubs/fakes quando necessário.
6. **Nomes descritivos**: o nome do teste deve descrever o cenário e o resultado
   esperado.

## Fluxo de trabalho

1. **Identifique o comportamento** a ser verificado (happy path e casos de erro).
2. **Escreva o teste primeiro** (TDD) ou logo após a implementação.
3. **Isole a unidade**: injete dependências e use doubles para I/O.
4. **Execute e confirme** que o teste falha antes da implementação (red) e passa depois (green).
5. **Refatore** mantendo os testes verdes.
6. **Adicione testes de integração** para fluxos críticos e contratos externos.

## Checklist de revisão

- [ ] Os testes cobrem happy path e casos de erro/borda?
- [ ] Os testes são rápidos e independentes entre si?
- [ ] Não há testes que dependem de ordem de execução?
- [ ] Mocks são usados apenas onde há I/O ou dependência externa?
- [ ] A cobertura mínima acordada foi atingida?
- [ ] Testes de integração validam contratos reais?
