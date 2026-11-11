---
name: testing
description: Choose and run the smallest test that proves a Margaya change - API unit tests (tests/api), PostgreSQL integration tests (tests/api-integration), web/package vitest tests, Playwright e2e (tests/e2e), storage contract tests, and typechecks - with exact single-file commands. Use when writing or running tests, verifying a fix, deciding what proof a change needs, or when CI's unit, integration or typecheck job fails.
---

# Testing

Purpose: pick the smallest proof for the change, run just that, then widen only as far as the blast radius needs. Root rules: [AGENTS.md](../../../AGENTS.md) "Verification".

## Choose

| Change | Smallest proof | Example to copy |
| --- | --- | --- |
| Pure API helper, controller logic with mocked DB | `tests/api/<feature>/*.test.ts` | `tests/api/label/assign-and-unassign-label.test.ts` |
| Routing, auth, permissions, SQL, migrations, events | `tests/api-integration/*.test.ts` | `tests/api-integration/label.test.ts`, `trash-tasks.test.ts` |
| Web fetcher, hook, component, util | `apps/web/src/**/*.test.ts(x)` next to the file | `apps/web/src/components/trash/trash-views.test.tsx` |
| Shared package | that package's `src/**/*.test.ts` | `packages/libs/src/hono.test.ts` |
| Full user flow, realtime between users, emails, webhooks | `tests/e2e/specs/**.spec.ts` | `tests/e2e/specs/app/tasks/trash.spec.ts` |
| S3 presigned upload contract | `tests/storage-integration` | `presigned-upload.test.ts` |
| Desktop shell (Rust core, launcher) | `cargo test` and the launcher's vitest in `apps/desktop` | below |
| Types across packages | turbo typecheck | below |

## API unit tests (`tests/api`)

Run by `apps/api/vitest.config.ts` (node env, `AUTH_RATE_LIMIT_ENABLED=false`). Paths are relative to `apps/api`:
```sh
pnpm --filter @margaya/api exec vitest run --config vitest.config.ts ../../tests/api/label
pnpm --filter @margaya/api exec vitest run --config vitest.config.ts ../../tests/api/label/assign-and-unassign-label.test.ts
pnpm --filter @margaya/api test:unit          # whole suite
```

## API integration tests (`tests/api-integration`)

Real Hono app (`createApp()` from `apps/api/src/index.ts`) against real PostgreSQL. Config: `apps/api/vitest.integration.config.ts` (serial, 60 s timeouts, `@margaya/email` replaced by `tests/api-integration/mocks/email.ts`).

- **Database.** `tests/api-integration/setup.ts` takes `DATABASE_URL` from the environment, else from the root `.env`, else `postgresql://postgres:postgres@localhost:5432/margaya_test`. It appends `_test` to the database name when missing and refuses any name not ending in `_test`. `helpers/database.ts` creates that database if needed, runs the Drizzle migrations from `apps/api/drizzle`, and `resetTestDatabase()` truncates every table. So it never touches your dev data, but it does need a reachable local Postgres. Never point it at a shared or production server.
- **Env.** `setup.ts` sets everything else (auth secret, URLs, SMTP and OAuth blanked, rate limits off) and stops `dotenv-mono` from loading `.env`.
- **Pattern.** `beforeEach(resetTestDatabase)`, fixtures from `helpers/fixtures.ts` (`createWorkspaceMember`, `createProjectFixture`), auth from `helpers/auth.ts` (`mockAuthenticatedSession`, `mockAnonymousSession`), then `app.request("/api/...")`. Cover the 401/403 path and the reverse action.
```sh
pnpm --filter @margaya/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/label.test.ts
pnpm --filter @margaya/api test:integration   # whole suite (long)
```
CI (`.github/workflows/ci.yml`, job `integration`) uses a `postgres:16` service with database `margaya_test` and runs `pnpm test:integration`.

## Web and package tests (vitest)

`apps/web/vitest.config.ts`: jsdom, setup `src/test/setup.ts` (jest-dom), aliases `@` and `@i18n`. CI runs unit tests with `NODE_OPTIONS=--no-experimental-webstorage` so jsdom provides `localStorage`; do the same if storage-related tests fail.
```sh
pnpm --filter @margaya/web exec vitest run --config vitest.config.ts src/hooks/mutations/label/use-update-label.test.tsx
pnpm --filter @margaya/web test
```
Other packages with a `test` script: `@margaya/libs`, `@margaya/email`, `@margaya/permissions`, `@margaya/editor-schema`, `@margaya/landing`, `@margaya/mcp`, `@margaya/site`. Single file: `pnpm --filter <name> exec vitest run --config vitest.config.ts <path>`.

## End-to-end (`tests/e2e`, Playwright)

Read `tests/e2e/README.md` first; it is current on fixtures and conventions. Essentials:
- Own database `margaya_e2e` on a local Postgres at `127.0.0.1:55432` (see `E2E_DATABASE_URL` in `tests/e2e/helpers/env.ts`; the README calls the container `margaya-test-pg`, and no compose file in the repo defines it). MailPit from `docker compose -f compose.e2e.yml up -d`. Microsoft Edge installed.
- `playwright.config.ts` starts the API on :3337 and the web app on :5174. Default web mode is a production build served by `vite preview` (about a minute to build; edits are not picked up mid-run). `E2E_WEB_SERVER=dev` uses the Vite dev server instead, better while iterating on one spec. Outside CI, servers already on those ports are reused: stop stale ones you started.
- `global-setup.ts` seeds through the HTTP API (`tests/e2e/seed/seed.ts`), idempotently.
- Import `test`, `expect`, `asRole` from `tests/e2e/fixtures`, use role/text locators with the exact en-US copy, create what you mutate with `uniqueName()`.
```sh
pnpm e2e specs/app/tasks/trash.spec.ts                      # one file (path relative to tests/e2e)
E2E_WEB_SERVER=dev pnpm e2e specs/app/tasks/trash.spec.ts   # PowerShell: $env:E2E_WEB_SERVER="dev"; pnpm e2e ...
pnpm e2e specs/api                                          # one folder
pnpm --filter @margaya/e2e db:reset                         # after migrations change under margaya_e2e
pnpm --filter @margaya/e2e report                           # last HTML report
```
`pnpm test` at the root excludes e2e; CI's `ci.yml` does not run it.

## Storage contract tests

Disposable MinIO on loopback only, with the fixed test credentials in `tests/storage-integration/README.md`. Follow that README exactly; then:
```sh
MARGAYA_STORAGE_TEST_ENDPOINT=http://127.0.0.1:59039 pnpm --filter @margaya/api exec vitest run --config vitest.storage.config.ts
```
Stop the container you started afterwards.

## Desktop app (`apps/desktop`)

The Rust tests need a Rust toolchain (see the `desktop-app` skill). None of these needs a running server:
```sh
pnpm --filter @margaya/desktop test                            # launcher and quick add (vitest)
pnpm --filter @margaya/desktop build                           # the Rust build embeds the launcher's dist/
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```
CI's `desktop` job runs the same, with `cargo test --locked` on Ubuntu; Linux is a shipping platform, and Linux-only tests (the sound file, the dock badge) run only there. On a Windows machine, a Rust change needs both: the native (or GNU) `cargo test`, and a Linux run in Docker (`ubuntu:22.04` with the Tauri libraries; the `desktop-app` skill has the recipe). A bundling change (tauri.conf.json, icons, the .desktop template) also needs a real `tauri build` of the AppImage, .deb and .rpm there, checked with `dpkg-deb -I`/`-c`, `rpm -qpR` and the bundled .desktop file. The server half of the desktop contract (desktop sign-in, bearer `/api/ws/user`, notification text, `/api/config`) is tested in `tests/api`, `tests/api-integration` and `tests/e2e/specs/api/desktop.spec.ts`, and bridge feature detection and the title bar in `apps/web` tests (`src/lib/desktop.test.ts`, `src/components/desktop/desktop-title-bar.test.tsx`). Without Rust installed, report the desktop tests under what did not run.

To drive a real desktop build, never use the installed app (the person may be running it; do not attach to, drive or stop it). Build your own with the `e2e` feature and a separate identifier, so outside opens go to a log file instead of the browser and the build has its own data, single-instance lock and keychain entries:
```sh
pnpm --filter @margaya/desktop tauri build --features e2e --config '{"identifier":"com.margaya.desktop.e2e"}'
# run it with MARGAYA_E2E_OPEN_LOG=<file>; record its PID and stop only that
```

## Typecheck

Turbo builds the dependencies first (`typecheck` depends on `^build`):
```sh
pnpm turbo typecheck --filter=@margaya/web
pnpm turbo typecheck --filter=@margaya/api
pnpm typecheck          # everything, as CI does
```
An API type change reaches the web app through `@margaya/libs`, so typecheck `@margaya/web` after changing API routes or response shapes.

## Done when

- [ ] The new or changed behavior has a test that fails without the change.
- [ ] The focused test file(s) pass with the commands above; report the exact commands.
- [ ] Every affected package typechecks.
- [ ] Widened when needed: integration for auth/permissions/SQL, e2e for cross-user realtime or full flows.
- [ ] You say what you did not run (e.g. no Postgres available, e2e skipped), never imply it passed.
- [ ] Only processes and containers you started were stopped; no production database, storage or credentials used.
