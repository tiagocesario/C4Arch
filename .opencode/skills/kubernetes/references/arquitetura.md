# Arquitetura do cluster

Fonte: <https://kubernetes.io/pt-br/docs/concepts/architecture/> e
<https://kubernetes.io/pt-br/docs/concepts/overview/>.

## O que é Kubernetes

Plataforma portável, extensível e de código aberto para gerenciar cargas de
trabalho e serviços distribuídos em contêineres, com configuração declarativa e
automação. O nome vem do grego "timoneiro"; **K8s** é a abreviação.

O projeto foi aberto pelo Google em 2014, combinando experiência de operação em
escala com práticas da comunidade.

## Modelo de controle

O Kubernetes não executa um fluxo fixo de passos. Ele mantém **processos de
controle independentes** que observam o estado atual e o aproximam continuamente
do **estado desejado** declarado nos objetos.

```text
estado desejado (spec)  ──▶  controladores  ◀──  estado atual (status)
                                   │
                                   └── ações corretivas
```

Consequências:

- Você declara o resultado, não o procedimento.
- O cluster reconcilia sozinho (self-healing).
- O `status` é a visão do cluster sobre o objeto; não é editável pelo usuário.

## Componentes do control plane

O control plane toma decisões globais (agendamento, reconciliação) e responde a
eventos. Em produção, roda em múltiplas máquinas para alta disponibilidade.

### kube-apiserver

- Expõe a API do Kubernetes; é o front-end do control plane.
- Projetado para escala horizontal (várias instâncias atrás de balanceamento).
- Toda comunicação (kubectl, kubelet, controladores) passa por ele.
- Autenticação, autorização (RBAC) e admissão acontecem aqui.

### etcd

- Armazenamento chave-valor consistente e de alta disponibilidade.
- Guarda todos os dados do cluster, incluindo Secrets.
- Exige plano de backup; perdê-lo é perder o estado do cluster.
- Por padrão, Secrets não são criptografados em repouso (configure encryption
  at rest).

### kube-scheduler

- Observa Pods recém-criados sem nó atribuído e escolhe um nó.
- Considera requests de recursos, restrições de hardware/software, affinity e
  anti-affinity, taints/tolerations, localidade, interferência e prazos.

### kube-controller-manager

- Executa os loops de controle (controllers) em um único processo/binário.
- Exemplos: node controller, job controller, EndpointSlice controller,
  ServiceAccount controller, deployment controller.
- Logicamente cada controller é independente; fisicamente compartilham processo.

### cloud-controller-manager

- Incorpora lógica específica do provedor de nuvem.
- Executa apenas controllers do provedor: node, route e service (load balancer).
- Não existe em clusters on-premises ou ambientes locais de aprendizado.

## Componentes do nó

Executam em cada nó e mantêm os Pods funcionando.

### kubelet

- Agente que garante que os containers descritos nos PodSpecs estejam rodando.
- Não gerencia containers criados fora do Kubernetes.
- Reporta status do nó e dos Pods ao apiserver.

### kube-proxy (opcional)

- Implementa parte do conceito de Service, mantendo regras de rede nos nós.
- Usa filtragem de pacotes do SO quando disponível; senão encaminha ele mesmo.
- Pode ser dispensado se o plugin de rede (CNI) implementar o encaminhamento de
  Services com comportamento equivalente.

### Container runtime

Software que executa containers. O Kubernetes suporta implementações da
Container Runtime Interface (CRI): containerd, CRI-O, Docker (via runtime
compatível) e outras.

## Addons

Funcionalidades de cluster implementadas com recursos do Kubernetes; normalmente
no namespace `kube-system`.

| Addon | Função |
| --- | --- |
| DNS (CoreDNS) | Registros para Services; praticamente obrigatório. |
| Dashboard | UI web de gestão e troubleshooting. |
| Monitoramento de recursos | Métricas de containers (base do HPA). |
| Logging de cluster | Centraliza logs com busca/navegação. |
| Plugins de rede (CNI) | Alocam IPs e permitem comunicação entre Pods. |
| NetworkPolicy provider | Aplica políticas de rede (Calico, Cilium, Antrea etc.). |

## Variações de arquitetura

### Implantação do control plane

- **Tradicional**: componentes em máquinas/VMs dedicadas, muitas vezes systemd.
- **Pods estáticos**: kubelet gerencia os componentes em nós específicos
  (abordagem comum do kubeadm).
- **Auto-hospedado**: control plane roda como Pods no próprio cluster.
- **Gerenciado**: provedor de nuvem abstrai o control plane.

### Posicionamento de cargas

- Clusters pequenos/dev: control plane e workloads nos mesmos nós.
- Produção: nós dedicados ao control plane, separados das cargas de usuário.
- Addons críticos podem rodar em nós do control plane.

### Ferramentas

kubeadm, kops e Kubespray oferecem abordagens diferentes de instalação e
gerenciamento, com layouts e métodos próprios.

### Extensibilidade

- Schedulers customizados, em paralelo ou substituindo o padrão.
- CustomResourceDefinitions e API Aggregation estendem a API.
- cloud-controller-manager integra o provedor de nuvem.

## O que o Kubernetes não é

- Não é um PaaS completo; fornece blocos de construção.
- Não limita tipos de aplicação: stateless, stateful e batch rodam em containers.
- Não faz build nem deploy de código-fonte (isso é CI/CD).
- Não fornece middleware, bancos, caches ou storage de cluster como serviço
  integrado.
- Não dita logging, monitoramento ou alerta.
- Não impõe linguagem/sistema de configuração; a API é declarativa.
- Não é "apenas orquestração": elimina a necessidade de orquestração rígida ao
  reconciliar continuamente o estado.

## Fluxo de uma requisição de criação

```text
kubectl ──▶ kube-apiserver ──▶ autenticação ──▶ autorização (RBAC)
                │                    │
                │                    └──▶ admissão (mutating/validating)
                ▼
              etcd  ◀──▶ controllers (reconcile)  ◀──▶ scheduler
                                                       │
                                                       ▼
                                                     kubelet ──▶ runtime ──▶ container
```

## Implicações práticas

- O apiserver é o ponto central: indisponibilidade bloqueia mudanças, mas Pods
  existentes continuam rodando.
- etcd exige backup e latência baixa; é stateful e crítico.
- Sem DNS de cluster, descoberta por nome não funciona.
- Sem CNI, Pods não recebem IP nem se comunicam.
- Sem provider de NetworkPolicy, políticas são aceitas mas não aplicadas.
