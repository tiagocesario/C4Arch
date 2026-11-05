# Checklist de revisão de diagrama de arquitetura

Fonte: <https://c4model.com/diagrams/checklist> (CC BY 4.0).

Use antes de considerar um diagrama pronto. Se qualquer resposta for "não",
corrija ou justifique.

## Geral

- [ ] O diagrama tem título?
- [ ] Dá para entender qual é o **tipo** do diagrama?
- [ ] Dá para entender qual é o **escopo** do diagrama?
- [ ] O diagrama tem **key/legend**?

## Elementos

- [ ] Todo elemento tem nome?
- [ ] Dá para entender o **tipo** de cada elemento (software system, container,
      component etc.)?
- [ ] Dá para entender **o que cada elemento faz**?
- [ ] Quando aplicável, dá para entender a **tecnologia** de cada elemento?
- [ ] Dá para entender todas as siglas e abreviações?
- [ ] Dá para entender o significado de todas as **cores**?
- [ ] Dá para entender o significado de todas as **formas**?
- [ ] Dá para entender o significado de todos os **ícones**?
- [ ] Dá para entender o significado de todos os **estilos de borda**
      (sólida, tracejada etc.)?
- [ ] Dá para entender o significado de todos os **tamanhos** de elemento
      (caixas pequenas vs. grandes)?

## Relações

- [ ] Toda seta tem rótulo descrevendo a **intenção** da relação?
- [ ] A descrição corresponde à **direção** da relação?
- [ ] Quando aplicável, dá para entender a **tecnologia** de cada relação
      (ex.: protocolos de comunicação inter-processo)?
- [ ] Dá para entender todas as siglas e abreviações?
- [ ] Dá para entender o significado de todas as **cores**?
- [ ] Dá para entender o significado de todas as **pontas de seta**?
- [ ] Dá para entender o significado de todos os **estilos de linha**
      (sólida, tracejada etc.)?

## Filtro rápido por tipo

- **System Context:** só pessoas, o system em escopo e systems externos; sem
  tecnologia/protocolos em excesso.
- **Container:** apps e data stores com tecnologia; pessoas/systems externos nas
  bordas; sem components nem detalhes de deployment.
- **Component:** components de um único container; sem classes; tecnologia
  explícita.
- **Code:** só quando realmente necessário; foco na história, não em todo o
  código.
- **Landscape:** pessoas e systems do escopo organizacional; sem foco em um
  system específico.
- **Dynamic:** uma feature/caso de uso; interações numeradas na ordem.
- **Deployment:** um ambiente; deployment nodes (aninháveis), instâncias de
  systems/containers e infrastructure nodes na legenda.
