# Tipos de diagrama C4

Fonte: <https://c4model.com/diagrams> (CC BY 4.0).

## Visão geral

**Diagramas de estrutura estática** (os 4 níveis clássicos):

1. System Context
2. Container
3. Component
4. Code

**Diagramas de apoio:**

5. System Landscape
6. Dynamic
7. Deployment

Os níveis de zoom permitem contar histórias diferentes para públicos diferentes.
**Não é obrigatório usar os 4 níveis.** Use apenas os que agregam valor; para a
maioria dos times, System Context e Container são suficientes.

---

## 1. System Context diagram

**Objetivo:** ponto de partida; mostrar o sistema como uma caixa central,
cercado por seus usuários e pelos outros sistemas com que interage.

- **Escopo:** um único software system.
- **Elementos principais:** o software system em escopo.
- **Elementos de apoio:** pessoas (usuários, atores, papéis, personas) e
  software systems externos diretamente conectados ao system em escopo.
  Normalmente esses sistemas estão fora do boundary e não são de sua
  responsabilidade/ownership.
- **Público:** todos, técnicos e não técnicos, dentro e fora do time.
- **Recomendado:** sim, para todos os times.
- **Foco:** pessoas e software systems, não tecnologias, protocolos ou detalhes
  de baixo nível. É o diagrama que você mostraria para pessoas não técnicas.

Evite: componentes, bancos, filas, protocolos e infraestrutura.

---

## 2. Container diagram

**Objetivo:** zoom no boundary do system para mostrar a forma de alto nível da
arquitetura, a distribuição de responsabilidades, as principais escolhas de
tecnologia e como os containers se comunicam.

- **Escopo:** um único software system.
- **Elementos principais:** containers dentro do system em escopo (aplicações e
  data stores).
- **Elementos de apoio:** pessoas e software systems diretamente conectados aos
  containers.
- **Público:** pessoas técnicas, incluindo arquitetos, devs e operações/suporte.
- **Recomendado:** sim, para todos os times.
- **Nota:** diz muito pouco sobre deployment (clustering, load balancer,
  replicação, failover), pois isso varia por ambiente. Use deployment diagrams
  separados, um por ambiente.

Evite: detalhar components, classes ou infraestrutura de deployment.

---

## 3. Component diagram

**Objetivo:** decompor um container para mostrar os components, suas
responsabilidades e detalhes de tecnologia/implementação.

- **Escopo:** um único container.
- **Elementos principais:** components dentro do container em escopo.
- **Elementos de apoio:** containers (do system em escopo) e pessoas/sistemas
  diretamente conectados aos components.
- **Público:** arquitetos e desenvolvedores.
- **Recomendado:** não. Crie apenas se agregar valor e considere automatizar a
  geração para documentação de longa duração.

Evite: mostrar classes ou misturar vários containers no mesmo diagrama.

---

## 4. Code diagram

**Objetivo:** zoom em um component para mostrar como ele é implementado como
código (UML class diagram, ER diagram ou similar).

- **Escopo:** um único component.
- **Elementos principais:** code elements (classes, interfaces, objetos, funções,
  tabelas de banco etc.) dentro do component em escopo.
- **Público:** arquitetos e desenvolvedores.
- **Recomendado:** não. Idealmente gerado automaticamente por IDE/ferramenta e
  apenas para components mais importantes ou complexos.
- **Nota:** é um nível muito opcional e normalmente disponível sob demanda.

Evite: documentar todos os atributos/métodos; mostre só o que conta a história.

---

## 5. System Landscape diagram

**Objetivo:** mostrar como vários software systems se encaixam em uma empresa,
organização ou departamento. É, na prática, um system context sem foco em um
system específico.

- **Escopo:** empresa/organização/departamento etc.
- **Elementos principais:** pessoas e software systems relacionados ao escopo.
- **Público:** técnicos e não técnicos, dentro e fora do time.
- **Recomendado:** sim, especialmente para organizações grandes; é a ponte para
  o mundo de enterprise architecture.
- **Nota:** fornece um mapa dos systems, com um conjunto de diagramas de
  context/container/component/code para cada system de interesse.

---

## 6. Dynamic diagram

**Objetivo:** mostrar como elementos do modelo estático colaboram em runtime para
implementar uma user story, caso de uso ou feature.

- **Base:** UML communication diagram (antigo collaboration diagram); também pode
  ser no estilo sequence diagram.
- **Escopo:** uma feature, story, caso de uso etc.
- **Elementos principais e de apoio:** à escolha; pode mostrar software systems,
  containers ou components interagindo em runtime.
- **Público:** técnicos e não técnicos, dentro e fora do time.
- **Recomendado:** não; use com moderação para padrões/features recorrentes ou
  interações complicadas.
- **Nota:** collaboration e sequence mostram a mesma informação de formas
  diferentes; use a que preferir. Numere as interações para indicar a ordem.

---

## 7. Deployment diagram

**Objetivo:** mostrar como instâncias de software systems e/ou containers são
implantadas na infraestrutura de um ambiente (produção, staging, desenvolvimento
etc.).

- **Base:** UML deployment diagram.
- **Escopo:** um ou mais software systems dentro de um único ambiente de
  deployment.
- **Elementos principais e de apoio:** deployment nodes, instâncias de software
  systems e de containers.
- **Elementos de apoio:** infrastructure nodes (DNS, load balancers, firewalls).
- **Público:** pessoas técnicas, incluindo arquitetos, devs, arquitetos de
  infraestrutura e operações/suporte.
- **Recomendado:** sim.
- **Nota:** um **deployment node** é onde uma instância roda: servidor físico,
  dispositivo, IaaS/PaaS/VM, container Docker, execution environment (banco,
  Java EE/IIS) etc. Deployment nodes podem ser aninhados. Ícones de AWS, Azure
  etc. são bem-vindos, desde que estejam na legenda.

Evite: usar deployment diagram para substituir o container diagram; são visões
diferentes.

---

## Notação (recomendações gerais)

O C4 é **notation independent** e não prescreve notação, mas o diagrama precisa
ser compreensível sozinho.

### Diagramas

- Todo diagrama deve ter **título** descrevendo tipo e escopo
  (ex.: "System Context diagram for My Software System").
- Todo diagrama deve ter **key/legend** explicando formas, cores, bordas, linhas
  e pontas de seta.
- Siglas e abreviações de negócio/tecnologia devem ser compreensíveis por todos
  ou explicadas na legenda.

### Elementos

- O **tipo** de cada elemento deve ser explícito (Person, Software System,
  Container, Component).
- Todo elemento deve ter **nome** e **descrição curta**.
- Todo container e component deve ter **tecnologia** explícita.

### Relações

- Cada linha representa uma relação **unidirecional**.
- Toda linha deve ter **rótulo** consistente com a direção e a intenção
  (dependência ou fluxo de dados). Evite palavras genéricas como "Usa".
- Relações entre containers (comunicação inter-processo) devem ter
  **tecnologia/protocolo** explícitos.

### Cores

- O C4 **não** exige azul/cinza. Use as cores que quiser, mas mantenha a
  codificação consistente dentro e entre diagramas.
- Cuidado com impressão P&B, daltonismo e contraste.

### Legenda

Toda notação deve ser o mais autoexplicativa possível, mas a legenda é
obrigatória, inclusive para UML, ArchiMate e SysML.

### Alternativas

Não é obrigatório usar "caixas e setas". Visualizações interativas (grafos,
diagramas exploráveis) podem representar as mesmas abstrações.
