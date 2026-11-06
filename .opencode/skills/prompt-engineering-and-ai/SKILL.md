---
name: Fundamentos de Engenharia de Prompt e IA
description: Utilizar ferramentas de assistência de codificação baseadas em IA com precisão, validando os resultados gerados de forma crítica.
---

# Fundamentos de Engenharia de Prompt e IA

Competência para usar assistentes de IA (Copilot, Gemini, ChatGPT etc.) de forma
precisa e crítica, validando o código gerado.

## Quando usar

- Ao solicitar geração, explicação ou refatoração de código com IA.
- Ao revisar sugestões automáticas antes de aceitá-las.
- Ao criar prompts reutilizáveis para tarefas recorrentes.
- Ao avaliar riscos de segurança e qualidade em código gerado por IA.

## Princípios

1. **Contexto claro e específico**: forneça linguagem, framework, versão, padrões do
   projeto e exemplos de entrada/saída.
2. **Tarefa bem delimitada**: peça uma coisa por vez; prompts grandes geram resultados
   vagos.
3. **Validação crítica**: nunca aceite código de IA sem ler, testar e entender.
   IA erra com confiança.
4. **Segurança primeiro**: revise segredos, injeções, dependências e licenças no código
   gerado.
5. **Iteração incremental**: refine com feedback específico ("adicione tratamento de erro X").
6. **Human-in-the-loop**: decisões de arquitetura e negócio são humanas; IA é ferramenta.

## Fluxo de trabalho

1. **Defina o objetivo** e os critérios de sucesso do código esperado.
2. **Monte o prompt** com contexto, restrições, formato de saída e exemplos.
3. **Gere e inspecione** a saída, linha por linha.
4. **Execute testes** e linters sobre o código gerado.
5. **Refine o prompt** com base nas falhas observadas.
6. **Documente** prompts úteis para reuso pela equipe.

## Checklist de revisão

- [ ] O prompt inclui contexto suficiente (stack, versão, padrões)?
- [ ] O código gerado foi lido e entendido?
- [ ] Testes foram executados sobre o código gerado?
- [ ] Há riscos de segurança (segredos, injeção, deps)?
- [ ] A licença das dependências sugeridas é compatível?
- [ ] O resultado foi validado em ambiente real?
