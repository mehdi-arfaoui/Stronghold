# Déploiement Stronghold (SaaS / On‑premise)

## Modes de déploiement

La configuration se fait via `DEPLOYMENT_MODE` et des variables d’environnement communes.

- `DEPLOYMENT_MODE=saas` : active le multi‑tenant mutualisé (base unique, schéma par tenant, quotas).
- `DEPLOYMENT_MODE=onpremise` : génère une licence unique et désactive l’auto‑mise à jour.

Variables importantes (extraits) :

```env
DEPLOYMENT_MODE=saas # saas | onpremise
AUTO_UPDATE_ENABLED=true
TENANT_SCHEMA_PREFIX=tenant
TENANT_MAX_USERS=50
TENANT_MAX_DOCUMENTS=5000
TENANT_MAX_STORAGE_GB=200
TENANT_MAX_RPM=1200
TENANT_MAX_RUNBOOKS_PER_MONTH=200
LICENSE_FILE_PATH=
```

> En mode on‑premise, si `LICENSE_FILE_PATH` est vide, la licence est générée automatiquement dans `backend/config/license.json` (ou `config/license.json` selon le répertoire de lancement).

## Installation automatisée avec Helm (Kubernetes)

Le chart Helm est disponible dans `deploy/helm/stronghold`.

### 1) Préparer les valeurs sensibles

Créez un fichier `values.production.yaml` (ou utilisez `--set`) :

```yaml
image:
  repository: registry.example.com/stronghold/backend
  tag: "1.0.0"

env:
  deploymentMode: onpremise
  autoUpdateEnabled: "false"

secrets:
  databaseUrl: "postgresql://user:password@postgres:5432/stronghold?schema=public"
  openaiApiKey: ""
  s3AccessKeyId: "minioadmin"
  s3SecretAccessKey: "change_me"
```

### 2) Installer le chart

```bash
helm install stronghold deploy/helm/stronghold -f values.production.yaml
```

### 3) Vérifier le déploiement

```bash
kubectl get pods
kubectl logs deploy/stronghold-stronghold
```

## Notes opérationnelles

- Le mode SaaS repose sur un schéma par tenant dans une base unique (préfixe configurable via `TENANT_SCHEMA_PREFIX`).
- Les quotas sont paramétrables via `TENANT_MAX_*` et exposés au middleware tenant pour contrôle applicatif.
- L’auto‑mise à jour est désactivée par défaut en mode on‑premise.
