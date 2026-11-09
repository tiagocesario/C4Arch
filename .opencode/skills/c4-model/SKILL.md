---
name: C4 Model
description: Use ao criar, revisar ou explicar diagramas C4 (contexto, container, componente, código, landscape, dinâmico e deployment) e ao modelar arquitetura no C4Arch.
---

# C4 Model

Skill para modelar, desenhar e revisar arquitetura de software usando o C4 model
de Simon Brown. Fonte: <https://c4model.com/diagrams> (CC BY 4.0).

## Quando usar

- Criar ou revisar diagramas C4.
- Decidir qual nível C4 usar para um determinado público ou decisão.
- Explicar conceitos do C4 model (software system, container, component, code).
- Modelar elementos e relações no C4Arch.
- Revisar se um diagrama está completo, legível e consistente.

## Princípios

1. **Abstraction-first**: pessoas usam software systems; um software system é
   composto por containers (aplicações e data stores); containers contêm
   components; components são implementados por code elements.
2. **Notation independent**: o C4 não prescreve notação. Use caixas e linhas,
   UML, ArchiMate etc., desde que a notação seja clara e tenha legenda.
3. **Tooling independent**: o modelo é mais importante que a ferramenta.
4. **Não use os 4 níveis por obrigação**. Use apenas os níveis que agregam valor.
   Para a maioria dos times, **System Context + Container** já bastam.
5. **Um diagrama, um escopo**. Não misture níveis de abstração no mesmo desenho.
6. Todo diagrama deve ter **título**, **tipo**, **escopo** e **legenda/key**.

## Fluxo de trabalho

1. **Defina escopo e público.**
   - Qual software system, container, componente ou ambiente está em foco?
   - Quem vai ler: não técnicos, desenvolvedores, operações?
2. **Escolha o tipo de diagrama** usando a tabela abaixo.
3. **Inventarie os elementos daquele nível**, sem descer ou subir de nível.
   - Dê nome, tipo e uma descrição curta para cada elemento.
   - Em containers e components, informe a tecnologia.
4. **Modele as relações.**
   - Uma seta por relação, sempre unidirecional.
   - Rotule com a intenção/direção (evite "usa").
   - Em relações entre containers, informe protocolo/tecnologia.
5. **Adicione título e legenda** explicando formas, cores, setas e siglas.
6. **Revise** com `references/review-checklist.md`.
7. **No C4Arch**, mapeie os elementos e relações para os tipos suportados.

## Escolha do diagrama

| Diagrama | Escopo | Elementos principais | Público | Recomendado? |
| --- | --- | --- | --- | --- |
| System Context | Um software system | O system em foco | Todos, técnicos e não técnicos | Sim |
| Container | Um software system | Containers (apps e data stores) | Arquitetos, devs, operações | Sim |
| Component | Um container | Components | Arquitetos e devs | Só se agregar valor |
| Code | Um component | Classes, interfaces, tabelas etc. | Arquitetos e devs | Não; prefira gerar sob demanda |
| System Landscape | Empresa/org./departamento | People e software systems | Técnicos e não técnicos | Sim, especialmente em organizações grandes |
| Dynamic | Uma feature/caso de uso | Systems, containers ou components em runtime | Técnicos e não técnicos | Usar com moderação |
| Deployment | Um ambiente de deployment | Deployment nodes, instâncias de systems/containers | Arquitetos, devs, infra/operações | Sim |

Detalhes de escopo, elementos e notas: `references/diagrams.md`.

## Regras de notação

- **Elementos**: tipo explícito (Person, Software System, Container, Component),
  nome, descrição curta e tecnologia quando aplicável.
- **Relações**: uma linha por relação, unidirecional, com rótulo de intenção.
  Entre containers, inclua o protocolo (ex.: "JSON/HTTPS", "SQL", "AMQP").
- **Siglas**: explique na legenda ou no próprio elemento.
- **Cores**: livres, mas consistentes dentro e entre diagramas. Cuidado com
  impressão P&B e daltonismo.
- **Legenda**: obrigatória em todo diagrama, inclusive nos feitos com UML,
  ArchiMate ou SysML.

## Erros comuns

- Chamar container de Docker. No C4, container é aplicação ou data store.
- Misturar componentes dentro de um System Context ou infraestrutura dentro de
  um Container diagram.
- Usar todos os 4 níveis por padrão; Code diagram quase nunca é necessário.
- Rotular setas com uma única palavra ("Usa") sem dizer o quê/protocolo.
- Omitir tecnologia de containers e components.
- Tratar domínio de produto, bounded context, capability ou squad como software
  system. O boundary do system costuma ser o boundary de um time.
- Fazer um diagrama sem título, escopo ou legenda.

## Mapeamento no C4Arch

O C4Arch suporta estes `ElementType`:

| C4 | C4Arch |
| --- | --- |
| Person (actor, role, persona) | `actor` |
| Software System | `system` |
| Container (aplicação ou data store) | `container` |
| Component | `component` |
| Code element | não suportado |

Relações (`EdgeType`):

| Relação | C4Arch |
| --- | --- |
| Chamada síncrona / requisição | `call` |
| Comunicação HTTP/HTTPS | `http` |
| Mensagem assíncrona / evento | `message` |
| Dependência genérica | `depends` |

Boas práticas no C4Arch:

- Use `actor` apenas para pessoas/papéis externos; não para sistemas.
- Use `system` para o sistema em escopo e para sistemas externos.
- Use `container` para apps, serviços executáveis, bancos, buckets e filas.
- Use `component` somente dentro de um container (conceitualmente).
- Prefira `http`, `message` ou `call` a `depends` quando a natureza da relação
  for conhecida; `depends` fica para dependências genéricas.
- Escreva o rótulo da aresta com intenção + protocolo quando aplicável.
- O C4Arch não tem tipo próprio para deployment node; se precisar representar
  infraestrutura, use a descrição/metadados e não a confunda com containers.
- No editor draw.io, itens do Catálogo (aplicações e serviços) ficam disponíveis
  na biblioteca "Aplicações e Serviços" para reutilização.

## Referências

- `references/abstractions.md` — definições de software system, container,
  component e code, com os principais FAQs.
- `references/diagrams.md` — especificação de cada um dos 7 diagramas.
- `references/review-checklist.md` — checklist oficial de revisão.

Leia a referência correspondente antes de produzir ou revisar o diagrama.
