import type { C4ModelType } from './model-types.js';

/**
 * Padrões prontos de workspace Structurizr usados na criação de modelos.
 *
 * O conteúdo é DSL aceita pelo importador (`structurizr-import.ts`) e cobre
 * contexto, containers, microserviços e componentes. Os modelos são criados
 * pelo mesmo endpoint de importação, sem duplicar a lógica de persistência.
 */
export interface StructurizrTemplate {
  id: string;
  name: string;
  description: string;
  c4Type: C4ModelType;
  format: 'dsl' | 'json';
  content: string;
}

const systemContext = `workspace "Contexto do sistema" "Visão de contexto com pessoas e sistemas externos" {
  model {
    usuario = person "Usuário" "Pessoa que utiliza o sistema"
    administrador = person "Administrador" "Pessoa que administra o sistema"
    sistema = softwareSystem "Sistema" "Sistema em desenvolvimento"
    externo = softwareSystem "Sistema externo" "Serviço de terceiros"

    usuario -> sistema "Utiliza"
    administrador -> sistema "Administra"
    sistema -> externo "Integra com" "HTTPS"
  }

  views {
    systemContext sistema "Contexto do sistema" {
      include *
    }
  }
}`;

const containers = `workspace "Sistema e containers" "Contexto e containers de uma aplicação web" {
  model {
    usuario = person "Usuário" "Pessoa que utiliza o sistema"

    sistema = softwareSystem "Sistema" "Sistema em desenvolvimento" {
      web = container "Aplicação Web" "Interface do usuário" "React"
      api = container "API" "Regras de negócio" "Node.js"
      banco = container "Banco de dados" "Persistência" "PostgreSQL"
    }

    usuario -> web "Acessa" "HTTPS"
    web -> api "Chama" "REST"
    api -> banco "Lê e grava" "SQL"
  }

  views {
    systemContext sistema "Contexto do sistema" {
      include *
    }
    container sistema "Containers do sistema" {
      include *
    }
  }
}`;

const microservices = `workspace "Microserviços" "Arquitetura de referência em microserviços" {
  model {
    cliente = person "Cliente" "Pessoa que utiliza a plataforma"

    plataforma = softwareSystem "Plataforma" "Conjunto de serviços independentes" {
      gateway = container "API Gateway" "Entrada única da plataforma" "Kong"
      pedidos = container "Serviço de Pedidos" "Ciclo de vida de pedidos" "Node.js"
      pagamentos = container "Serviço de Pagamentos" "Cobrança e conciliação" "Java"
      estoque = container "Serviço de Estoque" "Disponibilidade de produtos" "Go"
      fila = container "Mensageria" "Eventos assíncronos" "RabbitMQ"
      banco = container "Banco de dados" "Persistência" "PostgreSQL"
    }

    cliente -> gateway "Acessa" "HTTPS"
    gateway -> pedidos "Roteia" "HTTP"
    gateway -> pagamentos "Roteia" "HTTP"
    pedidos -> fila "Publica eventos" "AMQP"
    pagamentos -> fila "Publica eventos" "AMQP"
    fila -> estoque "Consome eventos" "AMQP"
    pedidos -> banco "Lê e grava" "SQL"
    pagamentos -> banco "Lê e grava" "SQL"
  }

  views {
    systemContext plataforma "Contexto da plataforma" {
      include *
    }
    container plataforma "Containers da plataforma" {
      include *
    }
    dynamic plataforma "Fluxo de pedido" {
      include *
    }
  }
}`;

const components = `workspace "Containers e componentes" "Detalhamento de containers e componentes" {
  model {
    usuario = person "Usuário" "Pessoa que utiliza o sistema"

    sistema = softwareSystem "Sistema" "Sistema em desenvolvimento" {
      web = container "Aplicação Web" "Interface do usuário" "React" {
        paginas = component "Páginas" "Telas e navegação" "React"
        estado = component "Estado" "Gerenciamento de estado" "React Query"
      }
      api = container "API" "Regras de negócio" "Node.js" {
        rotas = component "Rotas" "Entrada HTTP" "Express"
        servicos = component "Serviços" "Regras de negócio" "TypeScript"
        repositorios = component "Repositórios" "Acesso a dados" "Knex"
      }
      banco = container "Banco de dados" "Persistência" "PostgreSQL"
    }

    usuario -> web "Acessa" "HTTPS"
    paginas -> estado "Usa"
    web -> api "Chama" "REST"
    rotas -> servicos "Delega"
    servicos -> repositorios "Usa"
    repositorios -> banco "Lê e grava" "SQL"
  }

  views {
    systemContext sistema "Contexto do sistema" {
      include *
    }
    container sistema "Containers do sistema" {
      include *
    }
    component api "Componentes da API" {
      include *
    }
  }
}`;

const blank = `workspace "Novo workspace" "Workspace Structurizr em branco" {
  model {
  }

  views {
  }
}`;

export const STRUCTURIZR_TEMPLATES: StructurizrTemplate[] = [
  {
    id: 'system-context',
    name: 'Contexto do sistema',
    description: 'Pessoas, sistema principal e sistemas externos com visão de contexto.',
    c4Type: 'system-context',
    format: 'dsl',
    content: systemContext,
  },
  {
    id: 'containers',
    name: 'Sistema e containers',
    description: 'Aplicação web, API e banco de dados com visões de contexto e containers.',
    c4Type: 'container',
    format: 'dsl',
    content: containers,
  },
  {
    id: 'microservices',
    name: 'Microserviços',
    description:
      'API gateway, serviços independentes, mensageria e banco, com visões de contexto, containers e fluxo dinâmico.',
    c4Type: 'container',
    format: 'dsl',
    content: microservices,
  },
  {
    id: 'components',
    name: 'Containers e componentes',
    description: 'Componentes internos da web e da API, com visões de contexto, containers e componentes.',
    c4Type: 'component',
    format: 'dsl',
    content: components,
  },
  {
    id: 'blank',
    name: 'Workspace em branco',
    description: 'Workspace Structurizr vazio para modelar a arquitetura do zero.',
    c4Type: 'container',
    format: 'dsl',
    content: blank,
  },
];

export function findStructurizrTemplate(id: string): StructurizrTemplate | null {
  return STRUCTURIZR_TEMPLATES.find((template) => template.id === id) ?? null;
}
