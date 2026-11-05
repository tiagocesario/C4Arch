# Dockerfile e build

Fonte: <https://docs.docker.com/reference/dockerfile/>,
<https://docs.docker.com/build/building/best-practices/> e
<https://docs.docker.com/build/building/multi-stage/>.

## Modelo mental

Uma imagem é uma sequência de camadas somente leitura. Cada instrução que muda o
filesystem cria uma camada. Container é uma camada gravável sobre a imagem. O
build percorre as instruções em ordem e reutiliza camadas em cache quando a
instrução e o contexto de entrada não mudaram.

Consequências práticas:

- Ordem importa: instruções estáveis primeiro, voláteis depois.
- O que entra em uma camada fica nela; apagar em camada seguinte não reduz o
  tamanho da imagem anterior.
- O contexto de build é enviado ao daemon: use `.dockerignore`.

## Instruções

### FROM

```dockerfile
FROM node:22-alpine AS build
FROM scratch AS vazio
```

- Use imagens oficiais/verificadas e pequenas.
- Nomeie estágios com `AS` para copiar entre eles.
- `scratch` para binários estáticos.
- Uma imagem pode ter múltiplos `FROM` (multi-stage).

### ARG e ENV

```dockerfile
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine
ENV NODE_ENV=production
```

- `ARG` existe só durante o build; `ENV` persiste na imagem e no container.
- `ARG` não é secreto: aparece no histórico da imagem.
- Evite `ENV` para credenciais.

### WORKDIR

```dockerfile
WORKDIR /app
```

Sempre absoluto, criado se não existir. Substitui `RUN cd ...`.

### COPY e ADD

```dockerfile
COPY package*.json ./
COPY --chown=node:node --from=build /app/dist ./dist
ADD --checksum=sha256:... https://exemplo/artifact.tar.gz /tmp/
```

- `COPY` é o padrão para arquivos locais e entre estágios.
- `ADD` só quando precisar de URL remota ou extração automática de tar.
- `--chown` evita `chown -R` em camada extra.
- Para dependências de build temporárias, prefira
  `RUN --mount=type=bind,source=...,target=...`.

### RUN

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*
```

- Combine `update` e `install` na mesma instrução (cache busting).
- Limpe caches na mesma camada (`/var/lib/apt/lists`, `npm cache`, `pip cache`).
- Use `set -o pipefail` em pipes cujo primeiro comando pode falhar.
- Ordenar argumentos multilinha facilita revisão e evita duplicatas.
- `RUN <<EOF` (heredoc) disponível com BuildKit.

### ENTRYPOINT e CMD

```dockerfile
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["postgres"]
```

- `ENTRYPOINT` define o executável; `CMD` define argumentos padrão.
- Prefira formato exec (`["a","b"]`) ao shell form.
- Use `exec "$@"` no entrypoint para o processo virar PID 1 e receber sinais.
- `CMD` sozinho é sobrescrito por argumentos de `docker run`.

### EXPOSE, VOLUME, USER, HEALTHCHECK

```dockerfile
EXPOSE 8080
VOLUME ["/var/lib/app"]
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1
```

- `EXPOSE` documenta; `-p` publica.
- `VOLUME` marca dados mutáveis (mas não substitui um volume nomeado no run).
- `USER` reduz privilégios; crie o usuário com UID/GID explícitos.
- `HEALTHCHECK` alimenta `healthy`/`unhealthy` e `depends_on: service_healthy`.

### LABEL

```dockerfile
LABEL org.opencontainers.image.source="https://github.com/org/repo" \
      org.opencontainers.image.version="1.0.0"
```

Metadados para rastreabilidade, licença e automação.

## Multi-stage

Objetivo: separar build de runtime e levar só o necessário para a imagem final.

```dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/app ./cmd/app

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app"]
```

Padrões úteis:

- **Estágio reutilizável**: base comum para várias imagens; o Docker constrói
  uma vez.
- **Build paralelo**: estágios independentes podem rodar em paralelo.
- **Target**: `docker build --target build .` para parar em um estágio (útil em
  testes e debug).
- **Cache mounts**: `RUN --mount=type=cache,target=/root/.npm npm ci` para cache
  de gerenciador de pacotes entre builds.

## Cache

O cache é invalidado quando muda a instrução ou o conteúdo copiado. Estratégia:

```dockerfile
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
```

- Só o código-fonte muda com frequência; dependências ficam em cache.
- `.dockerignore` reduz o contexto e evita invalidação desnecessária.
- `--no-cache` ignora o cache; `--pull` busca imagem base nova.
- BuildKit: `docker buildx build` habilita cache export/import entre CI e local.

## .dockerignore

```text
.git
.gitignore
node_modules
dist
coverage
*.log
.env
.env.*
Dockerfile*
compose*.yaml
```

Mantenha arquivos necessários ao build. Segredos nunca devem entrar no contexto.

## Build e inspeção

```console
docker build -t app:1.0.0 .
docker build --pull --no-cache -t app:1.0.0 .
docker build --target build -t app:build .
docker buildx build --platform linux/amd64,linux/arm64 -t app:1.0.0 --push .
docker image history app:1.0.0
docker image inspect app:1.0.0
docker scout cves app:1.0.0
```

## Antipadrões

- `COPY . .` antes de instalar dependências.
- Várias instruções `RUN apt-get update` separadas.
- Baixar binário com `wget` sem checksum quando `ADD --checksum` resolve.
- Deixar ferramentas de build na imagem final.
- `USER root` no fim ou ausência de `USER`.
- Tags móveis em produção sem rebuild/scan.
