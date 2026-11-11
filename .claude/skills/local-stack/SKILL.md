---
name: local-stack
description: Run Margaya locally - pnpm dev (API :1337, web :5173), PostgreSQL via compose, the root .env from .env.sample, optional Redis, S3/local uploads, pgvector, the docs site, Docker images, health checks and seeding. Use when starting, restarting or troubleshooting the local app, when a change needs a running instance to verify, or when asked to build or smoke-test the Docker image.
---

# Local stack

Purpose: get a working local instance with the least machinery, and leave the machine as you found it. Root rules: [AGENTS.md](../../../AGENTS.md); full variable reference: `ENVIRONMENT_SETUP.md` and `apps/docs/core/installation/environment-variables.mdx`.

**Rules.** Never use production databases, storage or credentials. Record the PID or container name of everything you start, and stop only those; never kill by process name or path pattern (`node`, `vite`, `tsx`). Ask before starting long-lived servers or containers if the user did not request them. Never print or copy values out of `.env`, `.env.local` or `creds.md`.

## 1. Environment

- Server variables come from the root `.env` (loaded by `dotenv-mono` in the API and `apps/api/drizzle.config.ts`). Start from `.env.sample` if `.env` does not exist; never overwrite an existing one.
- Minimum for development: `MARGAYA_CLIENT_URL` (http://localhost:5173), `MARGAYA_API_URL` (http://localhost:1337), `AUTH_SECRET` (32+ characters; `openssl rand -hex 32`), and either `DATABASE_URL` or `POSTGRES_*`. When the API runs on the host, use `localhost` in the URL, not the compose hostname `postgres`.
- Vite-only overrides (`VITE_API_URL`, `VITE_PUBLIC_SITE_URL`, ...) go in `apps/web/.env.local`. The root `.env.local` is a different file: `compose.local.yml` reads it as the env file for its containers.

## 2. PostgreSQL

The API needs a reachable PostgreSQL 16. If none is running, the compose service is the simplest (reads the root `.env.local`, publishes 5432):
```sh
docker compose -f compose.local.yml up -d postgres
```
The API applies Drizzle migrations from `apps/api/drizzle` and its startup data migrations on every boot (`runStartupMigrations` in `apps/api/src/index.ts`), so restarting the API after pulling schema changes is enough. Test suites use their own databases (`*_test`, `margaya_e2e`); see the `testing` skill.

## 3. Run the app

```sh
pnpm install
pnpm turbo dev --filter=@margaya/api --filter=@margaya/web   # API + web only
pnpm dev                                                     # every package with a dev script
```
- API: `tsx watch src/index.ts`, http://localhost:1337 (`PORT` overrides), reloads on API source changes.
- Web: Vite on http://localhost:5173 with HMR (`MARGAYA_DISABLE_HMR=true` turns HMR off).
- Plain `pnpm dev` also starts the docs site (`next dev -p 3001`), the email preview (`email dev --port 3002`) and the MCP package in watch mode. Prefer the filtered command unless you need those.
- `turbo dev` builds workspace dependencies once at start. `@margaya/email`, `@margaya/permissions` and `@margaya/editor-schema` are consumed from `dist/`, so after editing one run `pnpm --filter <name> build` and let the API restart.

Health check (no auth): `curl http://localhost:1337/api/health` returns `{"status":"ok"}`. The web app is up when http://localhost:5173 loads.

Demo data: with the API running, `pnpm db:seed` (`tests/e2e/scripts/seed.ts`, target `dev`) creates the demo accounts and projects through the HTTP API. It writes into whatever database your dev API uses; keep that a local, disposable one.

## 4. Optional services

- **Redis.** Not required: without it WebSocket fan-out is in-memory (single API instance). To exercise multi-instance delivery, run a local Redis or Valkey (the commented `redis` service in `compose.local.yml` shows the image) and set `REDIS_URL=redis://localhost:6379`. Sentinel and Cluster variables are in `ENVIRONMENT_SETUP.md`. Test realtime both ways when you touch `apps/api/src/ws`.
- **Uploads.** Work without S3: files go to the local store (`MARGAYA_STORAGE_DIR`, default `./data/uploads` under `apps/api`). `S3_ENDPOINT` + `S3_BUCKET` switch to S3; `MARGAYA_LOCAL_STORAGE=false` turns the local store off (uploads answer 503). Use a local MinIO for S3 work, as in `tests/storage-integration/README.md`.
- **pgvector** (semantic search only): `docker compose -f compose.yml -f compose.pgvector.yml up -d` swaps the Postgres image; see the header of `compose.pgvector.yml` for the `REINDEX` note when switching an existing volume.
- **Local AI model:** `docker compose --profile ai-local up -d` starts the `ollama` service (see comments in `compose.yml`).
- **Email capture:** `docker compose -f compose.e2e.yml up -d` runs MailPit (SMTP 127.0.0.1:1025, UI http://127.0.0.1:8025).
- **Docs site:** `pnpm --filter @margaya/site dev` on http://localhost:3001/docs.
- **Desktop app:** with the API and web app running, `pnpm --filter @margaya/desktop tauri dev` opens the shell (its launcher dev server uses port 1420); add `http://localhost:1337` in the launcher. It needs Rust plus MSVC on Windows or the Xcode Command Line Tools on macOS. Details, including deep links in dev and the no-admin Windows fallback, are in the `desktop-app` skill.

## 5. Containers and images

- `compose.yml`: production-style bundle, image `ghcr.io/manu14357/margaya:latest` + Postgres, reads `.env`, web and API both behind :5173, health at http://localhost:5173/api/health.
- `compose.local.yml`: builds `apps/api/Dockerfile` (:1337), `apps/web/Dockerfile` (:5173) and `apps/site/Dockerfile` (:3001) from this checkout. Rebuild one after a change: `docker compose -f compose.local.yml up -d --build api`.
- `Dockerfile.margaya`: the bundled image (nginx serving the web build, API behind it, `HEALTHCHECK` on `/api/health`). Smoke-build it as CI does: `docker build -f Dockerfile.margaya -t margaya:local .`
- `compose.coolify.yml` and `charts/margaya` are deployment surfaces; validate them only when you change them.

## 6. Stop what you started

`docker compose -f <file> stop <service>` for services you started (not `down -v`, which deletes volumes and data). Stop dev servers by the PID or terminal you recorded. Leave anything you did not start running.

## Done when

- [ ] `curl http://localhost:1337/api/health` returns `{"status":"ok"}` (or `:5173/api/health` for the bundled image).
- [ ] The web app loads at http://localhost:5173 and can sign in.
- [ ] No value from `.env`, `.env.local` or `creds.md` was printed, copied or committed.
- [ ] Every process and container you started is stopped (or deliberately left running and reported).
