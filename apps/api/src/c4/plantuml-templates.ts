import type { C4ModelType } from './model-types.js';

/**
 * Padrões prontos de diagramas C4-PlantUML usados na criação de modelos.
 *
 * O conteúdo é aceito pelo importador (`plantuml-import.ts`) e cobre contexto,
 * containers, microserviços e componentes. Os modelos são criados pelo mesmo
 * endpoint de importação, sem duplicar a lógica de persistência.
 */
export interface PlantUmlTemplate {
  id: string;
  name: string;
  description: string;
  c4Type: C4ModelType;
  format: 'plantuml';
  content: string;
}

const systemContext = `@startuml
!include <C4/C4_Context>
title Contexto do sistema
Person(usuario, "Usuário", "Pessoa que utiliza o sistema")
Person(administrador, "Administrador", "Pessoa que administra o sistema")
System(sistema, "Sistema", "Sistema em desenvolvimento")
System_Ext(externo, "Sistema externo", "Serviço de terceiros")
Rel(usuario, sistema, "Utiliza")
Rel(administrador, sistema, "Administra")
Rel(sistema, externo, "Integra com", "HTTPS")
@enduml`;

const containers = `@startuml
!include <C4/C4_Container>
title Sistema e containers
Person(usuario, "Usuário", "Pessoa que utiliza o sistema")
System_Boundary(sistema, "Sistema") {
  Container(web, "Aplicação Web", "React", "Interface do usuário")
  Container(api, "API", "Node.js", "Regras de negócio")
  ContainerDb(banco, "Banco de dados", "PostgreSQL", "Persistência")
}
Rel(usuario, web, "Acessa", "HTTPS")
Rel(web, api, "Chama", "REST")
Rel(api, banco, "Lê e grava", "SQL")
@enduml`;

const microservices = `@startuml
!include <C4/C4_Container>
title Microserviços
Person(cliente, "Cliente", "Pessoa que utiliza a plataforma")
System_Boundary(plataforma, "Plataforma") {
  Container(gateway, "API Gateway", "Kong", "Entrada única da plataforma")
  Container(pedidos, "Serviço de Pedidos", "Node.js", "Ciclo de vida de pedidos")
  Container(pagamentos, "Serviço de Pagamentos", "Java", "Cobrança e conciliação")
  Container(estoque, "Serviço de Estoque", "Go", "Disponibilidade de produtos")
  ContainerQueue(fila, "Mensageria", "RabbitMQ", "Eventos assíncronos")
  ContainerDb(banco, "Banco de dados", "PostgreSQL", "Persistência")
}
Rel(cliente, gateway, "Acessa", "HTTPS")
Rel(gateway, pedidos, "Roteia", "HTTP")
Rel(gateway, pagamentos, "Roteia", "HTTP")
Rel(pedidos, fila, "Publica eventos", "AMQP")
Rel(pagamentos, fila, "Publica eventos", "AMQP")
Rel(fila, estoque, "Consome eventos", "AMQP")
Rel(pedidos, banco, "Lê e grava", "SQL")
Rel(pagamentos, banco, "Lê e grava", "SQL")
@enduml`;

const components = `@startuml
!include <C4/C4_Component>
title Containers e componentes
Person(usuario, "Usuário", "Pessoa que utiliza o sistema")
System_Boundary(sistema, "Sistema") {
  Container(web, "Aplicação Web", "React", "Interface do usuário") {
    Component(paginas, "Páginas", "React", "Telas e navegação")
    Component(estado, "Estado", "React Query", "Gerenciamento de estado")
  }
  Container(api, "API", "Node.js", "Regras de negócio") {
    Component(rotas, "Rotas", "Express", "Entrada HTTP")
    Component(servicos, "Serviços", "TypeScript", "Regras de negócio")
    Component(repositorios, "Repositórios", "Knex", "Acesso a dados")
  }
  ContainerDb(banco, "Banco de dados", "PostgreSQL", "Persistência")
}
Rel(usuario, web, "Acessa", "HTTPS")
Rel(paginas, estado, "Usa")
Rel(web, api, "Chama", "REST")
Rel(rotas, servicos, "Delega")
Rel(servicos, repositorios, "Usa")
Rel(repositorios, banco, "Lê e grava", "SQL")
@enduml`;

const blank = `@startuml
!include <C4/C4_Container>
title Novo modelo
@enduml`;

const toTemplate = (
  id: string,
  name: string,
  description: string,
  c4Type: C4ModelType,
  content: string
): PlantUmlTemplate => ({
  id,
  name,
  description,
  c4Type,
  format: 'plantuml',
  content,
});

export const PLANTUML_TEMPLATES: PlantUmlTemplate[] = [
  toTemplate(
    'system-context',
    'Contexto do sistema',
    'Pessoas, sistema principal e sistemas externos com visão de contexto.',
    'system-context',
    systemContext
  ),
  toTemplate(
    'containers',
    'Sistema e containers',
    'Aplicação web, API e banco de dados com visões de contexto e containers.',
    'container',
    containers
  ),
  toTemplate(
    'microservices',
    'Microserviços',
    'API gateway, serviços independentes, mensageria e banco, com visões de contexto, containers e fluxo dinâmico.',
    'container',
    microservices
  ),
  toTemplate(
    'components',
    'Containers e componentes',
    'Componentes internos da web e da API, com visões de contexto, containers e componentes.',
    'component',
    components
  ),
  toTemplate(
    'blank',
    'Modelo em branco',
    'Modelo PlantUML vazio para modelar a arquitetura do zero.',
    'container',
    blank
  ),
];
