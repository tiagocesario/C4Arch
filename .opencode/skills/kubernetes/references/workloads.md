# Workloads

Fonte: <https://kubernetes.io/docs/concepts/workloads/> e páginas de cada
controlador (a documentação em português cobre parte dos recursos; os conceitos
são os mesmos).

## Pod

Menor unidade implantável: um ou mais containers que compartilham rede, IPC e
volumes, agendados juntos no mesmo nó.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web
  labels:
    app.kubernetes.io/name: web
spec:
  containers:
    - name: web
      image: nginx:1.27-alpine
      ports:
        - containerPort: 80
      resources:
        requests: { cpu: 50m, memory: 64Mi }
        limits: { cpu: 200m, memory: 128Mi }
```

Características:

- Pods são efêmeros; não são recriados se o nó falha (a menos que um
  controlador os gerencie).
- Containers do mesmo Pod compartilham `localhost` e podem compartilhar volumes.
- **Init containers** rodam antes dos containers principais, em ordem, até
  concluir.
- **Sidecars** rodam em paralelo para funções auxiliares (proxy, log).
- `restartPolicy`: `Always` (padrão), `OnFailure`, `Never`.

### Ciclo de vida

Fases: `Pending` → `Running` → `Succeeded`/`Failed`. `Unknown` quando o nó não
responde.

Condições: `PodScheduled`, `Initialized`, `ContainersReady`, `Ready`.

### Qualidade de serviço (QoS)

| Classe | Condição | Comportamento sob pressão |
| --- | --- | --- |
| `Guaranteed` | requests = limits em todos os containers | Último a ser despejado |
| `Burstable` | requests < limits ou só requests | Despejado conforme uso |
| `BestEffort` | sem requests/limits | Primeiro a ser despejado |

## Deployment

Gerencia réplicas de Pods stateless e oferece rollout declarativo.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 3
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: api
    spec:
      containers:
        - name: api
          image: registry.example.com/api:1.2.3
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet: { path: /ready, port: 8080 }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /healthz, port: 8080 }
            periodSeconds: 10
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits: { cpu: 500m, memory: 256Mi }
```

Operações:

```console
kubectl rollout status deployment/api
kubectl rollout history deployment/api
kubectl rollout undo deployment/api
kubectl rollout undo deployment/api --to-revision=2
kubectl scale deployment/api --replicas=5
kubectl set image deployment/api api=registry.example.com/api:1.3.0
```

- O Deployment cria um ReplicaSet por revisão.
- `maxUnavailable: 0` + `maxSurge: 1` evita queda de capacidade no rollout.
- Falhas de readiness seguram o rollout; use `progressDeadlineSeconds`.

## ReplicaSet

Mantém um número estável de réplicas. Normalmente criado pelo Deployment; use
diretamente só em casos específicos.

## StatefulSet

Para cargas com identidade estável: bancos, filas, clusters distribuídos.

- Nomes ordinais e estáveis: `db-0`, `db-1`, `db-2`.
- Ordem de criação/remoção controlada.
- `volumeClaimTemplates` dá um PVC por réplica.
- Requer um **headless Service** (`clusterIP: None`) para identidade de rede.
- Atualizações via `RollingUpdate` ou `OnDelete`.

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: db
spec:
  serviceName: db-headless
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: db
  template:
    metadata:
      labels:
        app.kubernetes.io/name: db
    spec:
      containers:
        - name: postgres
          image: postgres:18
          ports:
            - containerPort: 5432
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 10Gi
```

## DaemonSet

Garante um Pod por nó (ou em nós selecionados). Uso típico: agentes de log,
métricas, CNI, proxy de rede.

- `spec.selector` obrigatório.
- `nodeSelector`, affinity e tolerations controlam onde roda.
- Atualizações com `RollingUpdate` (ou `OnDelete`).

## Job

Executa até a conclusão com sucesso.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: migrate
spec:
  backoffLimit: 3
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: registry.example.com/api:1.2.3
          command: ["npm", "run", "migrate"]
```

- `completions`: quantas execuções bem-sucedidas.
- `parallelism`: execuções simultâneas.
- `backoffLimit`: tentativas antes de marcar falha.
- Use `restartPolicy: Never` ou `OnFailure`.

## CronJob

Executa Jobs em agenda cron.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: backup
spec:
  schedule: "0 3 * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: registry.example.com/backup:1.0.0
```

- `schedule` no formato cron (5 campos, fuso do controlador).
- `concurrencyPolicy`: `Allow`, `Forbid`, `Replace`.
- `startingDeadlineSeconds` limita atraso aceitável.

## Probes

| Probe | Pergunta | Falha |
| --- | --- | --- |
| `startupProbe` | A aplicação terminou de iniciar? | Reinicia conforme `failureThreshold` |
| `readinessProbe` | Pode receber tráfego agora? | Remove dos endpoints do Service |
| `livenessProbe` | Está viva ou travada? | Reinicia o container |

Métodos: `httpGet`, `tcpSocket`, `exec`, `grpc`.

Boas práticas:

- Startup para apps lentas; evita liveness matar durante boot.
- Readiness deve refletir dependências necessárias para atender.
- Liveness não deve depender de banco/fila externos.
- Defina `initialDelaySeconds`, `periodSeconds`, `timeoutSeconds`,
  `successThreshold`, `failureThreshold`.

## Recursos e escalonamento

```yaml
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi
```

- `requests`: reserva usada pelo scheduler.
- `limits`: teto; CPU sofre throttling, memória causa `OOMKilled`.

### HPA

```console
kubectl autoscale deployment/api --min=2 --max=10 --cpu-percent=70
```

Requer metrics-server. Também escala por memória ou métricas customizadas.

### PDB

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: api
```

Limita evictions voluntárias (drain, upgrades).

### Distribuição

- `topologySpreadConstraints` distribui réplicas entre zonas/nós.
- `podAntiAffinity` evita concentrar réplicas no mesmo nó.
- `priorityClassName` define prioridade e preempção.

## Escolha rápida

```text
Precisa de identidade/volume estável?  ── sim ──▶ StatefulSet
        │ não
Precisa rodar em todo nó?             ── sim ──▶ DaemonSet
        │ não
Termina sozinho?                      ── sim ──▶ Job / CronJob
        │ não
É stateless?                          ── sim ──▶ Deployment
```
