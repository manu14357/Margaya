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
- `AUTH_SECRET` - **Required.** Secret key for JWT token generation (**must be at least 32 characters long**; use a long, random value in production). The API refuses to start without it, because an unset secret would fall back to a publicly known default and make every session cookie forgeable. The Docker entrypoint generates a random one per session if you do not set it, so sessions will not survive a restart until you do. Generate one with `openssl rand -hex 32`. Keep it stable: changing it signs everyone out and makes stored workspace webhook signing secrets unreadable, so rotate those secrets afterwards.
- `DEVICE_AUTH_CLIENT_IDS` - **Optional.** Comma-separated list of allowed device-flow OAuth client IDs. When unset, Margaya implicitly allows `margaya-cli` and `margaya-mcp` by default (no extra configuration for the CLI or MCP). Override only when you need additional trusted clients, for example `margaya-cli,margaya-mcp,my-desktop-app`.
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
- `EXPORT_RETENTION_DAYS` - Days a finished task export stays downloadable (1 to 30, default 7). Export files are stored in S3 when it is configured, otherwise in the database, where one file can be at most 25 MB. Set it in Helm through `extraEnv`.
- `API_KEY_RATE_LIMIT_PER_MINUTE` - Requests each API key may make per minute (default `600`; `0` turns the limit off). Every API-key response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; over the limit the API answers 429 with `Retry-After`. Counted in memory per API instance, so with several instances a key can make up to that many times the limit. Sessions and MCP sign-ins are not limited by it.
- `WEBHOOK_DELIVERY_RETENTION_DAYS` - Days the workspace webhook delivery log is kept (1 to 90, default 14). Webhook signing secrets need no extra key: they are encrypted with a key derived from `AUTH_SECRET`, so changing `AUTH_SECRET` makes them unreadable. Deliveries then fail with "Signing secret unavailable" until an admin rotates each webhook's secret. Webhook endpoints follow `MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` like the other webhooks. Set it in Helm through `extraEnv`.
- `AUDIT_LOG_RETENTION_DAYS` - Days workspace audit log entries are kept (default 365; `0` keeps them forever). An hourly job on one instance at a time deletes older entries. Entries record the client IP address and user agent, so pick a period that matches your privacy policy. Set it in Helm through `extraEnv`.
- `DISABLE_PUBLIC_BOARDS` - Set to `true` to turn off published project boards on this server: every public board link and public board API answers 404, and publishing answers 409. Publications and their settings are kept, so setting it back to `false` restores them. Public board writes (comments, reactions, votes, requests) are rate limited per IP, per account and per board; like `API_KEY_RATE_LIMIT_PER_MINUTE` the counts are per API instance unless Redis is configured, in which case they are shared. Set it in Helm through `extraEnv`.
- `MARGAYA_INSTANCE_NAME` - The name shown on the sign-in screen and on public boards (1 to 80 characters, default `Margaya`). Setting it locks the name in the admin panel.
- `MARGAYA_PUBLIC_LANDING` - Whether signed-out visitors to the web app's root (`/`) see the product landing page (default `true`). Set it to `false` to send them straight to sign-in, as before. Signed-in users always go to their dashboard. Setting it locks the switch under Settings > Instance > General. Set it in Helm through `extraEnv`.
- `MARGAYA_LOCK_INSTANCE_SETTINGS` - Set to `true` to manage every instance setting with environment variables only: values saved in the admin panel are ignored and the panel is read-only. See "Instance settings" below.
- `NOTIFICATION_SECRET_ENCRYPTION_KEY` - Key for encrypting the secrets users save in their notification settings (webhook signing secrets, ntfy and Gotify tokens). Any long random value, e.g. `openssl rand -hex 32`. Without it, saving such a secret answers 503 with this variable's name; everything else in notification settings works. Keep it stable: changing it makes stored secrets unreadable, and users must enter them again.
- `EMAIL_NOTIFICATION_BATCH_WINDOW_SECONDS` - How long email notifications wait so that the ones arriving close together go out as one email per person, grouped by task (default `300`, at most `86400`). `0` sends each notification email immediately, as before. Only email is delayed: in-app, realtime, ntfy, Gotify and webhooks stay immediate, and sign-in, password reset, invitation and security emails are never batched. Queued emails live in PostgreSQL and are sent by the scheduler on one instance at a time, so they survive restarts and are not sent twice. Set it in Helm through `extraEnv`.

#### Instance settings

Instance admins (the first account, plus anyone added under Settings > Instance > Admins) can change these settings in the app without a restart: the instance name, the public landing page (`MARGAYA_PUBLIC_LANDING`), sign-up rules (`DISABLE_REGISTRATION`, `DISABLE_PASSWORD_REGISTRATION`, `DISABLE_GUEST_ACCESS`), sign-in methods (`DISABLE_LOGIN_FORM`, `DISABLE_EMAIL_OTP_SIGN_IN`), workspace creation (`DISABLE_WORKSPACE_CREATION`), each OAuth provider (GitHub, Google, Discord, custom OAuth/OIDC), SMTP, and public boards (`DISABLE_PUBLIC_BOARDS`, plus a public participation switch).

Each setting resolves in this order:
1. `MARGAYA_LOCK_INSTANCE_SETTINGS=true`: the environment variable when set, else the default. Saved values are ignored and the panel is read-only.
2. The setting's environment variable is set (present and not blank): that value wins and the panel shows it locked. `DISABLE_X=false` counts as set. OAuth credentials and SMTP lock as a group: when a provider's client id variable (`GITHUB_OAUTH_CLIENT_ID` or the legacy `GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `DISCORD_CLIENT_ID`, `CUSTOM_OAUTH_CLIENT_ID`) or `SMTP_HOST` is set, the whole group comes from the environment. A provider's on/off switch has no variable, so admins can always turn a provider off.
3. A value saved in the panel.
4. The built-in default.

An installation that never saves anything in the panel behaves exactly as before. Nothing is copied from the environment into the database: removing a variable and restarting hands that setting to the panel. Saved secrets (SMTP password, OAuth client secrets) are never shown again and are encrypted with a key derived from `AUTH_SECRET`; after changing `AUTH_SECRET` the panel marks them unreadable and they must be entered again. Changes apply at once on the API instance that saved them and within 10 seconds on the others; Redis is not needed. The panel refuses a change that would leave no way to sign in, and Better Auth's admin endpoints refuse to demote, ban or remove the last instance admin.

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
- `MARGAYA_SENTRY_DSN` - Sentry DSN for the **web container** (browser errors, tracing, session replay). Same runtime-placeholder mechanism as `MARGAYA_TURNSTILE_SITE_KEY`.
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
   - Test if the API is accessible: `curl http://localhost:1337/config`
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
