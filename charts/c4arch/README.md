# C4Arch Helm Chart

Chart para implantar o C4Arch no Kubernetes.

## Instalação

```bash
helm install c4arch ./charts/c4arch --namespace c4arch --create-namespace
```

## Valores importantes

- `image.repository` / `image.tag`: prefixo das imagens (api, web, realtime, worker).
- `postgres.password`: altere antes de produção.
- `api.env.JWT_SECRET`: defina um segredo forte.
- `ingress.enabled`: habilite e configure host para exposição.

## Publicação no GitHub

```bash
helm package charts/c4arch
# publique o .tgz como release no GitHub ou em um repositório OCI
```