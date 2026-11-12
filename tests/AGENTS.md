# tests

Cross-app test suites. Web, site and package unit tests live next to their source instead. Follow the root [AGENTS.md](../AGENTS.md) for what proof a change needs; skill: `testing` (and `local-stack` for the services).

| Folder | Kind | Runner config | Command (repo root) |
| --- | --- | --- | --- |
| `api/` | API unit tests, no database | `apps/api/vitest.config.ts` | `pnpm --filter @margaya/api test` |
| `api-integration/` | Hono app plus real PostgreSQL | `apps/api/vitest.integration.config.ts` | `pnpm --filter @margaya/api test:integration` |
| `e2e/` | Playwright against a real API and web build | `e2e/playwright.config.ts` | `pnpm e2e` |
| `storage-integration/` | S3 contract tests against local MinIO | `apps/api/vitest.storage.config.ts` | see its `README.md` |

`pnpm test` runs every unit suite except e2e. CI runs `pnpm test:integration` against a Postgres service, and the e2e smoke specs (`pnpm e2e specs/smoke`) against Postgres and MailPit services.

## Shared rules

- The API suites import API code by relative path (`../../apps/api/src/...`) and run from `apps/api`. Run one file or folder with `pnpm --filter @margaya/api exec vitest run --config vitest.config.ts task/` (swap in `vitest.integration.config.ts` for integration).
- `tsc` does not check these folders (the API typecheck covers `apps/api/src` only), so a type error in a test surfaces only at runtime.
- Never point any suite at a development, shared or production database or storage service.

## api/ (unit)

- No database. Tests that import modules touching the database mock it, for example `vi.mock("../../../apps/api/src/database", () => ({ default: {} }))`.
- Mirror the API folder layout (`api/task/`, `api/ws/`, `api/redis/`). Realtime and Redis fan-out are unit tested here with the Redis module mocked; no Redis server is needed.

## api-integration/

- `setup.ts` sets every env var the app needs, blocks `.env` loading through `dotenv-mono`, and picks the database: `DATABASE_URL`, else `DATABASE_URL` from the root `.env`, else `postgresql://postgres:postgres@localhost:5432/margaya_test`. A database name without the `_test` suffix gets one appended, and the run refuses any database whose name does not end in `_test`.
- `helpers/database.ts` creates that database if missing (via the server's `postgres` database) and applies the migrations in `apps/api/drizzle`. Call `resetTestDatabase()` in `beforeEach`; it truncates every table.
- Files run one at a time. Route tests build the app with `createApp()` from `apps/api/src/index` and call `app.request("/api/...")`.
- Authenticate with `mockAuthenticatedSession(user)` / `mockAnonymousSession()` from `helpers/auth.ts`. Build data with `helpers/fixtures.ts` (`createWorkspaceMember`, `addWorkspaceMember`, `createProjectFixture`, `assignTask`) and the per-feature helpers next to it before writing new ones. `fixtures/` holds sample CSV and JSON exports for the importer tests.
- `@margaya/email` is aliased to `mocks/email.ts`; add a stub there for any new email export the API calls.
- Cover authorization per role and the reverse state (create/delete, assign/unassign) for new routes.

## e2e/

Read `e2e/README.md` before writing or running specs; it is the reference. The points most often missed:

- Needs Microsoft Edge, MailPit (`docker compose -f compose.e2e.yml up -d`) and a Postgres server for the `margaya_e2e` database at `E2E_DATABASE_URL` in `e2e/helpers/env.ts`. The API runs on 3337 and the web app on 5174.
- The web app is a production bundle built into `e2e/.web-dist/` on each run; `E2E_WEB_SERVER=dev pnpm e2e <path>` uses the Vite dev server instead. Outside CI, servers already on those ports are reused, even if they run stale code.
- `e2e/.auth/` (per-role storage state and `seed.json`) and `e2e/.web-dist/` are generated and gitignored. Never commit them.
- Import `test`, `expect` and `asRole` from `e2e/fixtures`, never from `@playwright/test`. Locate by role and the exact `i18n/en-US.json` copy; do not add test ids to app code.
- Do not mutate seeded entities. Create what you change with `uniqueName(...)`. After migrations change, run `pnpm --filter @margaya/e2e db:reset`.
