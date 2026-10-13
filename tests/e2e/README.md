# Margaya end-to-end tests

Playwright tests that drive the real API and web app against their own
database, `margaya_e2e`. LOCAL DEVELOPMENT AND TESTING ONLY: accounts,
passwords and secrets here are public.

```bash
docker compose -f compose.e2e.yml up -d   # MailPit (global setup also tries this)
pnpm e2e                                  # headless, Microsoft Edge
pnpm e2e:ui                               # Playwright UI mode
pnpm --filter @margaya/e2e test:headed    # watch the browser
pnpm e2e specs/app/board                  # one folder or file
pnpm --filter @margaya/e2e report         # open the last HTML report
pnpm --filter @margaya/e2e db:reset       # recreate margaya_e2e after migrations change
```

Requires the `margaya-test-pg` Postgres container on `127.0.0.1:55432` and
Microsoft Edge. Account details: [`creds.md`](../../creds.md).

## What a run does

1. `webServer` starts the API (`tsx src/index.ts`, port 3337, database
   `margaya_e2e`, created if missing) and Vite (port 5174), and stops them after
   the run. Outside CI, servers already listening on those ports are reused.
2. `global-setup.ts` makes sure MailPit is up, waits for both servers and runs
   the seed (`seed/seed.ts`) through the public HTTP API only.
3. The seed is idempotent. It signs in (or signs up) the four users, then finds
   or creates the workspace, memberships, labels, projects, columns, estimates,
   tasks, cycles and modules. It writes one storage state per role and
   `seed.json` (every seeded id) to `tests/e2e/.auth/` (gitignored).

The API runs with SMTP pointed at MailPit, `DISABLE_EMAIL_OTP_SIGN_IN=true`
(the sign-in page shows the password form), registration enabled and
`MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS=true`. See `helpers/env.ts`.

## Layout

```
tests/e2e/
  playwright.config.ts   projects, web servers, reporters
  global-setup.ts        MailPit, database, servers, seed
  fixtures/index.ts      test, expect, asRole, asAnonymous and the fixtures below
  helpers/
    env.ts               ports, URLs, server environments
    auth.ts              authFile(role), loadSeedManifest()
    http.ts              createApiContext, readJson, ApiError, waitForUrl
    ui.ts                signInViaUI, signOutViaUI, openProjectBoard,
                         projectBoardPath, uniqueName
    mailpit.ts           MailpitClient, extractLinks, extractCode
    webhook-sink.ts      startWebhookSink
    database.ts          ensureDatabase, resetE2eDatabase
  seed/
    data.ts              SEED_USERS, SEED_WORKSPACE, SEED_LABELS, SEED_PROJECTS
    seed.ts              runSeed() and the SeedManifest type
  scripts/               seed.ts (pnpm db:seed), ensure-database.ts, reset-database.ts
  specs/
    smoke/               proves the harness: UI sign-in/out, board, API
    app/                 web UI flows, one folder per area (board, tasks, cycles, ...)
    api/                 public HTTP API behaviour and authorization per role
    notifications/       emails (MailPit), webhooks and other outgoing deliveries
    docs-site/           the public site on :3001; opt-in project, see below
```

## Fixtures

Import from `fixtures`, never directly from `@playwright/test`:

```ts
import { asRole, expect, test } from "../../fixtures";
```

| Fixture | What it gives you |
| --- | --- |
| `page` | Signed in as the **owner** by default. |
| `seed` | The `SeedManifest`: `seed.workspace.id`, `seed.users.member.id`, `seed.projects.web.tasks.hero.id`, `seed.projects.web.cycles.current.id`, `seed.labels.bug.id`, `seed.projects.web.estimate.points["3"]` and so on. |
| `api` | `APIRequestContext` signed in as the owner. Its baseURL is the **API** (`http://localhost:3337`), so call `api.get("/api/project", { params: { workspaceId } })`. |
| `apiAs(actor)` | Same, for `"owner" \| "admin" \| "member" \| "viewer" \| "anonymous"`. Use it for permission matrices. |
| `pageAs(actor)` | A page in a new browser context for another role, for realtime and multi-user specs. |
| `mailpit` | `MailpitClient`: `waitForMessage({ to, subject, since })`, `search`, `deleteMatching`. |
| `webhookSink` | A local HTTP receiver (`sink.url`, `sink.waitForRequest(pred)`, `sink.requests`), closed after the test. |

Switch the default browser identity for a whole file or describe block:

```ts
test.use(asRole("viewer"));   // or asAnonymous
```

## Conventions

- Locators are role- and text-based (`getByRole`, `getByLabel`, `getByText`,
  `getByPlaceholder`), with the exact English copy from `i18n/en-US.json`. Do
  not add test ids or otherwise change app code for tests. When the UI lacks an
  accessible name, prefer a text fallback and report the gap.
- Treat seeded data as read-mostly. Create what you mutate or delete, with
  `uniqueName("Task")`, so specs can run in parallel and re-run on the same
  database. Never rename, archive or delete seeded entities, and never change
  seeded memberships or roles.
- Never sign out with a shared storage state: signing out revokes that session
  for every later spec. Sign in fresh (`test.use(asAnonymous)` and
  `signInViaUI`) or use `pageAs`, as `specs/smoke/auth.spec.ts` does.
- Seeded cycles in project WEB cover today -7 to +21 days, and cycle dates may
  not overlap. Create extra cycles far in the future or in a project you create.
- Seeded project `WEB` has every planning feature on and a "Story points"
  estimate; `MOB` has estimates off. The board columns of `WEB` are Backlog,
  To Do, In Progress, In Review, Done.
- Files run in parallel (3 workers locally, set `E2E_WORKERS` to change it);
  tests inside a file run in order.
- Emails: filter by recipient and `since: new Date()` taken before the action,
  because MailPit keeps messages across runs.
- API assertions: check the status code and the body, and cover the reverse
  state (assign/unassign, create/delete) where it exists.

## Projects

- `msedge` (default): every spec except `docs-site/`.
- `chromium`: opt-in with `E2E_CHROMIUM=1`, after `npx playwright install chromium`.
- `docs-site`: opt-in with `E2E_DOCS_SITE=1`, which also starts `apps/site` on
  port 3001: `E2E_DOCS_SITE=1 pnpm e2e --project=docs-site` (PowerShell:
  `$env:E2E_DOCS_SITE=1; pnpm e2e --project=docs-site`).

## Troubleshooting

- API fails to boot with `relation ... already exists`: the migrations changed
  under `margaya_e2e`. Stop the e2e servers and run
  `pnpm --filter @margaya/e2e db:reset`.
- `... already exists with a different password`: a seeded account was changed.
  Reset the database.
- A stale server on 3337 or 5174 is reused outside CI. Stop it if it runs old
  code or another configuration.
