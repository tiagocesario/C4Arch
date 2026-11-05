# Serviços e rede

Fonte: <https://kubernetes.io/pt-br/docs/concepts/services-networking/service/> e
demais páginas de serviços/rede.

## Problema que o Service resolve

Pods são efêmeros e cada um recebe seu próprio IP. O conjunto de Pods de um
Deployment muda com o tempo. Sem uma abstração, o cliente precisaria descobrir e
acompanhar IPs manualmente.

O **Service** define um conjunto lógico de endpoints (normalmente Pods) e uma
política de acesso, oferecendo um único nome/IP estável.

```text
frontend ──▶ Service (IP virtual estável) ──▶ EndpointSlice ──▶ Pods
```

## Definindo um Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  selector:
    app.kubernetes.io/name: MyApp
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: 9376
```

- `port`: porta exposta pelo Service.
- `targetPort`: porta no Pod; pode ser nome de porta.
- `protocol`: TCP (padrão), UDP ou SCTP.
- O controlador mantém EndpointSlices atualizados conforme Pods entram/saem.
- Nome do Service deve ser um nome de label RFC 1035 válido.

### targetPort nomeado

```yaml
containers:
  - name: app
    ports:
      - containerPort: 8080
        name: http-web
---
spec:
  ports:
    - port: 80
      targetPort: http-web
```

Permite mudar a porta do Pod sem quebrar clientes.

### Múltiplas portas

```yaml
ports:
  - name: http
    port: 80
    targetPort: 8080
  - name: metrics
    port: 9090
    targetPort: 9090
```

Cada porta precisa de nome quando há mais de uma.

### Sem selector

Sem `selector`, nenhum EndpointSlice é criado automaticamente. Útil para apontar
para backend externo, outro namespace/cluster ou migração parcial.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: external-db
spec:
  ports:
    - name: postgres
      port: 5432
      targetPort: 5432
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: external-db-1
  labels:
    kubernetes.io/service-name: external-db
addressType: IPv4
ports:
  - name: postgres
    port: 5432
endpoints:
  - addresses:
      - 10.0.0.50
```

## Tipos de Service

| Tipo | Comportamento |
| --- | --- |
| `ClusterIP` | IP interno; acessível só dentro do cluster. Padrão. |
| `NodePort` | Abre a mesma porta estática em cada nó (30000-32767 por padrão). |
| `LoadBalancer` | Pede balanceador externo ao provedor; inclui NodePort e ClusterIP. |
| `ExternalName` | CNAME para um nome externo; sem proxy. |

Os tipos são aninhados: `LoadBalancer` inclui `NodePort`, que inclui
`ClusterIP`.

### ClusterIP

- IP virtual do pool `service-cluster-ip-range`.
- `clusterIP: None` cria um **headless Service**.
- É possível pedir um IP específico em `.spec.clusterIP`, se estiver no range.

### NodePort

```yaml
spec:
  type: NodePort
  ports:
    - port: 80
      targetPort: 8080
      nodePort: 30007
```

- Acessível por qualquer nó no `nodePort`.
- Útil para laboratório ou quando você fornece o balanceamento.
- Evite em produção exposta; prefira LoadBalancer/Ingress.

### LoadBalancer

```yaml
spec:
  type: LoadBalancer
  ports:
    - port: 443
      targetPort: 8443
```

- Depende de integração com o provedor (cloud-controller-manager) ou de um
  controlador como MetalLB em cluster local.
- Pode desabilitar a alocação de NodePort em alguns provedores.

### ExternalName

```yaml
spec:
  type: ExternalName
  externalName: api.exemplo.com
```

- DNS do cluster retorna CNAME.
- Não há proxy, healthcheck nem balanceamento.
- Só é resolvido por DNS, não por variáveis de ambiente.

## Headless Service

```yaml
spec:
  clusterIP: None
```

- Sem IP virtual, sem kube-proxy, sem balanceamento.
- DNS retorna os IPs dos Pods (registros A/AAAA) quando há selector.
- Base para StatefulSet e descoberta direta de instâncias.
- Sem selector, o DNS precisa apontar para EndpointSlices ou ExternalName; nesse
  caso `port` deve ser igual a `targetPort`.

## Descoberta

### DNS

Com CoreDNS:

```text
<service>.<namespace>.svc.cluster.local
```

Exemplos:

- Mesmo namespace: `my-service`.
- Outro namespace: `my-service.my-ns`.
- FQDN: `my-service.my-ns.svc.cluster.local`.

Registros SRV para portas nomeadas: `_http._tcp.my-service.my-ns`.

### Variáveis de ambiente

O kubelet injeta, para cada Service ativo:

```text
REDIS_PRIMARY_SERVICE_HOST=10.0.0.11
REDIS_PRIMARY_SERVICE_PORT=6379
```

O Service precisa existir antes do Pod cliente. Prefira DNS.

## EndpointSlice

- Substitui o antigo Endpoints para escalar melhor.
- Cada slice agrupa até 100 endpoints por padrão.
- Rótulo `kubernetes.io/service-name` liga o slice ao Service.
- `addressType`: `IPv4`, `IPv6` ou `FQDN`.
- Útil para diagnosticar Service sem tráfego.

```console
kubectl get endpointslice -l kubernetes.io/service-name=my-service
```

## Ingress

Ponto de entrada HTTP/HTTPS para múltiplos Services, com regras de host/path.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  tls:
    - hosts: ["app.exemplo.com"]
      secretName: app-tls
  rules:
    - host: app.exemplo.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
```

- Ingress é só a regra; precisa de um **Ingress Controller**.
- `pathType`: `Prefix`, `Exact`, `ImplementationSpecific`.
- TLS via Secret do tipo `kubernetes.io/tls`.

## Gateway API

- Família de APIs (CRDs) que evolui Ingress com papéis separados
  (GatewayClass, Gateway, HTTPRoute etc.).
- Suporta roteamento mais expressivo, multiplataforma e multi-tenant.
- Requer um controlador compatível.

## NetworkPolicy

Firewall de L3/L4 entre Pods. **Só funciona se o CNI implementar.**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-allow-web
  namespace: app
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: api
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: web
      ports:
        - protocol: TCP
          port: 8080
```

- Por padrão, todo Pod fala com todo Pod (a menos que o CNI aplique default deny).
- A primeira política que seleciona um Pod muda o comportamento para "negar o
  resto" naquela direção.
- Combine `podSelector`, `namespaceSelector` e `ipBlock`.

## Tráfego interno/externo

- `.spec.internalTrafficPolicy` e `.spec.externalTrafficPolicy` controlam
  roteamento para backends prontos e preservação de IP de origem.
- `externalTrafficPolicy: Local` preserva o IP do cliente, mas pode deixar nós
  sem backend.
- `topologyKeys`/Topology Aware Routing aproximam tráfego da zona.

## Exposição local

```console
kubectl port-forward svc/api 8080:80 -n app
kubectl proxy
```

`port-forward` é para debug, não para produção.

## Checklist de rede

- [ ] Service tem selector que casa com labels dos Pods.
- [ ] `targetPort` corresponde à porta real do container.
- [ ] Pods estão `Ready` (readiness).
- [ ] EndpointSlices têm endpoints.
- [ ] DNS do cluster está saudável.
- [ ] NetworkPolicy permite o tráfego esperado.
- [ ] Ingress Controller existe e `ingressClassName` está correto.
- [ ] TLS Secret existe no mesmo namespace do Ingress.
