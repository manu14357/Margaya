# Environment Setup Guide

This guide will help you set up the Margaya development environment and troubleshoot common issues.

## Quick Start

1. **Create a `.env` file** in the root of the project with the required environment variables (see the [documentation](https://margaya.app/docs/core/installation/environment-variables) for the complete list).

2. **Start the development servers**:
   ```bash
   pnpm dev
   ```

This starts both the API (port 1337) and web app (port 5173). Both will automatically reload when you make changes.

> **Tip**: The web app at http://localhost:5173 will automatically connect to the API at http://localhost:1337

## Environment Variables

Margaya uses a **single `.env` file** in the root of the project for all environment variables. This file is shared by both the API and web services.

### Required Variables

For development, you'll need at minimum:

- `MARGAYA_CLIENT_URL` - The URL of the web application (e.g., `http://localhost:5173`)
- `MARGAYA_API_URL` - The URL of the API (e.g., `http://localhost:1337`)
- `AUTH_SECRET` - **Required.** Secret key for JWT token generation (**must be at least 32 characters long**; use a long, random value in production). The API refuses to start without it, because an unset secret would fall back to a publicly known default and make every session cookie forgeable. The bundled image's entrypoint generates one if you do not set it and saves it as `.auth-secret` in the uploads volume (`MARGAYA_STORAGE_DIR`); it warns at startup if that folder is not writable or not on a mounted volume, because the secret is then lost. Generate one with `openssl rand -hex 32`. Keep it stable: changing it signs everyone out and makes SMTP passwords, OAuth client secrets, AI keys and workspace webhook signing secrets saved in the app unreadable, so enter or rotate those again afterwards.
- `DEVICE_AUTH_CLIENT_IDS` - **Optional.** Comma-separated list of allowed device-flow OAuth client IDs. When unset, Margaya implicitly allows `margaya-cli`, `margaya-mcp` and `margaya-desktop` by default (no extra configuration for the CLI, MCP or Margaya Desktop). Override only when you need additional trusted clients, and keep the defaults you use in the list, for example `margaya-cli,margaya-mcp,margaya-desktop,my-client`.
- `DESKTOP_SIGN_IN_ENABLED` - **Optional.** Set to `false` to turn Margaya Desktop off for this server: `/api/config` reports it as off, the app refuses to connect, and the `/api/auth/desktop/*` sign-in routes answer 404. Default `true`.
- `DESKTOP_MIN_VERSION` - **Optional.** The oldest Margaya Desktop version this server accepts, such as `1.4.0`; older apps ask the user to update. A value that is not a version is ignored. Default `0.1.0`.
- `MARGAYA_VERSION` - **Optional.** The server version `/api/config` reports to Margaya Desktop. Defaults to the `version` in the root `package.json` of the build. Set it to the release version (for example from the release tag) when you build an image.
- `DATABASE_URL` - PostgreSQL connection string
- `POSTGRES_DB` - PostgreSQL database name
- `POSTGRES_USER` - PostgreSQL username
- `POSTGRES_PASSWORD` - PostgreSQL password

If your app uses a device client ID that is not included in the defaults, set `DEVICE_AUTH_CLIENT_IDS` to the full comma-separated list of allowed IDs (including any defaults you still need), so it includes the client ID your app sends to `/api/auth/device/code`.

### Development-Specific Variables

For local development, the web app also supports:
- `VITE_API_URL` - API URL for development (defaults to `http://localhost:1337` if not set)
- `VITE_APP_URL` - App URL for generating links (optional)
- `VITE_PUBLIC_SITE_URL` - Public website the app links to, for `pnpm dev` (optional; see `MARGAYA_PUBLIC_SITE_URL`). Set it in `apps/web/.env.local`, e.g. `http://localhost:3001` to use the local site dev server.

### Public website and documentation

The public website (`apps/site`) is a Next.js static export that serves the landing pages and the documentation at `/docs`. Run it with `pnpm --filter @margaya/site dev` (port 3001), or in Docker with `docker compose -f compose.local.yml up -d --build site` (also on port 3001).

- `MARGAYA_PUBLIC_SITE_URL` - **Optional**, on the **web container**. The public website the app links to (landing links, Help > Documentation, webhook signature docs); the documentation URL is this value plus `/docs`. Defaults to `https://margaya.app`. Like `MARGAYA_API_URL`, the production web image bakes the placeholder `MARGAYA_PUBLIC_SITE_URL` into the bundle and `apps/web/env.sh` swaps in the runtime value when the container starts; an unset, invalid or non-HTTP(S) value falls back to the default. `compose.local.yml` sets it to `http://localhost:3001`. In Helm, set it through `extraEnv`.

### Optional Variables

Margaya supports many optional configuration options including:
- `MARGAYA_INTERNAL_API_URL` - API origin used only for server-side requests from the built-in HTTP MCP endpoint. Defaults to `http://127.0.0.1:1337`; override it only if the API is not reachable there from its own process.
- SSO providers (GitHub OAuth via `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`, Google, Discord, Custom OAuth/OIDC)
- GitHub repository integration (GitHub App: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, optional `GITHUB_APP_NAME`), separate from GitHub SSO
- SMTP configuration for email
- Access control settings
- CORS configuration
- Redis for horizontal scaling
- Private-network notification receivers (`MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS=true` lets ntfy/Gotify/webhook destinations resolve to private addresses; off by default to prevent SSRF)
- `TRASH_RETENTION_DAYS` - Days a deleted task or project stays in the trash, where it can be restored, before it is deleted permanently (default 30; `0` turns the automatic purge off and keeps the trash until someone empties it). An hourly job on one instance at a time does the purge. Set it in Helm through `extraEnv`.
- `WORKSPACE_DELETION_GRACE_DAYS` - Days a workspace scheduled for deletion stays read-only, with its API keys and webhooks paused, before it is deleted for good (default 14; `0` deletes it at the next hourly purge). Its owner can cancel until then. Set it in Helm through `extraEnv`.
- File uploads (attachments, description and comment images) work out of the box: without S3 they go to the built-in local file store. `MARGAYA_STORAGE_DIR` sets its folder (default `./data/uploads` relative to the API's working directory; the Compose files set `/app/apps/api/data/uploads` on the `uploads_data` volume). Files are served only through the API's authorized download route, never listed. Setting `S3_ENDPOINT` and `S3_BUCKET` switches uploads to S3 (unchanged presigned flow). `MARGAYA_LOCAL_STORAGE=false` turns the local store off, so uploads answer 503 until S3 is set. `S3_MAX_IMAGE_UPLOAD_BYTES` (default 10 MiB) and `S3_PRESIGN_TTL_SECONDS` (default 300) apply to both stores. The local store belongs to one machine: with several API instances, use S3 or a shared volume. Switching between the stores later does not move existing files. Uploads never finalized within a day are deleted by an hourly sweep (both stores).
- `EXPORT_RETENTION_DAYS` - Days a finished task export stays downloadable (1 to 30, default 7). Export files are stored in S3 when it is configured, otherwise in the database, where one file can be at most 25 MB. Set it in Helm through `extraEnv`.
- `API_KEY_RATE_LIMIT_PER_MINUTE` - Requests each API key may make per minute (default `600`; `0` turns the limit off). Every API-key response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; over the limit the API answers 429 with `Retry-After`. Counted in memory per API instance, so with several instances a key can make up to that many times the limit. Sessions and MCP sign-ins are not limited by it.
- `WEBHOOK_DELIVERY_RETENTION_DAYS` - Days the workspace webhook delivery log is kept (1 to 90, default 14). Webhook signing secrets need no extra key: they are encrypted with a key derived from `AUTH_SECRET`, so changing `AUTH_SECRET` makes them unreadable. Deliveries then fail with "Signing secret unavailable" until an admin rotates each webhook's secret. Webhook endpoints follow `MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` like the other webhooks. Set it in Helm through `extraEnv`.
- `AUDIT_LOG_RETENTION_DAYS` - Days workspace audit log entries are kept (default 365; `0` keeps them forever). An hourly job on one instance at a time deletes older entries. Entries record the client IP address and user agent, so pick a period that matches your privacy policy. Set it in Helm through `extraEnv`.
- `AUTOMATION_RUN_RETENTION_DAYS` - Days the run history of project automation rules is kept (default 30; `0` keeps it forever). A daily job on one instance at a time deletes older runs. Set it in Helm through `extraEnv`.
- `INSTANCE_AUDIT_LOG_RETENTION_DAYS` - Days instance audit trail entries (Settings > Instance > Admins) are kept (default 365; `0` keeps them forever). The same kind of hourly job deletes older ones. Set it in Helm through `extraEnv`.
- `API_REQUEST_LOG_ENABLED` / `API_REQUEST_LOG_RETENTION_DAYS` - Every REST request made with an API key is logged for the key's owner (Settings > Account > Developer, the activity icon on a key): time, method, route template, status and duration. Bodies, query strings, headers and IP addresses are never stored. Rows are written in batches every two seconds and kept 14 days by default (at most 365). Set `API_REQUEST_LOG_ENABLED=false` to turn the log off. Set them in Helm through `extraEnv`.
- `DISABLE_PUBLIC_BOARDS` - Set to `true` to turn off published project boards on this server: every public board link and public board API answers 404, and publishing answers 409. Publications and their settings are kept, so setting it back to `false` restores them. Public board writes (comments, reactions, votes, requests) are rate limited per IP, per account and per board; like `API_KEY_RATE_LIMIT_PER_MINUTE` the counts are per API instance unless Redis is configured, in which case they are shared. Set it in Helm through `extraEnv`.
- `MARGAYA_INSTANCE_NAME` - The name shown on the sign-in screen and on public boards (1 to 80 characters, default `Margaya`). Setting it locks the name in the admin panel.
- `MARGAYA_PUBLIC_LANDING` - Whether signed-out visitors to the web app's root (`/`) see the product landing page (default `true`). Set it to `false` to send them straight to sign-in, as before. Signed-in users always go to their dashboard. Setting it locks the switch under Settings > Instance > General. Set it in Helm through `extraEnv`.
- `MARGAYA_LOCK_INSTANCE_SETTINGS` - Set to `true` to manage every instance setting with environment variables only: values saved in the admin panel are ignored and the panel is read-only. See "Instance settings" below.
- `NOTIFICATION_SECRET_ENCRYPTION_KEY` - Key for encrypting the secrets users save in their notification settings (webhook signing secrets, ntfy and Gotify tokens). Any long random value, e.g. `openssl rand -hex 32`. Without it, saving such a secret answers 503 with this variable's name; everything else in notification settings works. Keep it stable: changing it makes stored secrets unreadable, and users must enter them again.
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` - Turn on web push, so people can get alerts on a phone or computer from Settings > Account > Notifications. Push is off until both keys are set. Generate them once with `pnpm --filter @margaya/api admin generate-push-keys` (in the Docker image: `node apps/api/dist/cli/admin.js generate-push-keys`). Keep them stable: new keys turn push off on every device until people turn it on again. `VAPID_SUBJECT` is a contact for push services, a `mailto:` address you read or an `https://` URL; it defaults to `MARGAYA_CLIENT_URL` when that is `https://`. Some push services, Apple's among them, may refuse anything else, so the API warns at startup while it's an example address such as `mailto:admin@example.com`. Browsers only offer push over HTTPS. On iPhone and iPad it also needs the app added to the Home Screen. Set them in Helm through `extraEnv`.
- `EMAIL_NOTIFICATION_BATCH_WINDOW_SECONDS` - How long email notifications wait so that the ones arriving close together go out as one email per person, grouped by task (default `300`, at most `86400`). `0` sends each notification email immediately, as before. Only email is delayed: in-app, realtime, ntfy, Gotify and webhooks stay immediate, and sign-in, password reset, invitation and security emails are never batched. Queued emails live in PostgreSQL and are sent by the scheduler on one instance at a time, so they survive restarts and are not sent twice. Set it in Helm through `extraEnv`.

#### Instance settings

Instance admins (the first account, plus anyone added under Settings > Instance > Admins) can change these settings in the app without a restart: the instance name, the public landing page (`MARGAYA_PUBLIC_LANDING`), sign-up rules (`DISABLE_REGISTRATION`, `DISABLE_PASSWORD_REGISTRATION`, `DISABLE_GUEST_ACCESS`), sign-in methods (`DISABLE_LOGIN_FORM`, `DISABLE_EMAIL_OTP_SIGN_IN`), workspace creation (`DISABLE_WORKSPACE_CREATION`), each OAuth provider (GitHub, Google, Discord, custom OAuth/OIDC), SMTP, and public boards (`DISABLE_PUBLIC_BOARDS`, plus a public participation switch).

Each setting resolves in this order:
1. `MARGAYA_LOCK_INSTANCE_SETTINGS=true`: the environment variable when set, else the default. Saved values are ignored and the panel is read-only.
2. The setting's environment variable is set (present and not blank): that value wins and the panel shows it locked. `DISABLE_X=false` counts as set. OAuth credentials and SMTP lock as a group: when a provider's client id variable (`GITHUB_OAUTH_CLIENT_ID` or the legacy `GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `DISCORD_CLIENT_ID`, `CUSTOM_OAUTH_CLIENT_ID`) or `SMTP_HOST` is set, the whole group comes from the environment. A provider's on/off switch has no variable, so admins can always turn a provider off.
3. A value saved in the panel.
4. The built-in default.

An installation that never saves anything in the panel behaves exactly as before. Nothing is copied from the environment into the database: removing a variable and restarting hands that setting to the panel. Saved secrets (SMTP password, OAuth client secrets) are never shown again and are encrypted with a key derived from `AUTH_SECRET`; after changing `AUTH_SECRET` the panel marks them unreadable and they must be entered again. Changes apply at once on the API instance that saved them and within 10 seconds on the others; Redis is not needed. The panel refuses a change that would leave no way to sign in, and Better Auth's admin endpoints refuse to demote, ban or remove the last instance admin.

#### AI (optional)

AI is off by default and needs no variables: instance admins can set everything under Settings > Instance > AI. A variable set here locks its setting in that panel, as for other instance settings. Each workspace must still opt in, and each project can opt out. See the docs page "AI Setup".

- `MARGAYA_AI_ENABLED` - `true` allows AI on this server (`false` locks it off)
- `MARGAYA_AI_PROVIDER` - `anthropic` (default) or `openai_compatible`
- `ANTHROPIC_API_KEY` - the Anthropic API key
- `MARGAYA_AI_OPENAI_BASE_URL`, `MARGAYA_AI_OPENAI_API_KEY` - an OpenAI-compatible endpoint, including the version path (e.g. `https://api.openai.com/v1`); it must be a public address
- `MARGAYA_AI_MODEL_FAST`, `MARGAYA_AI_MODEL_BALANCED`, `MARGAYA_AI_MODEL_DEEP` - model names per tier; empty uses `claude-haiku-5-5`, `claude-sonnet-5-5` and `claude-opus-5-5` with Anthropic
- `MARGAYA_AI_LOCAL_BASE_URL`, `MARGAYA_AI_LOCAL_MODEL` - your own OpenAI-compatible server (Ollama, vLLM), e.g. `http://ollama:11434/v1`; private addresses are allowed here only, and data from restricted projects only goes here
- `MARGAYA_AI_LOCAL_API_KEY` - optional key for that server, only when it requires one (for example vLLM started with `--api-key`); stored encrypted when set in the panel
- `MARGAYA_AI_LOCAL_ONLY` - `true` sends every AI request to the local model
- `MARGAYA_AI_EMBEDDINGS_BASE_URL`, `MARGAYA_AI_EMBEDDINGS_MODEL`, `MARGAYA_AI_EMBEDDINGS_API_KEY` - optional OpenAI-compatible embeddings endpoint for semantic search (also needs pgvector: `compose.pgvector.yml` or Helm `postgresql.pgvector.enabled`)
- `MARGAYA_AI_SEMANTIC_MIN_SIMILARITY` - how close in meaning a semantic search result must be, -1 to 1 (default 0.3)
- `MARGAYA_AI_WORKSPACE_RPM` (default 120), `MARGAYA_AI_USER_RPM` (default 30), `MARGAYA_AI_USER_CONCURRENCY` (default 2) - request limits, counted per API process (or in Redis when configured)
- `MARGAYA_AI_TIMEOUT_MS` - wall-clock limit per AI request (default 600000)
- `MARGAYA_AI_LOCAL_REASONING_TOKENS` - extra output tokens added to every local-model call so reasoning models have room to think before answering (default 4096; 0 turns it off)
- `MARGAYA_AI_ALLOW_FAKE` - `true` lets a production server use the deterministic `fake` provider (development and tests use it without this)

Keys saved in the panel are encrypted with a key derived from `AUTH_SECRET`. Prompts and answers are never stored; the AI usage ledger keeps counts only. For a local model with Docker Compose, start the optional service with `docker compose --profile ai-local up -d`.

#### Redis Configuration

Margaya supports three Redis deployment modes for WebSocket Pub/Sub. When any Redis mode is configured, WebSocket broadcasts use Redis Pub/Sub, allowing multiple API instances to relay real-time updates. When none are set, an in-memory adapter is used (single-instance only).

**Standalone (single server):**
- `REDIS_URL` - Redis connection string (e.g., `redis://localhost:6379`)

**Sentinel (high-availability with automatic failover):**
- `REDIS_SENTINELS` - Comma-separated list of Sentinel nodes (e.g., `sentinel-1:26379,sentinel-2:26379,sentinel-3:26379`)
- `REDIS_SENTINEL_MASTER_NAME` - Name of the Sentinel master group (default: `mymaster`)
- `REDIS_SENTINEL_PASSWORD` - Password for Sentinel instances, if different from the Redis password (optional)
- `REDIS_SENTINEL_TLS` - Set to `true` to enable TLS for Sentinel connections (default: `false`)

**Cluster (horizontal sharding):**
- `REDIS_CLUSTER_NODES` - Comma-separated list of cluster seed nodes (e.g., `node-1:6379,node-2:6379,node-3:6379`)

**Shared (used by Sentinel and Cluster modes):**
- `REDIS_PASSWORD` - Password for the Redis data nodes (used by both Sentinel and Cluster modes, not for Sentinel auth itself; use `REDIS_SENTINEL_PASSWORD` for that)

> **Note:** Only one mode should be configured at a time. If multiple are set, the priority is: Cluster > Sentinel > Standalone.

#### SMTP Configuration

For sending emails (workspace invitations, magic links, etc.), configure these variables:
- `SMTP_HOST` - SMTP server hostname
- `SMTP_PORT` - SMTP server port
- `SMTP_USER` - SMTP username
- `SMTP_PASSWORD` - SMTP password
- `SMTP_FROM` - From email address
- `SMTP_SECURE` - Use TLS immediately (default: `true`, typically port 465). Set to `false` for STARTTLS, typically on port 587.
- `SMTP_REQUIRE_TLS` - Require a STARTTLS upgrade when `SMTP_SECURE=false` (default: `true`). Sending fails if the server cannot upgrade. Only set to `false` for an intentionally unencrypted local development relay.
- `SMTP_IGNORE_TLS` - Removed: `true` is rejected because this option disabled STARTTLS and could send credentials and emails in plaintext.

For a private SMTP certificate authority, configure Node's `NODE_EXTRA_CA_CERTS` with the path to a trusted CA PEM file before starting the API. Fix expired certificates or hostname mismatches instead of bypassing validation. When upgrading an existing installation, remove `SMTP_IGNORE_TLS=true` and check SMTP delivery with the corrected trust configuration before rollout.

When SMTP is configured, sign-in uses email verification codes by default. Set `DISABLE_EMAIL_OTP_SIGN_IN=true` to use email/password sign-in instead (workspace invitation emails still use SMTP).

When SMTP is configured, the sign-in screen also offers "Forgot password?" (while password sign-in is on), and users can verify their email address with a 6-digit code, which reveals workspace invitations sent to it.

#### Sign-in rate limiting

- `AUTH_RATE_LIMIT_ENABLED` - Per-IP limits on sign-in, email codes, magic links, password reset and password change (default: `true`). Set to `false` only for test environments. The counts live in memory in each API instance and reset on restart; with several API replicas each counts separately. Behind a reverse proxy, set `TRUSTED_PROXIES` so clients are counted by their own address rather than the proxy's.

#### Security hardening

These protections are always on; only the API-key switch below is a variable.

- **Cross-site request guard.** A state-changing request (POST, PUT, PATCH, DELETE) that carries a session cookie must come from a trusted origin: `MARGAYA_CLIENT_URL`, `MARGAYA_API_URL` or a `CORS_ORIGINS` entry, checked through the `Origin` header (or `Referer`, or `Sec-Fetch-Site`). Others get 403 "Cross-site request refused". Requests with an API key or a Bearer token, MCP, OAuth callbacks and signed webhooks are not affected. If the web app is reached at an address not listed in those variables, add it to `CORS_ORIGINS`. Scripts should authenticate with an API key rather than a copied session cookie.
- **Passwords.** New passwords (sign-up, reset, change, admin set, recovery CLI) need at least 10 characters, may not be a common password (a small list ships with the server; nothing is looked up online) and may not be the account's email address. Existing passwords keep working until they are changed.
- **Email change.** Users change their address under Settings > Account > Personal information. A 6-digit code goes to the new address; the change happens only once it is entered, then the old address gets a notice and other sessions are signed out. It needs SMTP.
- **Instance admins.** Changing instance settings or admins (and Better Auth's `/api/auth/admin/*` account actions) needs a recent sign-in: a session opened in the last 10 minutes, or the password confirmed in the app. Admins without a password sign in again. Every such change lands in the instance audit trail (Settings > Instance > Admins), which stores which settings changed but never their values.
- **Scoped API keys.** A new key can have full access (as before), be read-only (GET requests and task queries only), or be limited to chosen permission areas, and optionally to chosen projects. Other projects answer 404 to a project-limited key, and workspace-wide routes refuse it except the project list. Scoped keys work on the REST API and MCP but are refused on `/api/auth/*`. A key never exceeds its owner's role, and a banned owner's keys stop working. Keys created before scoping keep full access.
- **Two-factor authentication.** Anyone with a password can turn on TOTP under Settings > Account > Security (any authenticator app, plus 10 one-time recovery codes). Password sign-in then asks for a code; "trust this device" skips it for 30 days. Email links and email codes are not sent to such accounts, so they can't skip the second step. OAuth and OIDC sign-in rely on the provider's own checks. No new variable.
- `ALLOW_INSTANCE_ADMIN_API_KEYS` - An instance admin's API keys act like any member's keys: they reach only the workspaces the admin belongs to and cannot use `/api/auth/admin/*`. Set to `true` to give them the admin's instance-wide reach again (default `false`). Set it in Helm through `extraEnv`.
- **Security headers.** The API sends `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff` and a referrer policy, plus `Strict-Transport-Security` when `MARGAYA_API_URL` is `https://`. The web image's nginx sends a page content policy (own scripts, the Turnstile captcha, YouTube embeds; API and WebSocket calls to any HTTPS or HTTP host so a separate API and S3 uploads work), `frame-ancestors 'self'`, a permissions policy, and HSTS when the request arrived with `X-Forwarded-Proto: https`. TLS itself is still up to your reverse proxy.

#### Sign-in policy

These are instance settings (Settings > Instance > Authentication). Each variable below, when set, locks its setting in the panel, like the other sign-in variables.

- `ALLOWED_EMAIL_DOMAINS` - Comma-separated domains new accounts must use, for example `example.com,example.org` (exact match, no subdomains). Applies to every sign-up method, OAuth and invitations included; inviting a new address outside the list is refused. Existing accounts are not affected. Empty allows any domain.
- `ALLOW_INVITED_PASSWORD_REGISTRATION` - With password sign-up off (`DISABLE_PASSWORD_REGISTRATION=true` or the panel switch), `true` still lets people with a valid invitation create a password account (default `false`).
- `REQUIRED_SIGN_IN_PROVIDER` - `github`, `google`, `discord` or `custom`: everyone signs in through that provider. Other providers, password sign-in, email codes and magic links are refused for everyone except instance admins, who keep password sign-in (and password reset) as a way back in. The panel refuses a provider that isn't set up and turned on. Existing sessions are not ended.
- `SESSION_LIFETIME_HOURS` - How long a session lasts without use, 1 to 8760 (default 168, a week). Use extends it, at most once a day. A change applies to new sessions and refreshes on every API instance within 10 seconds.

#### Instance user management

Settings > Instance > Users lists every account (search, admins, banned), shows each one's workspaces, and can ban or unban (for good, or for 7 or 30 days, signing the person out everywhere), reset a password (email a link, which needs SMTP, or set one now), sign someone out everywhere, and promote or demote instance admins. Every action needs the recent sign-in above and lands in the instance audit trail. You can't ban yourself or the last instance admin.

#### Admin recovery CLI

When no instance admin can sign in (a forgotten password on a server without SMTP, a demoted or banned admin), run the recovery CLI next to the database. It needs shell access to the API container and talks to PostgreSQL directly; every run is recorded in the instance audit trail as "Recovery CLI".

```bash
# Bundled image (Docker Compose)
docker compose exec margaya node apps/api/dist/cli/admin.js list-admins
docker compose exec margaya node apps/api/dist/cli/admin.js promote-admin you@example.com
docker compose exec -e MARGAYA_NEW_PASSWORD='a long new passphrase' margaya node apps/api/dist/cli/admin.js reset-password you@example.com

# Kubernetes
kubectl exec -it deploy/<release>-margaya -- node apps/api/dist/cli/admin.js promote-admin you@example.com

# Development
pnpm --filter @margaya/api admin promote-admin you@example.com
```

Commands: `list-admins`, `promote-admin <email>`, `demote-admin <email>` (never the last admin), `reset-password <email>` (uses `MARGAYA_NEW_PASSWORD` when set, otherwise prints a generated password once, and signs the account out everywhere) and `unban-user <email>`. In the separate API image (`apps/api/Dockerfile`) the path is `dist/cli/admin.js`.

#### Cloud-mode abuse mitigations

Hosted multi-tenant instances should enable the cloud abuse gates. Self-hosted instances can leave these unset.

- `MARGAYA_CLOUD` - Set to `true` to enable cloud-only protections: disposable-email signup block, Turnstile captcha enforcement, guest-account invite block, and tightened rate limits on `/sign-up/email` and `/organization/invite-member`.
- `TURNSTILE_SECRET_KEY` - Cloudflare Turnstile secret key (API container, server-side verification). When unset, captcha verification is skipped.
- `MARGAYA_TURNSTILE_SITE_KEY` - Cloudflare Turnstile site key, on the **web container**. The production web image bakes the literal placeholder `MARGAYA_TURNSTILE_SITE_KEY` into the bundle; `apps/web/env.sh` swaps it for the runtime value when the container starts.
- `VITE_TURNSTILE_SITE_KEY` - Local dev only. Set in `apps/web/.env` when running `pnpm dev`; Vite reads this at build/dev time. Not used in the production image.

#### Sentry (error monitoring)

All Sentry integration is opt-in; leave these unset for zero telemetry.

- `SENTRY_DSN` - Sentry DSN for the API. When unset, the Sentry SDK never initializes.
- `SENTRY_ENVIRONMENT` - Environment tag for API events (defaults to `NODE_ENV`).
- `SENTRY_TRACES_SAMPLE_RATE` - Fraction of API requests to trace for performance monitoring, `0`-`1` (default: `0`, tracing off).
- `MARGAYA_SENTRY_DSN` - Sentry DSN for the **web container** or the bundled image (browser errors, tracing, session replay). Same runtime-placeholder mechanism as `MARGAYA_TURNSTILE_SITE_KEY`: `apps/web/env.sh` fills it in when the container starts. When it is unset, browsers never download the Sentry SDK; when set, the SDK loads right after the app starts, so an error in the first moments of a page load is not reported.
- `VITE_SENTRY_DSN` - Local dev only. Set in `apps/web/.env` when running `pnpm dev`.

For a complete list of all environment variables, their descriptions, and configuration options, see the [official documentation](https://margaya.app/docs/core/installation/environment-variables).

## Common Issues & Troubleshooting

### CORS Errors

**Symptoms:**
- "Failed to fetch" errors in browser console
- Network errors when making API requests
- "Access to fetch at '...' from origin '...' has been blocked by CORS policy"

**Solutions:**

1. **Check URL Configuration:**
   - Ensure `MARGAYA_API_URL` matches your API server URL
   - Ensure `MARGAYA_CLIENT_URL` matches your web app URL
   - For development, you can also set `VITE_API_URL` in your `.env` file

2. **Configure CORS Origins:**
   - Add your frontend URL to `CORS_ORIGINS` in your `.env`:
     ```
     CORS_ORIGINS=http://localhost:5173,https://yourdomain.com
     ```
   - In development, unconfigured HTTP CORS may reflect origins. WebSocket connections always require an allowed origin (`MARGAYA_CLIENT_URL`, `MARGAYA_API_URL`, or an explicit `CORS_ORIGINS` entry).
   - **Note:** `CORS_ORIGINS` should match `MARGAYA_CLIENT_URL` for proper authentication

3. **Check Protocol Consistency:**
   - Ensure both frontend and API use the same protocol (http/https)
   - Don't mix http and https in development

4. **Verify Server Accessibility:**
   - Test if the API is accessible: `curl http://localhost:1337/api/health`
   - Check if the server is running on the correct port

### Database Connection Issues

**Symptoms:**
- "Database connection failed" errors
- API server won't start

**Solutions:**

1. **Check PostgreSQL:**
   - Ensure PostgreSQL is running
   - Verify database exists and credentials are correct
   - Test connection: `psql $DATABASE_URL`

2. **Update DATABASE_URL:**
   - Ensure the connection string format is correct
   - Check username, password, host, port, and database name

3. **Match the hostname to where the API runs:**
   - Use `postgres` only when the API container is on the same Docker Compose network as the Postgres service
   - Use `localhost` when the API runs directly on your host machine
   - If you see `getaddrinfo EAI_AGAIN postgres`, the API is trying to resolve the Compose hostname from the wrong network context

4. **Use the right configuration mode:**
   - For host-native development, prefer an explicit `DATABASE_URL`
   - If you derive from `POSTGRES_*`, set `POSTGRES_HOST=localhost` when running the API on your host
   - `POSTGRES_DB` and `POSTGRES_USER` by themselves do not switch Margaya into derived connection mode

### Authentication Issues

**Symptoms:**
- "Authentication failed" errors
- Users can't sign in

**Solutions:**

1. **Check Authentication Configuration:**
   - Ensure `AUTH_SECRET` is set in your `.env` file
   - Use a strong secret in production
   - Verify `MARGAYA_CLIENT_URL` and `MARGAYA_API_URL` are correctly configured

2. **Clear Browser Data:**
   - Clear cookies and local storage
   - Try in incognito/private mode

### Network Errors

**Symptoms:**
- "Network error" messages
- API requests timeout

**Solutions:**

1. **Check Server Status:**
   - Verify API server is running
   - Check server logs for errors

2. **Check Firewall/Proxy:**
   - Ensure ports are not blocked
   - Check if proxy settings interfere

3. **Verify URLs:**
   - Check that all URLs are accessible
   - Test with curl or browser

## Development vs Production

### Development
- Use `http://localhost` for both frontend and API
- Set `MARGAYA_CLIENT_URL` and `MARGAYA_API_URL` to your local URLs; list any additional frontend origins in `CORS_ORIGINS`. WebSocket origins are checked even in development (defaults are `http://localhost:5173` and `http://localhost:1337` when the corresponding URL is unset).
- Use simple secrets for `AUTH_SECRET` (not for production)
- The web app will use `VITE_API_URL` if set, otherwise defaults to `http://localhost:1337`

### Production
- Use HTTPS for both frontend and API
- Set specific `CORS_ORIGINS` for security (should match `MARGAYA_CLIENT_URL`)
- Use strong, unique secrets for `AUTH_SECRET`
- Configure proper database credentials
- Ensure `MARGAYA_CLIENT_URL` and `MARGAYA_API_URL` are set to your production URLs

## Getting Help

If you're still experiencing issues:

1. Check the browser console for detailed error messages
2. Review the API server logs
3. Verify all environment variables are set correctly
4. Ensure all services (PostgreSQL, API, Frontend) are running
5. Consult the [official documentation](https://margaya.app/docs) for detailed guides and troubleshooting

For the most up-to-date information on environment variables and configuration, always refer to the [official documentation](https://margaya.app/docs/core/installation/environment-variables).
