---
name: Arquitetura e Clean Code
description: Desenvolver código limpo, legível, testável e de fácil manutenção para qualquer outro desenvolvedor da equipe.
---

# Arquitetura e Clean Code

Competência para escrever código que outros desenvolvedores conseguem ler,
entender, testar e evoluir com segurança.

## Quando usar

- Ao criar ou refatorar módulos, classes e funções.
- Ao revisar pull requests e discutir design.
- Ao definir fronteiras entre camadas (domínio, aplicação, infraestrutura).
- Ao reduzir acoplamento e melhorar coesão.

## Princípios

1. **Nomes revelam intenção**: variáveis, funções e classes devem dizer o que fazem
   e por quê, evitando abreviações obscuras.
2. **Funções pequenas e de propósito único**: uma função faz uma coisa bem feita;
   se precisa de comentário para explicar, refatore.
3. **Baixo acoplamento, alta coesão**: módulos independentes, dependências explícitas,
   interfaces estáveis.
4. **Dependa de abstrações**: use injeção de dependência e inversão de controle para
   facilitar testes e troca de implementações.
5. **Regra do escoteiro**: deixe o código um pouco melhor do que encontrou.
6. **YAGNI e KISS**: não implemente o que ainda não é necessário; prefira soluções
   simples que resolvem o problema real.

## Fluxo de trabalho

1. **Entenda o requisito** e o contexto de negócio antes de codar.
2. **Desenhe as fronteiras**: identifique entidades, casos de uso e adaptadores.
3. **Implemente de dentro para fora**: núcleo de domínio puro, sem dependências
   de framework, cercado por infraestrutura.
4. **Escreva testes** que documentem o comportamento esperado.
5. **Refatore** em pequenos passos, mantendo os testes verdes.
6. **Revise** com foco em legibilidade, não apenas em "funciona".

## Checklist de revisão

- [ ] Os nomes expressam intenção sem comentários explicativos?
- [ ] As funções têm tamanho e responsabilidade adequados?
- [ ] Há dependências circulares ou acoplamento excessivo?
- [ ] O código é testável sem mocks excessivos?
- [ ] A estrutura segue convenções do projeto?
- [ ] Complexidade ciclomática está sob controle?
