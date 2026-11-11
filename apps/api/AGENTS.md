# API agent guide (`apps/api`)

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds what is specific to the Hono API and does not repeat it.

## Feature folders and mounting

A feature lives in `src/<feature>/`. `src/label/` is a compact example:

- `index.ts`: `createRoute` definitions plus one `apiRouter()` chain of `.openapi(route, handler)` calls, exported as default. Handlers read `c.req.valid(...)` and `c.get("userId")`, then call a controller.
- `schema.ts` (request), `response.ts` (response), `controllers/<action>.ts` (one default-exported function each, using `db` and `HTTPException`).
- Use `jsonResponse` and `errorResponse` from `src/openapi.ts`, and `responseTimestamp` / `nullableResponseTimestamp` for dates.

Mounting a new router in `src/index.ts` takes three edits: `const fooApi = api.route("/foo", foo)` inside `createApp()`, add `fooApi` to the object `createApp()` returns and to the destructuring of `createdApp`, and add `| typeof fooApi` to `AppType`. Skipping the last one leaves the route out of the typed client in `@margaya/libs`. Skill: `api-endpoint`.

## Authorization

- Every `/api/*` route except MCP, A2A, `/.well-known/` and the billing webhook runs behind `authenticateApiRequest` (`src/utils/authenticate-api-request.ts`), which sets `userId`, `user`, `session` and, for API keys, `apiKey`.
- Workspace routes chain middleware in this order: a resolver from `workspaceAccess` (`src/utils/workspace-access-middleware.ts`: `fromParam`, `fromBody`, `fromQuery`, `fromProject`, `fromTaskId`, `fromLabel` ...), then `requireWorkspacePermission({ resource: ["action"] })` from `src/utils/require-workspace-permission.ts`. The resolver sets `workspaceId`; without it the permission check throws 500. Custom resolvers (for example `cycleAccess` in `src/cycle/access.ts`) call `validateWorkspaceAccess` and set `workspaceId` and `projectId` themselves.
- In-handler checks: `hasWorkspacePermission` or `workspacePermissionChecker`. Account-sensitive routes: `requireUserSession` (rejects API keys). Instance admin routes: `requireInstanceAdmin` in `src/instance-admin/middleware.ts`.
- Restricted projects: reads must hide projects the caller cannot see, using `src/project/visibility.ts` (`canSeeProject`, `requestHiddenProjectIds`, `projectVisibleSql`). A hidden entity answers 404, never 403.
- Planning features are gated per project with `requireProjectFeature` (`src/project/features.ts`); paid features with `requireEntitlement` (`src/billing/require-entitlement-middleware.ts`).
- New permission resources go in `@margaya/permissions`; existing roles pick them up through `backfillRolePermissions` at startup. Skill: `permissions`.

## Events and realtime

- `publishEvent(type, data)` in `src/events/index.ts` is an in-process `EventEmitter`. It does not cross API instances. It is fire-and-forget: subscriber errors are logged and swallowed. Pass `{ waitForHandlers: true }` only when a bounded producer must wait.
- `publishEvent` adds `initiatorId` from `eventContext`, so the sender's own window can skip its echo.
- Subscribers are side-effect modules (`<feature>/subscribers.ts`) imported by their feature's `index.ts` (for example `import "./subscribers"` in `src/notification/index.ts`). An unimported subscriber never runs.
- `src/ws/index.ts` maps events to WebSocket hints. For a new event to reach the board, add it to a mapped list there (for example `taskUpdateEvents`) and handle the hint in `apps/web/src/hooks/use-project-websocket.ts`. Hints carry only a type and ids; clients refetch. Never put entity data in them.
- `broadcastToProject` batches per project and dedupes by type and ids; `broadcastToUser` serves `/api/ws/user`. Socket routes: `/api/ws/:projectId`, `/api/ws/user`, `/api/ws/page/:pageId`.
- `initializeWebSocketAdapter` picks `RedisBroadcastAdapter` when `REDIS_URL`, `REDIS_SENTINELS` or `REDIS_CLUSTER_NODES` is set, otherwise `InMemoryBroadcastAdapter`. Only socket delivery uses Redis. Shared background work uses PostgreSQL queues (`FOR UPDATE SKIP LOCKED` in `src/ai-agent/runner.ts`). Skill: `realtime-events`.

## Database

- Tables: `src/database/schema.ts` (`fooTable` exports). Relations: `src/database/relations.ts`. Import `db` (default) and `schema` from `src/database`.
- Generate with `pnpm --filter @margaya/api db:generate --name <slug>`; SQL lands in `apps/api/drizzle/` as the next numbered file with a `meta/` snapshot and journal entry. Read the SQL before keeping it.
- Never edit or renumber a committed migration. Fix mistakes with a new migration. Startup runs every pending migration automatically (`runStartupTasks` in `src/index.ts`), so new columns on existing tables need a default or must be nullable.
- Data repairs and backfills that SQL cannot express go in `src/migrations/*.ts` and are called from `runStartupTasks`. They run on every boot of every instance, so they must be idempotent and safe to run concurrently. Skill: `database-migration`.

## AI code

- AI is off by default: instance setting `ai.enabled` (`MARGAYA_AI_ENABLED`, default false), then the workspace (`DEFAULT_WORKSPACE_AI_POLICY.enabled` is false), then `project.ai_enabled`, then the `ai: ["use"]` permission. Routes chain `workspaceAccess`, `requireAiUse` and `requireAiEnabled()` from `src/ai/access.ts`.
- Call models only through `src/ai/gateway.ts` (`aiStream`, `aiComplete`, `aiCompleteJson`, `aiEmbed`). It enforces the switches, routes by data tier (`src/ai/router.ts`: `public`, `private`, `restricted`; local-only mode sends everything to the local endpoint), checks budgets, redacts PII when configured and writes the `ai_usage` ledger (counts only, `src/ai/usage.ts`). Provider SDKs stay in `src/ai/provider/`.
- Build model context with the loaders in `src/ai/context.ts` so it holds only what the caller may see, and wrap workspace content with `wrapUntrusted` / `buildSystemPrompt` from `src/ai/prompt.ts`.
- A new feature name goes in `AI_FEATURES` (`src/ai/features.ts`) plus its web translation `ai:features.<name>` before its first call.
- Agents (`src/ai-agent/`) act through the API with a run key whose rights are the agent's role intersected with the invoker's (`rights.ts`). Skill: `ai-feature`.

## Integrations and MCP

- Integration plugins live in `src/plugins/<name>/` and are registered in `initializePlugins()` (`src/plugins/index.ts`). Skill: `integration-plugin`.
- MCP tools call the API's own routes (`registerMcpTools` in `src/mcp/tools.ts`). `src/mcp/planning-tools.ts` must stay byte-identical to `packages/mcp/src/tools/planning-tools.ts`; `tests/api/mcp-planning-tools.test.ts` enforces it. Skill: `mcp-tool`.

## Gotchas

- Declaring a non-2xx response widens an untagged `InferResponseType` in the web app; those call sites must use `InferResponseType<T, 200>`.
- Read-only API keys may only use safe methods plus the POST paths in `READ_ONLY_POSTS` (`src/api-key/scope.ts`). A new read-style POST must be listed there.
- `apiRouter()`'s `defaultHook` turns validation failures into a 400 text body `field: message`, not JSON. `HTTPException` responses are text too; only unexpected errors become a JSON 500.
- The desktop app's Rust core authenticates with `Authorization: Bearer <token>`, not cookies, for `/api/ws/user`, `/api/notification/{id}/desktop` and the few routes it calls. Keep bearer auth and those response shapes working for installed shells, and keep `/api/config`'s `desktop` block public-safe. Skill: `desktop-app`.
- Register literal paths before parameter paths on the same router (`/ws/user` precedes `/ws/:projectId` in `src/index.ts`), or the parameter route captures them.

## Checks

From the repo root:

- `pnpm --filter @margaya/api typecheck`
- `pnpm --filter @margaya/api test:unit` runs `tests/api/**` (mocked `db`, folders mirror features such as `tests/api/label/`). Append a path filter to narrow it: `pnpm --filter @margaya/api test:unit tests/api/label`.
- `pnpm --filter @margaya/api test:integration` runs `tests/api-integration/**` against real PostgreSQL. `setup.ts` appends `_test` to the database name and refuses any other database. Helpers live in `tests/api-integration/helpers/`.
- `tests/storage-integration/` has its own config and README; it needs a disposable local S3 service.

Skill for choosing and writing tests: `testing`.
