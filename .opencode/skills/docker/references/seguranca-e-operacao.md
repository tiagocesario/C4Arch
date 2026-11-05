# Segurança, armazenamento e operação

Fonte: <https://docs.docker.com/engine/security/>,
<https://docs.docker.com/engine/storage/volumes/> e
<https://docs.docker.com/engine/network/>.

## Modelo de isolamento

Containers compartilham o kernel do host. O isolamento vem de namespaces
(processos, rede, mounts, IPC, UTS, user) e cgroups (CPU, memória, I/O). Não é
uma barreira de segurança equivalente a uma VM: o kernel é compartilhado.

Quatro áreas de risco:

1. Kernel e suporte a namespaces/cgroups.
2. Superfície de ataque do daemon Docker.
3. Configuração do container (privileged, capabilities, mounts).
4. Recursos de hardening do kernel.

## Hardening de container

```console
docker run \
  --user 10001:10001 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop=ALL \
  --cap-add=NET_BIND_SERVICE \
  --security-opt=no-new-privileges \
  --memory 512m --cpus 1.0 \
  --pids-limit 256 \
  minha-app:1.0.0
```

Checklist:

- [ ] Imagem roda como não-root (`USER`).
- [ ] `--privileged` não é usado.
- [ ] Capabilities reduzidas ao necessário.
- [ ] `no-new-privileges` habilitado.
- [ ] Root filesystem `read_only` quando possível.
- [ ] Limites de memória/CPU/PIDs definidos.
- [ ] Sem montar `/var/run/docker.sock` (quem monta controla o host).
- [ ] Sem `--network host` sem justificativa.
- [ ] Segredos fora de `ENV`/`ARG`/imagem.
- [ ] Imagem escaneada e base atualizada.

### Usuário e permissões

```dockerfile
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --no-log-init --create-home app
USER 10001:10001
```

- UID/GID explícitos evitam surpresa em volumes.
- Em bind mount, o ownership do host precisa permitir o UID do container.
- Evite `sudo`; use `gosu`/`su-exec` apenas quando precisar trocar de usuário
  após inicializar como root.

### Capabilities

O Docker concede um conjunto padrão. Remova todas e adicione só o necessário:

```yaml
cap_drop:
  - ALL
cap_add:
  - NET_BIND_SERVICE
```

### Segredos

Formas aceitáveis:

- Docker secrets (Swarm/Compose) montados como arquivo.
- Variável de ambiente injetada em runtime por um cofre (não no `Dockerfile`).
- Arquivo montado com permissão restrita.

Formas inadequadas:

- `ENV PASSWORD=...` (fica no histórico e em `docker inspect`).
- `ARG` para segredo (aparece no build history).
- Copiar `.env` para dentro da imagem.
- Segredo em `compose.yaml` versionado.

### Supply chain

- Prefira imagens oficiais e verificadas.
- Fixe tag e, quando necessário, digest.
- Rebuild periódico com `--pull`.
- Rode scan (Docker Scout ou equivalente) no CI.
- Gere SBOM/proveniência quando o processo exigir.
- Assine e verifique imagens em ambientes críticos.

## Armazenamento

### Comparativo

| Tipo | Onde vive | Uso típico | Backup |
| --- | --- | --- | --- |
| Named volume | Área gerenciada pelo Docker | Dados de banco, uploads, estado | `docker run --volumes-from` ou cópia |
| Bind mount | Caminho do host | Código em dev, configuração | Ferramenta do host |
| tmpfs | Memória | Cache, arquivos temporários e sensíveis | Não se aplica |

### Volumes

```console
docker volume create app-data
docker volume ls
docker volume inspect app-data
docker run -v app-data:/var/lib/app minha-app
docker run --rm -v app-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/app-data.tgz -C /data .
```

- Volumes são o mecanismo preferido para persistência.
- Podem ser compartilhados com segurança entre containers.
- São independentes do SO do host.
- Novos volumes podem ser pré-populados a partir da imagem.

### Bind mounts

```console
docker run --mount type=bind,source="$(pwd)"/conf,target=/etc/app,read_only minha-app
```

- Dependem da estrutura do host.
- Use `read_only` para configuração.
- Cuidado ao montar diretórios amplos (`/`, home, socket).
- Em Docker Desktop (Windows/macOS), performance pode ser pior que volume.

### tmpfs

```console
docker run --tmpfs /tmp:rw,noexec,nosuid,size=64m minha-app
```

Some ao parar o container; bom para segredos temporários e caches.

## Redes

### Drivers

| Driver | Escopo | Quando usar |
| --- | --- | --- |
| `bridge` | Host único | Padrão; rede isolada no host. |
| `overlay` | Multi-host | Swarm/multi-host. |
| `host` | Host único | Sem isolamento; alto desempenho, casos específicos. |
| `none` | — | Container sem rede. |
| `macvlan` | Host único | IP na rede física. |
| `ipvlan` | Host único | Controle fino de L2/L3. |

### Bridge padrão vs rede definida

- Bridge padrão (`docker0`): sem DNS por nome; comunicação por IP ou `--link`
  (legado).
- Rede definida pelo usuário: DNS embutido, resolve nome do container/serviço e
  aliases; melhor isolamento entre projetos.

```console
docker network create --driver bridge app-net
docker run -d --name db --network app-net postgres:18
docker run --rm --network app-net curlimages/curl http://db:5432
```

### Publicação de portas

```console
docker run -p 127.0.0.1:8080:80 nginx
docker run -p 8080:80 nginx          # todas as interfaces
docker run -P nginx                  # portas aleatórias do host
```

`-p 127.0.0.1:...` restringe ao loopback — recomendado em desenvolvimento.

### DNS e aliases

- Nome do container/serviço resolve na rede definida.
- `--network-alias` adiciona nomes.
- Containers em redes diferentes não se enxergam.
- `--dns`, `--dns-search`, `--add-host` para ajustes.

## Operação

### Recursos

```console
docker run --memory 512m --memory-swap 1g --cpus 1.5 --pids-limit 256 minha-app
```

- Sem limite, um container pode consumir o host.
- `--memory-swap` só faz sentido com `--memory`.
- `--pids-limit` mitiga fork bombs.

### Logs

- Drivers: `json-file`, `local`, `syslog`, `journald`, `gelf`, `fluentd`, etc.
- Configure rotação:

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

- Aplicação deve logar em `stdout`/`stderr`; não gerencie arquivos de log dentro
  do container.

### Healthcheck

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1
```

- Use endpoint real de saúde, não apenas `ps`.
- `start_period` cobre inicialização lenta.
- Estados: `starting`, `healthy`, `unhealthy`.

### Limpeza

```console
docker system df
docker system prune
docker system prune -a --volumes   # destrutivo: remove imagens e volumes não usados
docker image prune -a
docker volume prune
docker builder prune
```

Nunca rode `prune --volumes` sem confirmar que nenhum dado precisa persistir.

## Troubleshooting

| Sintoma | Comandos | Causa provável |
| --- | --- | --- |
| Container encerra | `docker logs`, `docker inspect -f '{{.State.ExitCode}}'` | Comando inválido, dependência ausente, crash |
| `port is already allocated` | `docker ps`, `netstat -ano` | Porta ocupada no host |
| `permission denied` em volume | `docker exec id`, `ls -ln` | UID/GID divergente |
| Não resolve outro serviço | `docker network inspect` | Redes diferentes / bridge padrão |
| Imagem grande | `docker image history` | Falta multi-stage ou limpeza de cache |
| Build usa cache antigo | `docker build --no-cache --pull` | Camada inalterada |
| Container unhealthy | `docker inspect --format '{{json .State.Health}}'` | Healthcheck mal configurado ou app lenta |
| Alto uso de disco | `docker system df -v` | Imagens, volumes e build cache acumulados |

Comandos de diagnóstico:

```console
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker inspect <container>
docker stats --no-stream
docker exec -it <container> sh
docker cp <container>:/caminho ./local
docker events --filter container=<container>
```

## Riscos residuais

- Kernel compartilhado: escape de container é possível com vulnerabilidade de
  kernel ou configuração permissiva.
- Daemon Docker é root no host: proteja o socket e considere rootless.
- Imagens sem rebuild acumulam CVEs.
- Segredos em env podem vazar em logs, crash dumps e `inspect`.
- Rate limit, backup e monitoramento não são responsabilidade do Docker.
