# Configuração, armazenamento e segurança

Fonte: <https://kubernetes.io/pt-br/docs/concepts/configuration/>,
<https://kubernetes.io/pt-br/docs/concepts/storage/> e
<https://kubernetes.io/pt-br/docs/concepts/security/>.

## ConfigMap

Guarda dados não sensíveis em pares chave-valor ou arquivos.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  LOG_LEVEL: info
  app.properties: |
    feature.x=true
    timeout=30
```

Consumo:

```yaml
# como variáveis
envFrom:
  - configMapRef:
      name: app-config

# como variável específica
env:
  - name: LOG_LEVEL
    valueFrom:
      configMapKeyRef:
        name: app-config
        key: LOG_LEVEL

# como arquivo
volumes:
  - name: config
    configMap:
      name: app-config
volumeMounts:
  - name: config
    mountPath: /etc/app
```

- Atualizações em volume são propagadas (com atraso); variáveis de ambiente só
  mudam com restart.
- `immutable: true` evita alterações acidentais e melhora desempenho.

## Secret

Semelhante ao ConfigMap, para dados sensíveis.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
type: Opaque
stringData:
  username: app
  password: troque-isto
```

- `data` espera base64; `stringData` aceita texto e é convertido.
- **Base64 não é criptografia.** Qualquer um com leitura no namespace/API vê o
  valor.
- Por padrão, Secrets ficam em texto no etcd. Habilite encryption at rest.
- Tipos: `Opaque`, `kubernetes.io/tls`, `kubernetes.io/dockerconfigjson`,
  `kubernetes.io/service-account-token`, `bootstrap.kubernetes.io/token`.
- Monte como volume em vez de `env` (evita vazamento em logs/processos).
- Restrinja `get/list/watch` de Secrets via RBAC.
- Para produção, considere External Secrets, Sealed Secrets ou um cofre (Vault).

```yaml
volumes:
  - name: creds
    secret:
      secretName: db-credentials
      defaultMode: 0400
volumeMounts:
  - name: creds
    mountPath: /etc/db
    readOnly: true
```

## Variáveis e Downward API

- `env.valueFrom`: `configMapKeyRef`, `secretKeyRef`, `fieldRef`,
  `resourceFieldRef`.
- Downward API expõe metadados do Pod (nome, namespace, labels, limits) via env
  ou volume.
- `envFrom` importa todas as chaves de um ConfigMap/Secret.

## Volumes

Um volume existe enquanto o Pod existe e é montado em um ou mais containers.

| Tipo | Persistência | Uso |
| --- | --- | --- |
| `emptyDir` | Enquanto o Pod existir | Cache, troca entre containers do Pod |
| `hostPath` | Nó | Agente/acesso ao host; risco de segurança |
| `configMap` / `secret` | Objeto | Configuração e credenciais |
| `projected` | Objeto | Combina várias fontes |
| `persistentVolumeClaim` | Independente do Pod | Dados duráveis |
| `nfs`, `csi` etc. | Backend externo | Storage compartilhado/específico |

```yaml
volumes:
  - name: cache
    emptyDir:
      sizeLimit: 1Gi
  - name: data
    persistentVolumeClaim:
      claimName: app-data
```

`emptyDir` com `medium: Memory` usa tmpfs.

## PV, PVC e StorageClass

- **PersistentVolume (PV)**: recurso de storage no cluster (estático ou
  dinâmico).
- **PersistentVolumeClaim (PVC)**: pedido de storage por um Pod.
- **StorageClass**: define o provisionador e os parâmetros; permite provisionamento
  dinâmico.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: standard
  resources:
    requests:
      storage: 10Gi
```

Modos de acesso:

| Modo | Significado |
| --- | --- |
| `ReadWriteOnce` (RWO) | Um nó lê/escreve |
| `ReadOnlyMany` (ROX) | Vários nós leem |
| `ReadWriteMany` (RWX) | Vários nós leem/escrevem |
| `ReadWriteOncePod` (RWOP) | Um único Pod |

Políticas de reclaim: `Retain`, `Delete`, `Recycle` (obsoleto).

```console
kubectl get pv,pvc -A
kubectl describe pvc app-data
kubectl get storageclass
```

## Recursos e limites

```yaml
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi
```

- Sem requests, o scheduler não reserva e o Pod pode sofrer pressão.
- Memória acima do limit: `OOMKilled`.
- CPU acima do limit: throttling.
- `LimitRange` aplica defaults e limites por namespace.
- `ResourceQuota` limita o total do namespace.

## Segurança de Pod

### securityContext

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: registry.example.com/app:1.0.0
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
```

- `runAsNonRoot` impede root.
- `allowPrivilegeEscalation: false` bloqueia setuid.
- `readOnlyRootFilesystem` exige volumes para diretórios graváveis.
- `seccompProfile: RuntimeDefault` reduz syscalls.
- Evite `privileged: true`, `hostNetwork`, `hostPID`, `hostPath`.

### Pod Security Standards

Três níveis aplicados por namespace (Pod Security Admission):

| Nível | Perfil |
| --- | --- |
| `privileged` | Sem restrições |
| `baseline` | Impede escalonamento óbvio |
| `restricted` | Boas práticas de hardening |

```yaml
metadata:
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

## RBAC

Quatro objetos:

- `Role` / `ClusterRole`: conjunto de permissões.
- `RoleBinding` / `ClusterRoleBinding`: liga permissões a sujeitos.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: app
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pod-reader
  namespace: app
subjects:
  - kind: ServiceAccount
    name: ci
    namespace: app
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pod-reader
```

Boas práticas:

- Prefira `Role`/`RoleBinding` com namespace a `ClusterRole` global.
- Não conceda `*` em resources/verbs.
- Um ServiceAccount por workload; não compartilhe o `default`.
- `automountServiceAccountToken: false` quando o Pod não fala com a API.
- Audite `system:anonymous` e bindings amplos.

## ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: api
  namespace: app
automountServiceAccountToken: false
```

Use `serviceAccountName` no Pod. Tokens projetados têm expiração e público
(audience).

## Rede e multi-tenancy

- `NetworkPolicy` para segmentar (ver `servicos-e-rede.md`).
- Namespaces separam nomes e cotas, mas **não** são fronteira de segurança por
  si só.
- Para multi-tenant forte: RBAC restrito, NetworkPolicy, quotas, Pod Security e
  isolamento de nós.

## Checklist de configuração

- [ ] Configuração em ConfigMap, não na imagem.
- [ ] Segredos em Secret/cofre, montados como arquivo.
- [ ] Nenhum segredo em `env` versionado no Git.
- [ ] Requests e limits definidos.
- [ ] PVC para dados duráveis; `emptyDir` só para efêmero.
- [ ] `runAsNonRoot`, `allowPrivilegeEscalation: false`, capabilities dropadas.
- [ ] Namespace com Pod Security `baseline` ou `restricted`.
- [ ] ServiceAccount dedicada e RBAC mínimo.
- [ ] NetworkPolicy default-deny onde fizer sentido.
- [ ] Encryption at rest para Secrets no etcd.
