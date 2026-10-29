---
name: api-endpoint
description: Step-by-step workflow for adding or changing a Hono API route in apps/api, from createRoute and Zod schemas through authorization, events, the committed openapi.json, the API reference page and the typed web client. Use when adding, renaming or changing an API route, endpoint, request body, response shape or route middleware.
---

# API endpoint

Turns the API rows of the root [AGENTS.md](../../../AGENTS.md) "Follow a change through" list into concrete steps. The label feature is the reference: `apps/api/src/label/`.

## 1. Request and response schemas

- Request schemas go in the feature's `schema.ts`. They import `z` from `../openapi`, not straight from `zod`. Example: `apps/api/src/label/schema.ts` (`createLabelBody`, `labelParam`).
- Response schemas go in `response.ts`, named with `.openapi("Name")` so they become reusable components. Example: `labelSchema` and `pendingLabelDeletionSchema` in `apps/api/src/label/response.ts`.
- Dates: use `responseTimestamp` or `nullableResponseTimestamp` from `apps/api/src/openapi.ts`.
- Never put secrets or internal fields in a response schema. Integrations return booleans and masked values instead (see `maskedWebhookUrl` in `apps/api/src/mattermost-integration/response.ts`).

## 2. The route

Define the route with `createRoute` and the helpers from `apps/api/src/openapi.ts` (`jsonResponse`, `errorResponse`). Copy the shape of `createLabelRoute` in `apps/api/src/label/index.ts`:

```ts
const createLabelRoute = createRoute({
  method: "post",
  operationId: "createLabel",          // unique; it names the docs page
  path: "/",
  tags: ["Labels"],
  summary: "Create label",
  description: "Create a new label in a workspace",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ label: ["create"] }),
  ] as const,
  request: { body: { required: true, content: { "application/json": { schema: createLabelBody } } } },
  responses: {
    200: jsonResponse("Label created successfully", labelSchema),
    403: errorResponse("No workspace access, or missing label:create permission"),
  },
});
```

- **Middleware runs before the validators.** It must read the raw request, never `c.req.valid()`. This is why `workspaceAccess.*` reads params, query or body itself.
- Pick the `workspaceAccess` resolver that matches the input: `fromBody`, `fromParam`, `fromQuery`, `fromProject`, `fromTask`, `fromTaskId`, `fromLabel` and others in `apps/api/src/utils/workspace-access-middleware.ts`. It sets `workspaceId` (and project ids) for the checks after it.
- Put `requireWorkspacePermission({ resource: ["action"] })` from `apps/api/src/utils/require-workspace-permission.ts` after it. It also enforces API key scopes and restricted-project role ceilings. Do not write your own role checks. A new permission is the [permissions](../permissions/SKILL.md) skill.
- List every status the route can return. A non-2xx response widens the untagged `InferResponseType` on the web, so web call sites must use `InferResponseType<T, 200>`.
- Validation failures already answer 400 through `defaultHook` in `apiRouter()`.

## 3. Handler and controller

- Mount the route with `.openapi(route, handler)` on `apiRouter()`. Keep the handler thin: read `c.req.valid(...)` and `c.get("userId")`, call a controller, return `c.json(result, 200)`. See the `label` router at the bottom of `apps/api/src/label/index.ts`.
- Domain logic lives in `controllers/<verb>-<noun>.ts` (e.g. `apps/api/src/label/controllers/create-label.ts`).
- Throw `HTTPException` from `hono/http-exception` for expected failures. Something in a restricted project the caller cannot see answers **404, not 403** (`canSeeProject`, `assertProjectVisible` in `apps/api/src/project/visibility.ts`). Workspace-wide lists filter with `requestHiddenProjectIds(c)`, as `getWorkspaceLabelsRoute` does.
- If the mutation should drive activity, notifications, integrations, webhooks or realtime, call `publishEvent()` from `apps/api/src/events` after the write (`create-label.ts` publishes `task.label_created`). Follow it through with the [realtime-events](../realtime-events/SKILL.md) skill.
- A schema change belongs to the [database-migration](../database-migration/SKILL.md) skill.

## 4. Mount a new router (new features only)

In `apps/api/src/index.ts`:
1. Import the router, then mount it next to the others: `const labelApi = api.route("/label", label);`.
2. Add `| typeof labelApi` to `export type AppType`. Without this the typed client in `packages/libs/src/hono.ts` cannot see the routes.
3. If the path is an integration (`/api/<provider>-integration/project/...`), check `PROVIDERS` in `apps/api/src/audit-log/http-rules.ts`.

## 5. Regenerate the OpenAPI document

`apps/docs/openapi.json` is committed and CI runs `pnpm openapi:check`. After any route or schema change:

```sh
pnpm openapi:check:fix
```

It builds the API's workspace dependencies, runs `apps/api/scripts/export-openapi.ts`, and overwrites the file. Read the diff. It should show only your operations and components.

## 6. API reference page

Each operation needs a page. `tests/e2e/specs/docs-site/api-reference.spec.ts` fails on "every operation in openapi.json has a reference page".
- Create `apps/docs/api-reference/endpoints/<group>/<operationId>.mdx`, copying `apps/docs/api-reference/endpoints/labels/createLabel.mdx`:
  ```mdx
  ---
  title: createLabel
  description: Create a new label in a workspace
  openapi: 'POST /label'
  ---
  ```
  The `openapi:` value is the method plus the path without `/api`.
- Add `api-reference/endpoints/<group>/<operationId>` to the matching group in `apps/docs/docs.json`. A page that is not in the navigation does not count.
- Add `covers("<operationId>")` to a spec in `tests/e2e/specs/api/`. `tests/e2e/specs/api/coverage.spec.ts` fails for uncovered operations. See `tests/e2e/specs/api/labels.spec.ts`.

## 7. Web consumers

- Fetcher in `apps/web/src/fetchers/<feature>/`, using `client` from `@margaya/libs` and `HttpError` from `@/lib/http-error`. Example: `apps/web/src/fetchers/label/create-label.ts`.
- Query hooks go in `apps/web/src/hooks/queries/<feature>/` and mutation hooks in `apps/web/src/hooks/mutations/<feature>/`. Update or invalidate every cache key the change touches. `apps/web/src/hooks/mutations/label/use-create-label.ts` sets the `["labels", workspaceId]` and `["labels", taskId]` caches and invalidates `["activities", taskId]`.
- Gate UI with `useWorkspacePermission()` (`apps/web/src/hooks/use-workspace-permission.ts`). That only hides UI; the route stays the authority.
- User-facing copy uses static i18n keys from `i18n/en-US.json`, translated in every locale file (`pnpm i18n:check`).
- If MCP clients should reach the route, see the [mcp-tool](../mcp-tool/SKILL.md) skill.

## 8. Tests

- Unit (mocked database): `tests/api/<feature>/`, e.g. `tests/api/label/assign-and-unassign-label.test.ts`.
- Integration (real PostgreSQL, real routing and auth): `tests/api-integration/<feature>.test.ts`, e.g. `tests/api-integration/label.test.ts`. Use `createApp()`, `resetTestDatabase()`, `createWorkspaceMember()` and `createProjectFixture()` from `tests/api-integration/helpers/`, and `mockAuthenticatedSession()` / `mockAnonymousSession()` from `helpers/auth.ts`. Cover 401, 403 (missing permission), 404 (hidden project) and the success path.

## Done when

- [ ] `pnpm --filter @margaya/api test:unit tests/api/<feature>` passes
- [ ] `pnpm --filter @margaya/api test:integration tests/api-integration/<feature>.test.ts` passes (needs PostgreSQL; the database name must end in `_test`)
- [ ] `pnpm --filter @margaya/api typecheck` and `pnpm --filter @margaya/web typecheck` pass
- [ ] `pnpm openapi:check` reports `apps/docs/openapi.json is up to date`
- [ ] Every new operation has an `.mdx` page listed in `apps/docs/docs.json` and a `covers()` entry
- [ ] `pnpm i18n:check` passes if web copy changed
