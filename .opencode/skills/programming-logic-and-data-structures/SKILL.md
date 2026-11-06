---
name: Lógica de Programação e Estruturas de Dados
description: Compreender algoritmos eficientes, manipulação de coleções, objetos e fluxos lógicos fundamentais.
---

# Lógica de Programação e Estruturas de Dados

Competência para raciocinar sobre algoritmos, escolher estruturas de dados adequadas
e construir fluxos lógicos corretos, eficientes e previsíveis.

## Quando usar

- Ao implementar ou revisar algoritmos e rotinas de processamento.
- Ao escolher entre listas, mapas, conjuntos, filas, pilhas, árvores ou grafos.
- Ao otimizar complexidade de tempo/espaço (Big-O).
- Ao depurar comportamento inesperado em loops, condições e transformações de dados.

## Princípios

1. **Correção antes de otimização**: primeiro garanta que o algoritmo está correto
   para todos os casos (incluindo vazios, nulos e extremos), depois otimize.
2. **Escolha a estrutura pelo acesso**: leitura aleatória → array/vetor; busca por chave →
   mapa/hash; unicidade → conjunto; FIFO → fila; LIFO → pilha; ordenação dinâmica → heap/árvore.
3. **Complexidade consciente**: conheça o custo de cada operação e evite O(n²) quando
   O(n log n) ou O(n) forem viáveis.
4. **Imutabilidade quando possível**: prefira transformar dados em novas estruturas
   em vez de mutar estado compartilhado, reduzindo efeitos colaterais.
5. **Casos de borda explícitos**: trate entradas vazias, duplicadas, fora de ordem e
   valores-limite como parte do design, não como exceção.

## Fluxo de trabalho

1. **Entenda o problema**: defina entrada, saída esperada e invariantes.
2. **Modele os dados**: escolha a estrutura que melhor representa as relações.
3. **Esboce o algoritmo** em pseudocódigo ou passos curtos antes de codar.
4. **Implemente de forma legível**: nomes claros, funções pequenas, sem "magia".
5. **Teste casos de borda** e meça complexidade quando relevante.
6. **Refatore** removendo duplicação e clarificando intenção.

## Checklist de revisão

- [ ] O algoritmo trata entrada vazia/nula?
- [ ] A complexidade é aceitável para o volume esperado?
- [ ] A estrutura de dados escolhida é a mais adequada?
- [ ] Há risco de mutação inesperada de estado compartilhado?
- [ ] Os nomes expressam a intenção do código?
