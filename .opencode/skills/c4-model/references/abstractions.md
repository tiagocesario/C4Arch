# Abstrações do C4 model

Fonte: <https://c4model.com/abstractions> e páginas filhas (CC BY 4.0).

## Hierarquia

> Um **software system** é composto por um ou mais **containers** (aplicações e
> data stores), cada um contendo um ou mais **components**, que por sua vez são
> implementados por um ou mais **code elements** (classes, interfaces, objetos,
> funções etc.). E **pessoas** (atores, papéis, personas) usam os software
> systems que construímos.

```text
Person
  └── usa → Software System
                └── Container (aplicação ou data store)
                        └── Component
                                └── Code element
```

## 1. Software system

- É o nível mais alto de abstração.
- Descreve algo que entrega valor a usuários, humanos ou não.
- Inclui o sistema que está sendo modelado e os sistemas externos dos quais ele
  depende (ou que dependem dele).
- É o termo mais difícil de definir; cada organização usa nomes como
  "aplicação", "produto" ou "serviço".
- Regra prática: é algo que **um time** constrói, possui, tem responsabilidade e
  consegue ver os detalhes internos. Muitas vezes o boundary do system coincide
  com o boundary do time e tudo dentro dele é implantado junto.
- **Não** são software systems: domínios de produto, bounded contexts,
  capabilities de negócio, feature teams, tribos ou squads.

## 2. Container

- **Não é Docker.** No C4, container é uma **aplicação** ou um **data store**:
  algo que precisa estar em execução para o system funcionar.
- Exemplos:
  - aplicação web server-side (Java EE/Tomcat, ASP.NET/IIS, Rails, Node.js);
  - aplicação client-side no navegador (SPA);
  - aplicativo desktop;
  - app mobile;
  - aplicação console/batch;
  - serverless function;
  - banco de dados/esquema (MySQL, SQL Server, MongoDB, Neo4j etc.);
  - blob/content store (S3, Azure Blob, CDN);
  - file system ou parte dele;
  - shell script.
- É um **runtime boundary** em torno de código em execução ou dados armazenados.
  O nome não implica a natureza física da execução.
- Um servidor de aplicação pode rodar vários containers C4 no mesmo processo/JVM;
  cada aplicação web é um container, e o deployment é uma preocupação separada.
- **Web app: um ou dois containers?**
  - Se o server-side gera predominantemente HTML estático, é um container.
  - Se há uma quantidade significativa de JavaScript entregue pelo servidor
    (ex.: SPA), são **dois containers** (client e server), pois são dois process
    spaces comunicando por JSON/HTTPS. Isso também permite detalhar cada um.
- **JAR, DLL, assembly, módulo**: normalmente **não** são containers; são
  unidades de organização de código dentro de uma aplicação.
- **Serviços gerenciados de dados** (S3, RDS, Azure SQL, CDN): trate como
  **containers** quando você tem ownership/responsabilidade sobre os buckets,
  esquemas etc., mesmo que o provedor hospede o serviço.

## 3. Component

- Agrupamento de funcionalidade relacionada encapsulada atrás de uma interface
  bem definida.
- Em Java/C#, é uma coleção de classes de implementação atrás de uma interface.
- **Components não são unidades implantáveis.** Quem é implantável é o container;
  todos os components de um container executam no mesmo process space.
- Como agrupar código em components varia por codebase, mas normalmente segue
  camadas, features ou uma arquitetura hexagonal/ports-and-adapters.
- Em linguagens OO, components são implementados por classes/interfaces; em
  procedurais, por arquivos/diretórios; em JavaScript, por módulos; em
  funcionais, por módulos de funções e tipos.
- **JAR, DLL, módulo, package, namespace ou pasta**: talvez sejam components,
  mas normalmente não. O C4 mostra unidades de runtime (containers) e como a
  funcionalidade é particionada (components), não unidades organizacionais.
- Pode haver mapeamento 1:1 entre um component e um JAR/DLL; um component também
  pode usar código de vários JARs, incluindo bibliotecas de terceiros.

## 4. Code

- Components são feitos de code elements: classes, interfaces, enums, funções,
  objetos etc.
- O code diagram é opcional e normalmente gerado sob demanda por IDE/ferramenta.
- Mostre apenas atributos e métodos que contam a história; não documente todo o
  código.
- Não é recomendado para documentação de longa duração, exceto para components
  mais importantes ou complexos.
