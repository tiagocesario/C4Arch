---
name: Docker
description: Use ao escrever Dockerfiles, imagens, docker compose, volumes, redes, segurança e troubleshooting de containers, com base na documentação oficial do Docker.
---

# Docker

Skill para construir, executar e operar containers com Docker. Fonte:
<https://docs.docker.com/>.

## Quando usar

- Escrever ou revisar um `Dockerfile`.
- Criar ou ajustar um `compose.yaml` para desenvolvimento local ou CI.
- Escolher imagem base, estratégia de build, cache e multi-stage.
- Decidir entre volume, bind mount e tmpfs.
- Configurar rede entre containers e publicação de portas.
- Endurecer containers (usuário, capabilities, segredos).
- Diagnosticar containers que não sobem, não persistem dados ou não se comunicam.

## Princípios

1. **Uma responsabilidade por container.** Separe aplicação, banco e cache em
   imagens distintas; escale e reutilize cada uma de forma independente.
2. **Containers efêmeros.** O container pode ser destruído e recriado a qualquer
   momento. Estado fica em volumes ou serviços externos, nunca na camada
   gravável.
3. **Imagem imutável.** Build gera artefato versionado; configuração entra por
   variáveis de ambiente, arquivos montados ou secrets, não por edição manual.
4. **Menor superfície possível.** Imagem base mínima e confiável, sem pacotes
   desnecessários, rodando como não-root.
5. **Cache é contrato.** Ordem das instruções define o cache; dependências antes
   do código-fonte.
6. **Reprodutibilidade.** Versões fixadas (tag + digest quando crítico) e build
   repetível em CI.

## Fluxo de trabalho

1. **Entenda a aplicação**: linguagem, dependências de build, porta, arquivos
   mutáveis, variáveis de configuração, healthcheck.
2. **Escolha a imagem base** oficial/verificada, mínima e compatível.
3. **Escreva o `Dockerfile`** com multi-stage: estágio de build e estágio final
   enxuto.
4. **Crie `.dockerignore`** para tirar do contexto o que não entra no build
   (`.git`, `node_modules`, `dist`, testes, segredos).
5. **Build e execute** localmente; valide porta, healthcheck e persistência.
6. **Componha** com `compose.yaml` quando houver mais de um serviço.
7. **Verifique segurança**: non-root, capabilities, segredos, scan de imagem.
8. **Automatize** build, teste e publicação em CI.

## Dockerfile: regras por instrução

| Instrução | Regra prática |
| --- | --- |
| `# syntax` | Declare `# syntax=docker/dockerfile:1` para recursos modernos. |
| `FROM` | Use imagem oficial, pequena e versionada; `AS` para nomear estágios. |
| `ARG` | Só para valores de build; não use para segredos. |
| `ENV` | Configuração em runtime; não coloque segredos (ficam na imagem). |
| `WORKDIR` | Sempre caminho absoluto; evite `RUN cd ...`. |
| `COPY` | Preferido para copiar do contexto; `--chown` para ownership. |
| `ADD` | Só quando precisar de URL/tar automático; prefira `COPY`. |
| `RUN` | Combine comandos com `&&`, limpe caches na mesma camada. |
| `USER` | Troque para usuário sem privilégios antes do `CMD`. |
| `EXPOSE` | Documenta a porta; não publica nada sozinho. |
| `VOLUME` | Declare diretórios mutáveis/gerenciáveis. |
| `HEALTHCHECK` | Defina checagem real de disponibilidade. |
| `ENTRYPOINT` | Comando principal da imagem (formato exec). |
| `CMD` | Argumentos padrão; formato exec `["executavel", "arg"]`. |

Regras adicionais:

- **`apt-get`**: sempre `apt-get update && apt-get install -y
  --no-install-recommends ... && rm -rf /var/lib/apt/lists/*` na mesma camada.
- **Cache**: copie primeiro os arquivos de dependências (`package.json`,
  `requirements.txt`, `go.mod`) e instale; só depois copie o código.
- **Pipes**: use `set -o pipefail` quando o sucesso do primeiro comando importa.
- **Sinais**: use formato exec e `exec "$@"` em entrypoints para o processo ser
  PID 1 e receber sinais.
- **Não instale** editores, ferramentas de debug ou `sudo` na imagem final.

## Padrão multi-stage

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/server.js"]
```

Build:

```console
docker build --pull -t minha-app:1.0.0 .
docker build --pull --no-cache -t minha-app:1.0.0 .
```

`--pull` atualiza a imagem base; `--no-cache` reexecuta todas as camadas.
Use ambos quando quiser um build realmente limpo.

## Docker Compose

Um arquivo Compose declara `services` (mapa nome → definição). Cada serviço é
definido por imagem e argumentos de runtime; containers do mesmo serviço são
idênticos.

Chaves essenciais:

| Chave | Uso |
| --- | --- |
| `image` | Imagem no formato `[registry/][projeto/]imagem[:tag\|@digest]`. |
| `build` | Contexto, `dockerfile`, `target`, `args`. |
| `ports` | Publica no host (`"8080:80"`); prefira `127.0.0.1:8080:80` localmente. |
| `expose` | Porta visível só na rede interna; não publica no host. |
| `environment` / `env_file` | Configuração; `environment` tem precedência. |
| `volumes` | Named volume ou bind mount. |
| `depends_on` | Ordem de start/stop; com `condition: service_healthy` espera healthcheck. |
| `healthcheck` | `test`, `interval`, `timeout`, `retries`, `start_period`. |
| `networks` | Segmentação e aliases DNS. |
| `restart` | `no`, `always`, `on-failure`, `unless-stopped`. |
| `deploy.resources` | Limites e reservas de CPU/memória. |
| `secrets` / `configs` | Conteúdo sensível ou de configuração fora da imagem. |
| `profiles` | Sobe serviços opcionais sob demanda. |
| `init` | PID 1 que encaminha sinais e recoleta processos. |

Exemplo:

```yaml
services:
  api:
    build:
      context: ./apps/api
      target: runtime
    environment:
      DATABASE_URL: postgres://app:app@db:5432/app
    ports:
      - "127.0.0.1:4000:4000"
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4000/health"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 20s
    restart: unless-stopped

  db:
    image: postgres:18
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  db-data:
```

Comandos:

```console
docker compose up -d --build
docker compose ps
docker compose logs -f api
docker compose exec api sh
docker compose down
docker compose down -v   # remove também os volumes
```

## Armazenamento

- **Volume nomeado**: mecanismo preferido para dados persistentes; gerenciado
  pelo Docker, independente do SO do host, fácil de backup/migrar e compartilhar.
- **Bind mount**: monta um caminho do host; útil em desenvolvimento (hot reload)
  e para arquivos de configuração. Depende da estrutura do host.
- **tmpfs**: memória; dados efêmeros e sensíveis, somem ao parar o container.

```console
docker volume create dados
docker run -v dados:/var/lib/app minha-app
docker run --mount type=bind,source=./conf,target=/etc/app/conf,read_only minha-app
```

## Redes

- Todo container entra em uma rede; por padrão, na `bridge` padrão.
- Na bridge padrão não há DNS por nome de serviço. Em **rede definida pelo
  usuário**, containers se resolvem pelo nome do serviço.
- Drivers principais: `bridge` (host único), `overlay` (multi-host/Swarm),
  `host` (sem isolamento de rede), `none` (sem rede), `macvlan`/`ipvlan`.
- Publicar portas expõe o serviço; manter em `127.0.0.1` evita exposição na LAN.

```console
docker network create app-net
docker run --network app-net --name api minha-app
docker run --network app-net curlimages/curl http://api:3000/health
```

## Segurança

- Rode como **usuário não-root** (`USER`) e com UID/GID explícitos.
- Remova capabilities e evite `--privileged`:

```console
docker run --cap-drop=ALL --cap-add=NET_BIND_SERVICE \
  --security-opt=no-new-privileges --read-only --tmpfs /tmp minha-app
```

- **Nunca** embuta segredos em `ENV`, `ARG` ou na imagem. Use secrets do Compose,
  Docker Swarm secrets ou um cofre externo.
- Prefira imagens oficiais/verificadas e fixe versão; para supply chain, fixe
  digest (`imagem:tag@sha256:...`).
- Rebuild periódico com `--pull` para receber patches; rode scan de
  vulnerabilidades (Docker Scout ou equivalente) no CI.
- Monte o socket do Docker (`/var/run/docker.sock`) apenas quando indispensável:
  quem monta o socket tem efetivamente controle do host.
- Use `read_only`, `tmpfs` para diretórios temporários e limites de CPU/memória.

## Diagnóstico

```console
docker ps -a
docker logs --tail 200 -f <container>
docker inspect <container>
docker exec -it <container> sh
docker stats
docker system df
docker image history <imagem>
docker compose config
```

| Sintoma | Verifique |
| --- | --- |
| Container sai imediatamente | `CMD`/`ENTRYPOINT`, logs, exit code, falta de dependência. |
| `port is already allocated` | Porta ocupada no host; `docker ps` e `netstat`. |
| Dados somem ao recriar | Falta volume nomeado no caminho correto. |
| Container não resolve outro | Redes diferentes ou bridge padrão; use rede definida. |
| Imagem enorme | Multi-stage, `.dockerignore`, cache de pacotes não limpo. |
| Build não atualiza | Cache: use `--no-cache`, reordene `COPY`, ou `--pull`. |
| Permissão negada em volume | UID/GID do `USER` vs ownership do volume. |

## Erros comuns

- Copiar o projeto inteiro antes de instalar dependências (quebra cache).
- Usar `latest` em produção sem política de atualização.
- Rodar como root por conveniência.
- Colocar senha em `ENV` ou no `compose.yaml` versionado.
- Persistir banco na camada gravável do container.
- Usar `depends_on` simples esperando que o banco esteja pronto (use
  `condition: service_healthy`).
- Publicar portas em `0.0.0.0` em máquina de desenvolvimento.
- Instalar `sudo`, `curl` e ferramentas de debug na imagem final.

## Referências

- `references/dockerfile.md` — instruções, multi-stage, cache e build.
- `references/compose.md` — serviços, volumes, redes, healthcheck e dependências.
- `references/seguranca-e-operacao.md` — hardening, storage, troubleshooting.

Documentação oficial: <https://docs.docker.com/>.
