# Margaya Helm Chart
This Helm chart deploys [Margaya](https://margaya.app) - open source project management that works for you, not against you.
## Introduction
This chart bootstraps a Margaya deployment on a Kubernetes cluster using the Helm package manager. It deploys both the API backend and Web frontend components, along with a PostgreSQL database, with optional ingress or Gateway API resources.
## Prerequisites
- Kubernetes 1.23+
- Helm 3.2.0+
- PV provisioner support in the underlying infrastructure (if persistence is enabled)
## Quick Start
### Basic Installation
Install directly from GHCR. The chart refuses to render without a public URL and an auth secret of at least 32 characters:
```bash
helm install margaya oci://ghcr.io/manu14357/charts/margaya \
  --namespace margaya \
  --create-namespace \
  --set margaya.env.clientUrl=http://localhost:5173 \
  --set margaya.env.authSecret="$(openssl rand -hex 32)"
# Access locally
kubectl port-forward svc/margaya-margaya 5173:5173 -n margaya
```
Open [http://localhost:5173](http://localhost:5173) and you're ready to go.
### Production Setup with Ingress
For real deployments, you'll want proper ingress:
```bash
helm install margaya oci://ghcr.io/manu14357/charts/margaya \
  --namespace margaya \
  --create-namespace \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set "ingress.hosts[0].host=pm.yourcompany.com" \
  --set margaya.env.clientUrl=https://pm.yourcompany.com \
  --set margaya.env.authSecret="$(openssl rand -hex 32)" \
  --set postgresql.auth.password="$(openssl rand -hex 16)"
```
### Production Setup with Gateway API
If your cluster already has Gateway API CRDs and a `Gateway` configured, you can expose Margaya with an `HTTPRoute`:
```bash
helm install margaya oci://ghcr.io/manu14357/charts/margaya \
  --namespace margaya \
  --create-namespace \
  --set gateway.enabled=true \
  --set "gateway.parentRefs[0].name=main-gateway" \
  --set "gateway.parentRefs[0].namespace=gateway-system" \
  --set "gateway.parentRefs[0].sectionName=https" \
  --set "gateway.hostnames[0]=pm.yourcompany.com"
```
## Installing the Chart
To install the published chart with the release name `my-margaya`:
```bash
helm install my-margaya oci://ghcr.io/manu14357/charts/margaya
```
To install from a local checkout instead:
```bash
helm install my-margaya ./charts/margaya
```
The command deploys Margaya on the Kubernetes cluster with default configuration. The [Parameters](#parameters) section lists the parameters that can be configured during installation.
## Uninstalling the Chart
To uninstall/delete the `my-margaya` deployment:
```bash
helm uninstall my-margaya
```
## Parameters
### Global parameters
| Name                     | Description                                                                                                        | Value       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------- |
| `nameOverride`           | String to partially override the fullname template (will maintain the release name)                                | `""`        |
| `fullnameOverride`       | String to fully override the fullname template                                                                     | `""`        |
| `replicaCount`           | Number of replicas (ignored if autoscaling is enabled)                                                             | `1`         |
| `enableServiceLinks`     | Controls Pod's enableServiceLinks field                                                                            | `false`   |
| `topologySpreadConstraints` | Controls Pod's topologySpreadConstraints field                                                                         | `[]`   |
### Autoscaling parameters
| Name                                | Description                                                                                                        | Value       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------- |
| `autoscaling.enabled`               | Enable autoscaling for the deployment                                                                              | `false`     |
| `autoscaling.minReplicas`           | Minimum number of replicas                                                                                         | `1`         |
| `autoscaling.maxReplicas`           | Maximum number of replicas                                                                                         | `10`        |
| `autoscaling.targetCPUUtilizationPercentage` | Target CPU utilization percentage                                                                         | `80`        |
When CPU autoscaling is enabled, set `margaya.resources.requests.cpu`; Kubernetes cannot calculate CPU utilization without a CPU request.
### PostgreSQL Database parameters
| Name                                | Description                                                                                                        | Value                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `postgresql.enabled`                | Deploy PostgreSQL as part of this chart                                                                           | `true`                          |
| `postgresql.image.repository`       | PostgreSQL image repository                                                                                        | `postgres`                      |
| `postgresql.image.tag`              | PostgreSQL image tag                                                                                               | `16-alpine`                     |
| `postgresql.image.pullPolicy`       | PostgreSQL image pull policy                                                                                      | `IfNotPresent`                  |
| `postgresql.auth.database`          | PostgreSQL database name                                                                                           | `margaya`                       |
| `postgresql.auth.username`          | PostgreSQL username                                                                                                | `margaya_user`                  |
| `postgresql.auth.password`          | PostgreSQL password                                                                                                | `margaya_password`              |
| `postgresql.auth.existingSecret`    | Name of existing secret containing PostgreSQL credentials                                                          | `""`                            |
| `postgresql.persistence.enabled`    | Enable persistence for PostgreSQL data                                                                             | `true`                          |
| `postgresql.persistence.size`       | PostgreSQL PVC size                                                                                                | `8Gi`                           |
| `postgresql.persistence.storageClass` | PostgreSQL PVC storage class                                                                                     | `""`                            |
| `postgresql.persistence.accessMode` | PostgreSQL PVC access mode                                                                                         | `ReadWriteOnce`                 |
| `postgresql.service.type`           | PostgreSQL service type                                                                                            | `ClusterIP`                     |
| `postgresql.service.port`           | PostgreSQL service port                                                                                            | `5432`                          |
| `postgresql.resources`              | Resource requests and limits for PostgreSQL container                                                              | `{}`                            |
### Margaya application parameters
| Name                                | Description                                                                                                        | Value                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `margaya.image.repository`          | Margaya image repository                                                                                           | `ghcr.io/manu14357/margaya`       |
| `margaya.image.tag`                 | Margaya image tag. Defaults to `Chart.appVersion` when empty                                                       | `""`                            |
| `margaya.image.pullPolicy`          | Margaya image pull policy                                                                                          | `IfNotPresent`                  |
| `margaya.service.type`              | Margaya service type                                                                                               | `ClusterIP`                     |
| `margaya.service.port`              | Margaya service port                                                                                               | `5173`                          |
| `margaya.service.targetPort`        | Margaya container port                                                                                             | `5173`                          |
| `margaya.env`                       | Environment variables for the Margaya container                                                                    | See `values.yaml`               |
| `margaya.env.clientUrl`             | Public URL of the Margaya instance. **Required for every deployment**; sets `MARGAYA_CLIENT_URL`. Helm rejects missing values and URLs with credentials, paths, queries or fragments before creating resources. Note: this key is case-sensitive (`clientUrl`, not `clientURL`). | `""` |
| `margaya.env.corsOrigins`           | Allowed CORS origins as a comma-separated string or YAML list                                                      | `[]`                            |
| `margaya.env.authSecret`            | Required Better Auth secret (minimum 32 characters), stored in a chart-managed Secret; ignored if existingSecret is enabled                           | `""` |
| `margaya.env.existingSecret.enabled` | Whether to use an existing secret for `AUTH_SECRET`                                                                | `false`                         |
| `margaya.env.existingSecret.name`   | Name of the existing secret containing `AUTH_SECRET`                                                               | `""`                            |
| `margaya.env.existingSecret.key`    | Key in the existing secret that contains `AUTH_SECRET`                                                             | `auth-secret`                   |
| `margaya.env.disableRegistration`   | Disable new user registration                                                                                      | `false`                         |
| `margaya.env.disablePasswordRegistration` | Disable password-based account creation while keeping social/OIDC registration available                        | `false`                         |
| `margaya.env.disableEmailOtpSignIn` | Use email/password sign-in instead of verification codes when SMTP is configured                                   | `false`                         |
| `margaya.env.authRateLimitEnabled`  | Per-IP rate limits on sign-in, email codes, magic links and password reset/change (in memory, per replica)         | `true`                          |
| `margaya.env.redis.url`             | Redis/Valkey URL (`REDIS_URL`) that relays realtime updates between replicas. Required with more than one replica | `""`                            |
| `margaya.env.redis.existingSecret.name` | Secret holding the full Redis URL; takes precedence over `url`                                                 | `""`                            |
| `margaya.env.redis.existingSecret.key` | Key of that Secret                                                                                              | `redis-url`                     |
| `margaya.env.s3.endpoint`           | S3-compatible endpoint (`S3_ENDPOINT`), reachable from users' browsers. Uploads are off while empty               | `""`                            |
| `margaya.env.s3.bucket`             | Bucket (`S3_BUCKET`); required with `endpoint`                                                                    | `""`                            |
| `margaya.env.s3.region`             | Signing region (`S3_REGION`)                                                                                       | `us-east-1`                     |
| `margaya.env.s3.forcePathStyle`     | Path-style URLs (`S3_FORCE_PATH_STYLE`): `true` for MinIO, `false` for AWS S3 and R2                              | `true`                          |
| `margaya.env.s3.keyPrefix`          | Prefix for every object key (`S3_KEY_PREFIX`)                                                                      | `""`                            |
| `margaya.env.s3.existingSecret.name` | Secret with the access key pair; empty uses the pod's IAM role / IRSA                                            | `""`                            |
| `margaya.env.s3.existingSecret.accessKeyIdKey` | Key holding `S3_ACCESS_KEY_ID`                                                                          | `access-key-id`                 |
| `margaya.env.s3.existingSecret.secretAccessKeyKey` | Key holding `S3_SECRET_ACCESS_KEY`                                                                  | `secret-access-key`             |
| `margaya.env.database.external.enabled` | Use external PostgreSQL database (set postgresql.enabled to false)                                               | `false`                         |
| `margaya.env.database.external.host` | External PostgreSQL host                                                                                           | `""`                            |
| `margaya.env.database.external.port` | External PostgreSQL port                                                                                           | `5432`                          |
| `margaya.env.database.external.database` | External PostgreSQL database name                                                                               | `margaya`                       |
| `margaya.env.database.external.username` | External PostgreSQL username                                                                                    | `margaya_user`                  |
| `margaya.env.database.external.password` | External PostgreSQL password                                                                                    | `""`                            |
| `margaya.env.database.external.existingSecret.enabled` | Use an existing secret for the external database connection URI                             | `false`                         |
| `margaya.env.database.external.existingSecret.name` | Name of the secret containing the database connection URI                                    | `""`                            |
| `margaya.env.database.external.existingSecret.passwordKey` | Key in the secret whose value is a full PostgreSQL connection URI                       | `postgres_uri`                  |
| `margaya.extraEnv`                  | Additional Kubernetes EnvVar entries appended to the Margaya container                                             | `[]`                            |
| `margaya.extraEnvFrom`              | Additional Kubernetes EnvFromSource entries appended to the Margaya container                                      | `[]`                            |
| `margaya.resources`                 | Resource requests and limits for the Margaya container (optional, disabled by default)                             | `{}`                            |
| `podSecurityContext`                | Security context applied at the Pod level                                                                          | `{}`                            |
| `securityContext`                   | Security context applied at the container level                                                                    | `{}`                            |
### Ingress parameters
| Name                                | Description                                                                                                        | Value                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `ingress.enabled`                   | Enable ingress                                                                                                     | `false`                         |
| `ingress.className`                 | Ingress class name                                                                                                 | `""`                            |
| `ingress.annotations`               | Ingress annotations                                                                                                | `{}`                            |
| `ingress.hosts`                     | Ingress hosts configuration                                                                                        | See `values.yaml`               |
| `ingress.tls`                       | Ingress TLS configuration                                                                                          | `[]`                            |
### Gateway API parameters
| Name                                | Description                                                                                                        | Value                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `gateway.enabled`                   | Enable Gateway API `HTTPRoute` creation                                                                            | `false`                         |
| `gateway.annotations`               | Annotations added to the `HTTPRoute`                                                                               | `{}`                            |
| `gateway.labels`                    | Extra labels added to the `HTTPRoute`                                                                              | `{}`                            |
| `gateway.parentRefs`                | Parent Gateway listener references for attaching the `HTTPRoute`                                                   | `[]`                            |
| `gateway.hostnames`                 | Hostnames exposed by the `HTTPRoute`                                                                               | `[]`                            |
| `gateway.rules`                     | Gateway API routing rules mapping paths to the chart services                                                      | See `values.yaml`               |
## Configuration Examples
### Minimal Configuration
```yaml
# values.yaml
margaya:
  env:
    authSecret: "your-secure-auth-secret-at-least-32-characters"
    clientUrl: "https://your-domain.com"
ingress:
  enabled: true
  className: nginx
  annotations: {}
  hosts:
    - host: your-domain.com
      paths:
        - path: /
          pathType: Prefix
          service: margaya
          port: 5173
```
### Production Configuration with TLS
```yaml
# values.yaml
replicaCount: 1
# PostgreSQL configuration
postgresql:
  auth:
    password: "your-secure-db-password"
  persistence:
    size: 20Gi
    storageClass: "managed-premium"
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
    requests:
      cpu: 100m
      memory: 128Mi
# Margaya configuration
margaya:
  resources:
    limits:
      cpu: 1000m
      memory: 1Gi
    requests:
      cpu: 200m
      memory: 256Mi
  env:
    authSecret: "your-secure-auth-secret-at-least-32-characters"
    clientUrl: "https://your-domain.com"
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  hosts:
    - host: your-domain.com
      paths:
        - path: /
          pathType: Prefix
          service: margaya
          port: 5173
  tls:
    - secretName: margaya-tls
      hosts:
        - your-domain.com
```
### Production Configuration with Traefik
If you're running Traefik as your ingress controller (common in self-hosted clusters), configure the ingress directly rather than through the chart's built-in ingress support:
```yaml
# values.yaml
margaya:
  env:
    authSecret: "your-secure-auth-secret-at-least-32-characters"
    clientUrl: "https://margaya.your-domain.com"
```
```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: margaya-ingress
  namespace: margaya
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: traefik
  rules:
    - host: margaya.your-domain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: margaya-margaya
                port:
                  number: 5173
  tls:
    - hosts:
        - margaya.your-domain.com
      secretName: margaya-tls
```
### Using External PostgreSQL Database
If you prefer to use an external PostgreSQL database instead of the bundled one:
```yaml
# values.yaml
# Disable bundled PostgreSQL
postgresql:
  enabled: false
margaya:
  env:
    authSecret: "your-secure-auth-secret-at-least-32-characters"
    database:
      external:
        enabled: true
        host: "your-postgres-host.com"
        port: 5432
        database: "margaya"
        username: "margaya_user"
        password: "your-db-password"
```
### Running several replicas (Redis)

With `replicaCount` above 1 or autoscaling, every replica needs the same Redis (or Valkey) so realtime updates, notifications and page co-editing reach users connected to other pods. The chart prints a warning after install when more than one replica can run without it.

```yaml
replicaCount: 3
margaya:
  env:
    redis:
      existingSecret:
        name: margaya-redis   # key redis-url, e.g. redis://:password@redis-master:6379
```

Scheduled jobs need nothing extra: they coordinate through PostgreSQL, so any number of replicas runs each job once at a time. Sign-in and API key rate limits are counted per replica. Behind an ingress controller, also set `TRUSTED_PROXIES` through `extraEnv` (see `values.yaml`) so those limits count clients rather than the controller. For Redis Sentinel or Cluster, set `REDIS_SENTINELS` or `REDIS_CLUSTER_NODES` and their companions through `extraEnv` instead.

### File uploads (S3-compatible storage)

Attachments, images and task exports need S3-compatible storage. Exports fall back to PostgreSQL without it; uploads are off.

```yaml
margaya:
  env:
    s3:
      endpoint: https://files.example.com   # must be reachable from browsers
      bucket: margaya-uploads
      forcePathStyle: true                   # false for AWS S3 and R2
      existingSecret:
        name: margaya-s3                     # keys access-key-id, secret-access-key
```

Leave `existingSecret.name` empty on EKS to use the service account's IAM role. Other optional variables (`S3_MAX_IMAGE_UPLOAD_BYTES`, `S3_PRESIGN_TTL_SECONDS`, SMTP, retention periods) go in `extraEnv`.

### Using an Existing Secret for Sensitive Data
For production environments, it's recommended to store sensitive data like the auth secret and database credentials in Kubernetes Secrets:
When `postgresql.auth.existingSecret` is used with bundled PostgreSQL, the password is expanded by Kubernetes into `DATABASE_URL` at runtime and must be URL-safe. If your password contains reserved URI characters such as `@`, `:`, `/`, `#`, `%`, or spaces, use an external database and provide the complete connection URI through `margaya.env.database.external.existingSecret`.
```bash
# Create a Secret for sensitive data
kubectl create secret generic margaya-secrets \
  --namespace margaya \
  --from-literal=auth-secret="your-secure-auth-secret-at-least-32-characters" \
  --from-literal=postgres-password="your-secure-db-password"
```
Then reference these secrets in your values:
```yaml
# values.yaml
postgresql:
  auth:
    existingSecret: "margaya-secrets"
    secretKeys:
      userPasswordKey: "postgres-password"
margaya:
  env:
    existingSecret:
      enabled: true
      name: "margaya-secrets"
      key: "auth-secret"
```
#### Using an Existing Secret with External PostgreSQL
When using an external database, the secret must contain a full PostgreSQL connection URI rather than just the password. Any special characters in the password (such as `@`, `:`, `/`) must be [percent-encoded](https://developer.mozilla.org/en-US/docs/Glossary/Percent-encoding).
```bash
# Create the secret with a full connection URI
kubectl create secret generic margaya-secrets \
  --namespace margaya \
  --from-literal=auth-secret="your-secure-auth-secret-at-least-32-characters" \
  --from-literal=postgres_uri="postgresql://margaya_user:your-password@your-host:5432/margaya"
```
```yaml
# values.yaml
postgresql:
  enabled: false

margaya:
  env:
    clientUrl: "https://margaya.your-domain.com"
    existingSecret:
      enabled: true
      name: "margaya-secrets"
      key: "auth-secret"
    database:
      external:
        enabled: true
        host: "your-postgres-host.com"
        port: 5432
        database: "margaya"
        username: "margaya_user"
        password: ""
        existingSecret:
          enabled: true
          name: "margaya-secrets"
          passwordKey: postgres_uri
```
## Database Management
### PostgreSQL Configuration
The chart deploys PostgreSQL 16 (Alpine) by default with the following configuration:
- Database name: `margaya`
- Username: `margaya_user`
- Default password: `margaya_password` (change this in production!). Quote numeric-looking values in YAML (`password: "12345678"`); the chart rejects unquoted numbers, which YAML would otherwise turn into a different value.
- Persistent storage: 8Gi (configurable)
The bundled PostgreSQL deployment is intended for development, trials, and small self-hosted installs. For production environments, use an external managed PostgreSQL database by setting `postgresql.enabled=false` and configuring `margaya.env.database.external`.
Bundled PostgreSQL credentials are only applied when PostgreSQL initializes an empty data directory. If a PVC already exists, changing `postgresql.auth.password` or `postgresql.auth.existingSecret` updates the Pod environment but does not rotate the password inside the existing database. For local retesting with a new password, uninstall the release and delete the test PVC before reinstalling:
```bash
helm uninstall margaya -n margaya-test
kubectl delete pvc margaya-postgresql-data -n margaya-test --ignore-not-found
```
To preserve data, rotate the password inside PostgreSQL first, then update the Helm values to match.
### Backup and Recovery
For production deployments, consider implementing regular database backups:
```bash
# Example backup command
kubectl exec -it deployment/my-margaya-postgresql -- pg_dump -U margaya_user margaya > margaya-backup.sql
```
### Migration from SQLite
If you're migrating from a previous SQLite-based installation, you'll need to:
1. Export your data from SQLite
2. Deploy the new PostgreSQL-based chart
3. Import your data into PostgreSQL
See the project's community channels for migration assistance.
## Troubleshooting
### "invalid origin" error on login
Margaya's API validates the `Origin` header on every request against `MARGAYA_CLIENT_URL`. The chart now requires `clientUrl` before rendering. On older deployments, an unset or incorrect value can cause login failures.

Set `clientUrl` to the URL users access Margaya from:
```yaml
margaya:
  env:
    clientUrl: "https://margaya.your-domain.com"
```

> **Note:** The key is `clientUrl` (camelCase). `clientURL` (all-caps) does not configure this value; Helm reports the missing required `clientUrl`.

### Pods crash immediately after upgrading to use `existingSecret`
If pods enter `CrashLoopBackOff` after switching to an existing secret for the external database, the connection URI in the secret is likely wrong. Check what the pod is actually using:
```bash
kubectl get secret margaya-secrets -n margaya \
  -o jsonpath='{.data.postgres_uri}' | base64 -d
```
Common causes:
- Wrong password
- Password contains special characters that need percent-encoding (e.g. `p@ss` → `p%40ss`)
- Incorrect host, port, or database name in the URI

### PodSecurity warnings on install/upgrade
On clusters with Pod Security Admission enabled, you may see warnings like `would violate PodSecurity "restricted:latest"`. The chart exposes `podSecurityContext` and `securityContext` to address these. See the [Security](#security) section for recommended values.
## Architecture
This chart deploys the following components:
1. **Margaya application**: Serves the web UI and API from the combined Margaya image
2. **PostgreSQL Database**: Stores all application data with proper relational integrity
The Margaya application and PostgreSQL run in separate pods for resource isolation and simpler database lifecycle management.
## Production Environment
For production deployments, you should:
1. Set secure values for `AUTH_SECRET` and PostgreSQL passwords
2. Use an Ingress controller to expose the application
3. Configure TLS for secure access
4. Set appropriate resource limits and requests
5. Enable persistent storage with appropriate storage classes
6. Consider using external PostgreSQL for better scalability
```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  hosts:
    - host: your-domain.com
      paths:
        - path: /
          pathType: Prefix
          service: margaya
          port: 5173
  tls:
    - secretName: margaya-tls
      hosts:
        - your-domain.com
```
## Using Gateway API
As an alternative to Ingress, the chart can create an `HTTPRoute` for the Kubernetes Gateway API:
```yaml
# values.yaml
gateway:
  enabled: true
  parentRefs:
    - name: main-gateway
      namespace: gateway-system
      sectionName: https
  hostnames:
    - margaya.example.com
```
By default the chart creates one Gateway API rule:
1. `/` goes to the Margaya service
If you need custom matching or multiple backend references, override `gateway.rules` directly. Each `backendRefs` entry follows the same pattern as ingress and uses the chart-specific `service` field (`margaya`), which is expanded to the release-specific Service name.
## Security
For production deployments, consider the following security recommendations:
1. Use secure `AUTH_SECRET` and PostgreSQL passwords, preferably stored in Kubernetes Secrets
2. Enable TLS for ingress or Gateway API
3. Enable and set resource limits to prevent resource exhaustion
4. Use a dedicated storage class for the PostgreSQL database
5. Consider using a network policy to restrict traffic between components
6. Regularly update PostgreSQL and application images
### Pod Security Context
On clusters with Pod Security Admission enforcement, set the following to satisfy the `restricted` policy:
```yaml
podSecurityContext:
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault

margaya:
  securityContext:
    allowPrivilegeEscalation: false
    capabilities:
      drop: ["ALL"]
```
### Registration Control
By default, user registration is enabled. To disable new user registration:
```yaml
margaya:
  env:
    disableRegistration: true
```
This will prevent new users from registering while still allowing existing users to log in. The registration option will be hidden from the login page.

### Authentication secret storage

The chart stores `margaya.env.authSecret` in a Kubernetes Secret and the application Deployment references its `auth-secret` key. Upgrades preserve the supplied value; the chart does not generate a new signing secret. For production, prefer `margaya.env.existingSecret` so secret material is not supplied in Helm values or retained in Helm release metadata. Limit access to Secrets and Helm release records.

When upgrading from a chart that placed `AUTH_SECRET` directly in the Deployment, consider the old Deployment, ReplicaSets, exported manifests and deployment logs exposed to readers of those resources. If those readers were not authorized to possess the signing secret, rotate it and invalidate affected authentication artifacts as part of the upgrade. Moving the value into a Secret does not revoke earlier copies.
