---
name: Helm Chart
description: Use ao criar, revisar ou publicar Helm Charts para Kubernetes, com base na documentação oficial do Helm (helm.sh/docs).
---

# Helm Chart

Skill para construir, validar e operar Helm Charts para Kubernetes. Fonte:
<https://helm.sh/docs/>.

## Quando usar

- Criar um novo chart (`helm create`).
- Revisar templates Go, values e metadados.
- Empacotar, versionar e publicar charts.
- Configurar dependências, hooks, testes e RBAC.
- Diagnosticar instalações (`helm install`, `upgrade`, `rollback`).

## Estrutura recomendada

```text
mychart/
  Chart.yaml
  values.yaml
  values.schema.json
  templates/
    _helpers.tpl
    deployment.yaml
    service.yaml
    ingress.yaml
    NOTES.txt
  charts/
  crds/
  .helmignore
```

## Princípios

1. **Um chart por aplicação/serviço.** Evite monólitos; componha via dependências.
2. **Values com defaults seguros.** Tudo configurável, mas pronto para instalar.
3. **Templates idempotentes.** Reinstalar/upgrade não deve duplicar recursos.
4. **Labels e annotations padrão.** Use `app.kubernetes.io/*` e `helm.sh/chart`.
5. **Segurança por padrão.** `runAsNonRoot`, `readOnlyRootFilesystem`, `drop: ALL`.
6. **Versionamento semântico.** `version` do chart e `appVersion` da aplicação.
7. **Testes automatizados.** `helm test` com pods de verificação.
8. **Documentação.** `README.md` gerado e `NOTES.txt` com instruções pós-install.

## Fluxo de trabalho

1. **Criar o chart**: `helm create mychart`.
2. **Modelar values**: agrupe por componente; documente cada chave.
3. **Implementar templates**: use `_helpers.tpl` para nomes/labels; evite lógica complexa.
4. **Validar**: `helm lint`, `helm template`, `helm install --dry-run`.
5. **Testar**: `helm test` e testes de snapshot (helm-unittest).
6. **Empacotar**: `helm package mychart`.
7. **Publicar**: repositório OCI ou clássico; assine com provenance.

## Boas práticas

- Use `required` para values obrigatórios.
- Prefira `toYaml`/`nindent` para blocos; evite concatenação manual.
- Use `lookup` com cuidado (cluster state) e torne opcional.
- Separe CRDs em `crds/` (instalados antes dos templates).
- Use hooks (`pre-install`, `post-upgrade`) apenas quando necessário.
- Evite hardcode de namespace; use `.Release.Namespace`.
- Configure `podSecurityContext` e `securityContext`.
- Defina `resources` (requests/limits) e `probes`.
- Use `image.pullPolicy: IfNotPresent` em prod com tag fixa (não `latest`).

## Comandos essenciais

```bash
helm create mychart
helm lint mychart
helm template mychart ./mychart -f values.yaml
helm install myrelease ./mychart -n myns --create-namespace
helm upgrade myrelease ./mychart -n myns
helm rollback myrelease 1 -n myns
helm test myrelease -n myns
helm package mychart
helm push mychart-0.1.0.tgz oci://registry.example.com/charts
```

## Segurança e operação

- Não armazene segredos em `values.yaml`; use Secrets externos ou Sealed Secrets.
- Use RBAC mínimo para ServiceAccounts.
- Habilite NetworkPolicies quando aplicável.
- Configure PodDisruptionBudget para workloads críticos.
- Use `helm diff` antes de upgrades em produção.

## Referências

- Docs: <https://helm.sh/docs/>
- Best Practices: <https://helm.sh/docs/chart_best_practices/>
- Template Guide: <https://helm.sh/docs/chart_template_guide/>
- Commands: <https://helm.sh/docs/helm/>