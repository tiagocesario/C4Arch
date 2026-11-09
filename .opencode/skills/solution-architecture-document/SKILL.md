---
name: Solution Architecture Document
description: Use ao criar, revisar ou melhorar um DAS/SAD (Documento de Arquitetura de Soluções / Solution Architecture Document), incluindo sumário executivo, visões C4, integrações, dados, segurança, infraestrutura, requisitos não funcionais, riscos e plano de transição.
---

# Solution Architecture Document (SAD/DAS)

Skill para produzir e revisar um **Documento de Arquitetura de Soluções** enxuto,
útil e rastreável, alinhado ao template do C4Arch. Fonte conceitual:
[Alessandro Traversi — Understanding the SAD with a Lean Template](https://medium.com/@alessandro.traversi/understanding-the-solution-architecture-document-sad-with-a-lean-template-050287994a88).

## Quando usar

- Criar o DAS de um novo produto, sistema ou iniciativa.
- Revisar um DAS existente antes de aprovação, go-live ou troca de time.
- Explicar a arquitetura para stakeholders técnicos e não técnicos.
- Registrar decisões, restrições, riscos e plano de transição.
- Gerar ou complementar o DAS do C4Arch a partir de um modelo C4.

## Propósito do documento

Um DAS existe para três coisas:

1. **Orientar** a execução: dar ao time um framework claro para construir.
2. **Comunicar** a arquitetura: criar entendimento compartilhado entre áreas.
3. **Documentar** decisões e justificativas: servir de referência para manutenção,
   auditoria e projetos futuros.

O documento deve ser **vivo**: revisado e atualizado quando escopo, tecnologia ou
estratégia de negócio mudarem.

## Princípios

1. **Comece pelo negócio.** Problema, objetivo e critério de sucesso antes de
   tecnologia.
2. **Ajuste a profundidade.** Documento enxuto para MVPs; detalhado apenas onde
   houver risco, custo ou decisão relevante.
3. **Uma fonte de verdade por assunto.** Requisitos no PRD/backlog, decisões em
   ADRs, diagramas no modelo C4, DAS consolida e referencia.
4. **Rastreabilidade.** Cada requisito, decisão, risco e NFR deve ter origem ou
   responsável.
5. **Diagramas com escopo.** Cada diagrama responde a uma pergunta e informa
   título, nível C4 e legenda.
6. **Segurança e operação desde o início.** Não deixe NFRs, dados e segurança
   para o final.
7. **Sem redundância.** Prefira links para ADRs, PRD e repositório em vez de
   copiar conteúdo que envelhece.
8. **Linguagem do público.** Sumário executivo sem jargão; seções técnicas com
   precisão.

## Fluxo de trabalho

1. **Defina escopo, público e decisão esperada.**
   - Qual solução/produto está em foco?
   - Quem lê: negócio, arquitetura, desenvolvimento, segurança, operações?
   - O documento serve para aprovar, financiar, construir ou operar?
2. **Colete as entradas.**
   - Objetivos e requisitos de negócio (PRD, OKRs, entrevistas).
   - Restrições técnicas, orçamentárias, regulatórias e de prazo.
   - Estado atual (sistemas, integrações, dívidas e limitações).
   - ADRs, políticas de segurança, contratos e SLAs existentes.
3. **Escolha o nível de detalhe.**
   - Lean: contexto + containers + decisões + riscos (padrão recomendado).
   - Completo: acrescente componentes, dados, infraestrutura e migração.
   - Só desça para código quando isso reduzir risco real.
4. **Desenhe as visões C4 necessárias.**
   - Contexto e containers são o mínimo para a maioria dos casos.
   - Componentes apenas para áreas complexas ou críticas.
   - Use a skill **C4 Model** para notação e níveis.
5. **Escreva as seções na ordem do template**, preenchendo primeiro o que é
   conhecido e marcando explicitamente o que é premissa, dúvida ou `_a definir_`.
6. **Valide com os stakeholders.**
   - Negócio: o problema e o critério de sucesso estão corretos?
   - Engenharia: as decisões são viáveis e executáveis?
   - Segurança/operações: dados, acessos e NFRs estão cobertos?
7. **Revise com o checklist** e registre aprovação e histórico de versões.
8. **Mantenha vivo.** Atualize em mudanças de escopo, arquitetura, risco ou
   go-live; decisões pontuais viram ADR.

## Estrutura recomendada (template enxuto)

```text
## Controle do documento
- Versão, autores, data, aprovação e histórico de mudanças

## Sumário
1. Sumário executivo
2. Visão geral da arquitetura da solução
3. Caso de negócio
4. Resumo de requisitos
5. Desenho de alto nível
6. Arquitetura detalhada
7. Arquitetura de integração
8. Arquitetura de dados
9. Arquitetura de segurança
10. Requisitos de infraestrutura
11. Requisitos não funcionais
12. Estratégia de transição e implementação
13. Riscos e mitigações
14. Apêndices
15. Glossário
```

No C4Arch, use `docs/DAS-template.md` como base operacional. Ele já adapta o
template para: informações do documento, visão geral, requisitos/restrições,
stakeholders/personas, C4 níveis 1–4, modelo de dados, segurança, ADRs,
infraestrutura/deploy, qualidade/testes, roadmap/riscos e aprovação.

## O que colocar em cada seção

| Seção | Objetivo | Conteúdo mínimo |
|---|---|---|
| Controle do documento | Governança | Versão, autores, data, aprovador, histórico |
| Sumário executivo | Decisão e leitura rápida | Problema, solução proposta, benefícios, custo/risco principal |
| Visão geral | Entendimento compartilhado | Escopo, contexto, princípios e restrições que moldam a solução |
| Caso de negócio | Justificar investimento | Problema/oportunidade, impacto, alternativas, critério de sucesso |
| Requisitos | Base de validação | RFs resumidos, NFRs mensuráveis, premissas e exclusões |
| Desenho de alto nível | Visão conceitual | Diagrama de contexto, atores, sistemas externos, limites |
| Arquitetura detalhada | Execução técnica | Containers, componentes, responsabilidades, tecnologias, portas |
| Integração | Evitar surpresas | APIs, eventos, protocolos, contratos, autenticação, SLAs |
| Dados | Fonte de verdade | Entidades, relacionamentos, retenção, migração, backup, LGPD |
| Segurança | Proteção e compliance | Autenticação, autorização, criptografia, segredos, ameaças, auditoria |
| Infraestrutura | Operabilidade | Ambientes, topologia, rede, volumes, observabilidade, deploy |
| NFRs | Critérios verificáveis | Desempenho, disponibilidade, escala, recuperação, custo |
| Transição | Como chegar lá | Fases, marcos, migração, rollback, treinamento, cutover |
| Riscos | Transparência | Risco, probabilidade, impacto, mitigação, responsável |
| Apêndices/glossário | Suporte | Evidências, cálculos, termos e siglas |

## Checklist de qualidade

- [ ] O problema de negócio e o critério de sucesso estão explícitos.
- [ ] Escopo incluído, excluído e fronteiras estão claros.
- [ ] Requisitos funcionais e não funcionais são verificáveis.
- [ ] Cada NFR tem métrica/alvo (ex.: p95 < 200 ms, 99,9% de uptime).
- [ ] Diagramas têm título, nível C4, escopo e legenda.
- [ ] Containers e integrações informam tecnologia, protocolo e autenticação.
- [ ] Dados cobrem fonte de verdade, retenção, backup e privacidade.
- [ ] Segurança cobre autenticação, autorização, segredos e riscos residuais.
- [ ] Decisões relevantes remetem a ADRs em vez de duplicar justificativas.
- [ ] Premissas, dúvidas e pontos `_a definir_` estão visíveis.
- [ ] Riscos têm mitigação e responsável.
- [ ] Plano de transição inclui fases, rollback e critérios de go-live.
- [ ] Versão, aprovação e histórico estão atualizados.
- [ ] O documento pode ser entendido por negócio e executado por engenharia.

## Erros comuns

- Começar por tecnologias e frameworks antes do problema e dos requisitos.
- Copiar um template inteiro e deixar seções vazias sem sinalizar pendências.
- Misturar níveis C4 no mesmo diagrama ou usar “container” como container Docker.
- NFRs vagos (“rápido”, “escalável”, “seguro”) sem métrica.
- Repetir conteúdo do PRD ou dos ADRs, criando duas fontes de verdade.
- Omitir integrações, dados sensíveis, retenção ou plano de migração.
- Listar riscos sem mitigação, dono ou impacto.
- Tratar o DAS como documento imutável após a aprovação.

## Particularidades do C4Arch

- O DAS do produto fica em `docs/DAS.md`; o template em `docs/DAS-template.md`.
- No app, `models.das_content` é **gerado** a partir do modelo C4
  (`apps/api/src/c4/das.ts`). A geração percorre o tipo primário e os diagramas
  extras, lê elementos/conexões do draw.io e enriquece apps/serviços.
- O conteúdo é regenerado na criação/edição do modelo, importação, adição de
  diagrama, primeira leitura sem DAS e no startup. Portanto, para manter uma
  alteração, prefira ajustar o **modelo C4/diagramas**; texto editado apenas no
  formulário do DAS pode ser sobrescrito na próxima regeneração.
- Use a skill **C4 Model** para níveis, elementos e relações aceitos.
- Registre decisões estruturais em `docs/ADR/` e referencie-as na seção de
  decisões, em vez de reescrevê-las no DAS.
- Para o C4Arch, mantenha coerência com `docs/PRD.md`, `docs/SECURITY.md`,
  `docs/DAS-template.md` e o código real (serviços, portas, variáveis e fluxos).

## Referências

- Artigo base: <https://medium.com/@alessandro.traversi/understanding-the-solution-architecture-document-sad-with-a-lean-template-050287994a88>
- Template do projeto: `docs/DAS-template.md`
- DAS do C4Arch: `docs/DAS.md`
- Skill relacionada: `.opencode/skills/c4-model/SKILL.md`
- Geração automática: `apps/api/src/c4/das.ts`
