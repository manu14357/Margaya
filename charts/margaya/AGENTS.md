# charts/margaya

The Helm chart for Kubernetes installs: one combined Margaya container (API plus web, image `ghcr.io/manu14357/margaya`), an optional bundled PostgreSQL, and optional ingress, Gateway API route, autoscaling, Redis, S3 and local upload storage. Follow the root [AGENTS.md](../../AGENTS.md); skills: `local-stack`, `commit-and-release`.

## Rules

- Do not edit `version` or `appVersion` in `Chart.yaml`. The release sets both through `scripts/release/apply-version.mjs`, and `margaya.image.tag` defaults to `appVersion`.
- Defaults must install a working single-replica instance with only `margaya.env.clientUrl` and `margaya.env.authSecret` set. New features stay off by default. Redis stays optional: `templates/NOTES.txt` warns when several replicas can run without it, and local upload storage switches itself off for multiple replicas unless the volume is `ReadWriteMany` (`margaya.localStorage.active` in `templates/_helpers.tpl`).
- Secrets never appear as literal `value:` entries in a Deployment. Follow the existing pattern: a chart-managed Secret or an `existingSecret` with `name` and `key`, read through `secretKeyRef`.
- Reject invalid combinations in `templates/validations.yaml` with a `fail` message that names the value key and says how to fix it. Credentials there must be strings; unquoted YAML numbers render as floats.
- `margaya.extraEnv` and `margaya.extraEnvFrom` already cover rarely used variables. Add a first-class value only for settings most installs need.

## Adding a value

1. Add it to `values.yaml` with a comment and a safe default.
2. Render it in the right template (`templates/deployment.yaml` for container env).
3. Add it to the Parameters tables in `README.md`, plus a configuration example if it is not obvious.
4. Keep the other deployment surfaces consistent when the setting is an API environment variable: `ENVIRONMENT_SETUP.md`, the compose files at the repo root and `apps/docs/core/installation/environment-variables.mdx`.
5. If it changes a supported topology, add a case to the matrix in `.github/workflows/helm-validate.yml`.

## Verify

Use the same commands as CI (`.github/workflows/helm-validate.yml`), which requires `clientUrl` and an `authSecret` of at least 32 characters:

```sh
helm lint charts/margaya --set margaya.env.clientUrl=https://margaya.example.com --set margaya.env.authSecret=secure-auth-secret-at-least-32-characters
helm template margaya charts/margaya --set margaya.env.clientUrl=https://margaya.example.com --set margaya.env.authSecret=secure-auth-secret-at-least-32-characters
```

Repeat with the `--set` flags of the matrix cases your change touches (ingress, gateway, autoscaling, external database, Redis and S3, existing secrets). `ruby scripts/security/check-helm-secrets.rb`, run from the repo root with `helm` installed, checks that secrets stay out of Deployments and that invalid origins and credentials are rejected. If `helm` is not available, say the chart was not rendered.
