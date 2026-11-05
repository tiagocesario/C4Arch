---
name: Kubernetes
description: Use ao modelar, implantar, depurar e operar cargas no Kubernetes (Pods, Deployments, Services, ConfigMaps, Secrets, volumes, probes e RBAC), com base na documentação oficial em português.
---

# Kubernetes

Skill para executar e operar cargas de trabalho no Kubernetes. Fonte:
<https://kubernetes.io/pt-br/docs/home/>.

## Quando usar

- Escolher o objeto de workload correto (Pod, Deployment, StatefulSet, DaemonSet,
  Job, CronJob).
- Escrever ou revisar manifests YAML.
- Expor uma aplicação (Service, Ingress, Gateway).
- Configurar probes, recursos, ConfigMaps, Secrets e volumes.
- Diagnosticar `Pending`, `CrashLoopBackOff`, `ImagePullBackOff`, `OOMKilled`,
  Service sem endpoints.
- Definir limites de segurança e RBAC básicos.

## Princípios

1. **Estado desejado declarativo.** Você declara `spec`; os controladores
   convergem o estado real para ele continuamente.
2. **Objetos, não servidores.** Tudo é um objeto de API com `apiVersion`, `kind`,
   `metadata` e `spec`; o `status` é preenchido pelo cluster.
3. **Pods são efêmeros.** Não confie em um Pod individual; quem garante
   disponibilidade é o controlador (Deployment, StatefulSet etc.).
4. **Acoplamento fraco por rede.** Serviços se descobrem por DNS e Service, não
   por IP fixo de Pod.
5. **Configuração fora da imagem.** ConfigMap e Secret injetam configuração sem
   rebuild.
6. **Menor privilégio.** Rode como não-root, sem capabilities desnecessárias,
   com RBAC e NetworkPolicy restritos.
7. **Recursos explícitos.** Requests e limits evitam disputa e OOM inesperado.

## Fluxo de trabalho

1. **Classifique a carga**: stateless, stateful, daemon por nó, tarefa única ou
   agendada.
2. **Escolha o controlador** conforme a tabela abaixo.
3. **Defina configuração e segredos** (ConfigMap/Secret) antes do workload.
4. **Defina o Pod template**: imagem, portas, probes, recursos, securityContext.
5. **Exponha** com Service (ClusterIP por padrão) e, se HTTP externo, Ingress ou
   Gateway.
6. **Aplique** com `kubectl apply -f` e acompanhe o rollout.
7. **Valide** endpoints, logs, eventos e métricas.
8. **Endureça**: RBAC, NetworkPolicy, Pod Security, limites e imagens fixadas.

## Escolha do workload

| Objeto | Use quando | Garante |
| --- | --- | --- |
| `Pod` | Debug ou caso muito específico | Nada; não é substituído se cair |
| `ReplicaSet` | Raramente direto | Número de réplicas |
| `Deployment` | Aplicação stateless | Réplicas, rollout e rollback |
| `StatefulSet` | Banco, fila, identidade estável | Ordem, nome e volume por réplica |
| `DaemonSet` | Um Pod por nó (agente, log, CNI) | Cobertura de todos os nós |
| `Job` | Tarefa até conclusão | Execução com sucesso |
| `CronJob` | Tarefa agendada | Execução periódica |

## Estrutura de um objeto

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: app
  labels:
    app.kubernetes.io/name: api
spec:
  replicas: 3
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
```

- `selector` precisa casar com as labels do template.
- Nomes são DNS labels (minúsculas, `-`, `.`), únicos por kind/namespace.
- Use labels recomendadas (`app.kubernetes.io/name`, `/instance`, `/version`,
  `/component`, `/part-of`, `/managed-by`).

## Serviços e exposição

| Tipo | Alcance | Uso |
| --- | --- | --- |
| `ClusterIP` | Dentro do cluster | Padrão; comunicação interna |
| `NodePort` | IP de cada nó + porta 30000-32767 | Acesso externo simples/lab |
| `LoadBalancer` | Balanceador externo | Produção em nuvem |
| `ExternalName` | CNAME para nome externo | Apontar para serviço fora do cluster |

- Service seleciona Pods por `selector`; sem selector, use EndpointSlice manual.
- Descoberta por DNS: `<service>.<namespace>.svc.cluster.local`.
- Headless (`clusterIP: None`) devolve os IPs dos Pods, sem balanceamento.
- Ingress/Gateway cuidam de HTTP/HTTPS na borda; não são tipos de Service.

## Configuração e segredos

- `ConfigMap`: dados não sensíveis, como env ou arquivos montados.
- `Secret`: dados sensíveis; **base64 não é criptografia**. Por padrão, o valor
  fica no etcd e pode ser lido por quem tem acesso ao namespace/API.
- Prefira montar segredos como volume a expor em variáveis de ambiente.
- Habilite encryption at rest e controle RBAC sobre `secrets`.

## Probes e recursos

```yaml
startupProbe:
  httpGet: { path: /healthz, port: 8080 }
  failureThreshold: 30
  periodSeconds: 2
readinessProbe:
  httpGet: { path: /ready, port: 8080 }
  periodSeconds: 5
livenessProbe:
  httpGet: { path: /healthz, port: 8080 }
  periodSeconds: 10
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi
```

- `startupProbe`: dá tempo para inicializar sem matar o container.
- `readinessProbe`: tira o Pod do Service até estar pronto.
- `livenessProbe`: reinicia container travado; não use para dependência externa.
- `requests` definem agendamento; `limits` definem teto. CPU acima do limit sofre
  throttling; memória acima do limit causa `OOMKilled`.

## Operação com kubectl

```console
kubectl config current-context
kubectl get pods -n app -o wide
kubectl describe pod <pod> -n app
kubectl logs <pod> -n app -f --tail=200
kubectl logs <pod> -n app -c <container>
kubectl exec -it <pod> -n app -- sh
kubectl apply -f manifest.yaml
kubectl diff -f manifest.yaml
kubectl rollout status deployment/api -n app
kubectl rollout undo deployment/api -n app
kubectl get events -n app --sort-by=.lastTimestamp
```

## Diagnóstico rápido

| Estado/sintoma | Verifique |
| --- | --- |
| `Pending` | Recursos insuficientes, taints/tolerations, affinity, PVC não bound. |
| `ImagePullBackOff` | Nome/tag da imagem, registry, `imagePullSecrets`, rede. |
| `CrashLoopBackOff` | Logs, comando, config ausente, probe matando cedo. |
| `OOMKilled` | `limits.memory` baixo ou vazamento. |
| `Running` mas não recebe tráfego | `readinessProbe`, selector do Service, endpoints. |
| Service sem endpoints | Labels/selector divergentes, Pods não Ready. |
| DNS não resolve | CoreDNS, namespace, nome do Service. |
| `403` na API | RBAC (Role/RoleBinding) ou ServiceAccount. |

## Erros comuns

- Criar `Pod` direto em produção em vez de Deployment.
- Não definir `resources`, causando disputa e despejo.
- Usar `latest` sem política de atualização.
- Liveness probe apontando para dependência externa (reinicia em cascata).
- Guardar segredo em ConfigMap ou em `env` versionado.
- `hostPath`, `privileged` e `hostNetwork` sem necessidade.
- Service com selector diferente das labels do Pod.
- Um Deployment para carga stateful (use StatefulSet + PVC).
- Ignorar `PodDisruptionBudget` e `topologySpreadConstraints` em HA.

## Referências

- `references/arquitetura.md` — control plane, nós, addons e ciclo de controle.
- `references/workloads.md` — Pods, controladores, probes, recursos e escalonamento.
- `references/servicos-e-rede.md` — Service, Ingress, DNS, EndpointSlice e políticas.
- `references/configuracao-e-seguranca.md` — ConfigMap, Secret, volumes, RBAC,
  securityContext e Pod Security.

Documentação oficial em português: <https://kubernetes.io/pt-br/docs/home/>.
