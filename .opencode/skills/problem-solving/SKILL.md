---
name: Resolução de Problemas
description: Quebrar um obstáculo de grande escala em pequenas tarefas lógicas e focar na entrega de soluções diretas e eficientes.
---

# Resolução de Problemas

Competência para decompor problemas complexos em tarefas menores e entregar
soluções diretas e eficientes.

## Quando usar

- Ao enfrentar bugs difíceis ou incidentes em produção.
- Ao planejar features de escopo grande.
- Ao priorizar e destravar trabalho bloqueado.
- Ao investigar comportamento inesperado em sistemas.

## Princípios

1. **Decomposição**: quebre o problema em partes menores e independentes até
   que cada uma seja solucionável.
2. **Defina o problema antes da solução**: escreva o problema em uma frase antes
   de propor fix.
3. **Hipóteses testáveis**: formule hipóteses e valide com experimentos/dados,
   não com suposições.
4. **Solução mínima viável**: entregue a menor mudança que resolve o problema real.
5. **Evite otimização prematura**: resolva o gargalo medido, não o imaginado.
6. **Aprenda com o incidente**: registre causa raiz e ações preventivas.

## Fluxo de trabalho

1. **Reproduza** o problema de forma confiável (ou caracterize a ausência).
2. **Isole** a causa: divida o sistema em componentes e teste cada um.
3. **Formule hipóteses** e valide com logs, métricas ou experimentos.
4. **Implemente** a correção mínima.
5. **Verifique** com testes e monitoramento.
6. **Documente** causa raiz e follow-ups.

## Checklist de revisão

- [ ] O problema está claramente definido em uma frase?
- [ ] A causa raiz foi identificada (não apenas o sintoma)?
- [ ] A solução é a mínima necessária?
- [ ] Há testes cobrindo o cenário que falhou?
- [ ] Follow-ups e prevenções foram registrados?
