# Docker Compose

Fonte: <https://docs.docker.com/compose/> e
<https://docs.docker.com/reference/compose-file/services/>.

## Conceito

Compose define e executa aplicações multi-container a partir de um arquivo YAML.
Um **serviço** é a definição abstrata de um recurso que pode ser escalado ou
substituído independentemente; os containers de um serviço são criados com a
mesma imagem e os mesmos argumentos.

Estrutura mínima:

```yaml
services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
```

O elemento `services` é obrigatório. `build` e `deploy` são opcionais; se o
platform não implementar, são ignorados.

## Chaves de serviço mais usadas

### Imagem e build

```yaml
services:
  api:
    image: registry.example.com/app:1.2.3
    build:
      context: .
      dockerfile: Dockerfile
      target: runtime
      args:
        NODE_VERSION: "22"
```

- `image` aceita `[registry/][projeto/]imagem[:tag|@digest]`.
- Se `build` existe, `image` nomeia/tagueia o resultado.
- `pull_policy` controla quando buscar a imagem.

### Portas

```yaml
ports:
  - "127.0.0.1:4000:4000"   # host:container, restrito ao loopback
  - "8080:80/tcp"
expose:
  - "3000"
```

- `ports` publica no host.
- `expose` só torna a porta acessível na rede interna.
- Publicar em `0.0.0.0` expõe na rede local; em desenvolvimento, prefira
  `127.0.0.1`.

### Ambiente

```yaml
environment:
  NODE_ENV: production
  PORT: "3000"
env_file:
  - path: .env
    required: false
```

- `environment` tem precedência sobre `env_file`.
- Booleanos devem ser citados (`"true"`) para o YAML não converter.
- `.env` é usado para interpolação do próprio Compose; `env_file` injeta no
  container.

### Volumes

```yaml
services:
  db:
    image: postgres:18
    volumes:
      - db-data:/var/lib/postgresql/data
      - type: bind
        source: ./init.sql
        target: /docker-entrypoint-initdb.d/init.sql
        read_only: true

volumes:
  db-data:
```

- Named volume para persistência gerenciada pelo Docker.
- Bind mount para código/configuração do host.
- `read_only: true` para configuração.
- `docker compose down -v` remove volumes nomeados do projeto.

### Dependências

```yaml
services:
  api:
    depends_on:
      db:
        condition: service_healthy
        restart: true
      migrate:
        condition: service_completed_successfully
```

Condições:

- `service_started`: só a ordem de start.
- `service_healthy`: espera o healthcheck passar.
- `service_completed_successfully`: espera um Job (ex.: migração) terminar com
  sucesso.

Sem `condition`, o Compose garante apenas que o serviço dependente foi iniciado,
não que está pronto.

### Healthcheck

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U app -d app"]
  interval: 5s
  timeout: 5s
  retries: 10
  start_period: 20s
  start_interval: 5s
```

- `test` em lista: primeiro item `NONE`, `CMD` ou `CMD-SHELL`.
- `NONE` ou `disable: true` desliga o healthcheck herdado da imagem.
- `start_period` evita contar falhas durante a inicialização.

### Redes

```yaml
services:
  api:
    networks:
      - back
  db:
    networks:
      back:
        aliases:
          - database

networks:
  back:
    driver: bridge
```

- Sem `networks`, o serviço entra na rede `default` do projeto.
- Em rede definida pelo usuário, o nome do serviço funciona como DNS.
- `aliases` adiciona nomes alternativos; `use_service_name_alias: false` remove
  o nome do serviço como alias.
- Segmentar em `front`/`back` limita quem fala com quem.

### Recursos

```yaml
deploy:
  resources:
    limits:
      cpus: "1.5"
      memory: 512M
    reservations:
      cpus: "0.25"
      memory: 128M
```

Em Compose local, `deploy.resources` é aplicado; `mem_limit` e `cpus` são as
formas equivalentes de runtime.

### Configs e secrets

```yaml
services:
  api:
    configs:
      - source: app-config
        target: /etc/app/config.yaml
        mode: 0440
    secrets:
      - db-password

configs:
  app-config:
    file: ./config.yaml

secrets:
  db-password:
    file: ./db-password.txt
```

Secrets são montados como arquivos (por padrão em `/run/secrets/<nome>`), não
como variáveis de ambiente.

### Outros

- `restart`: `no`, `always`, `on-failure`, `unless-stopped`.
- `init: true`: PID 1 que encaminha sinais e recoleta processos.
- `profiles`: serviços opcionais (`docker compose --profile debug up`).
- `extends`: reaproveita definição de outro serviço/arquivo.
- `container_name`: fixa o nome, mas impede escala acima de 1.
- `logging`: driver e opções.
- `read_only`, `tmpfs`, `cap_drop`, `security_opt`: hardening.

## Ciclo de vida

```console
docker compose up -d --build
docker compose ps
docker compose logs -f --tail 100 api
docker compose exec api sh
docker compose restart api
docker compose pull
docker compose down
docker compose down -v
```

Ordem de criação e remoção segue `depends_on`. `up` recria apenas o que mudou.

## Exemplo completo

```yaml
name: minha-app

services:
  web:
    build:
      context: ./web
      target: runtime
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      API_URL: http://api:4000
    depends_on:
      api:
        condition: service_healthy
    networks:
      - front
    restart: unless-stopped

  api:
    build:
      context: ./api
    environment:
      DATABASE_URL: postgres://app:app@db:5432/app
      REDIS_URL: redis://cache:6379
    networks:
      - front
      - back
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4000/health"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 20s
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
    restart: unless-stopped

  db:
    image: postgres:18
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    volumes:
      - db-data:/var/lib/postgresql/data
    networks:
      - back
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 5s
      retries: 10

  cache:
    image: redis:7-alpine
    networks:
      - back

networks:
  front: {}
  back: {}

volumes:
  db-data: {}
```

## Antipadrões

- `depends_on` simples esperando banco pronto.
- Senhas em `environment` versionado.
- `network_mode: host` sem necessidade.
- Um único serviço gigante rodando vários processos.
- `container_name` quando se quer escalar.
- `down -v` em dados que deveriam persistir.
- Bind mount de `node_modules` do host sobre a imagem sem necessidade.
