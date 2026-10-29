---
name: mcp-tool
description: Workflow for adding or changing an MCP tool in the API's HTTP MCP server (apps/api/src/mcp) and the published stdio package (packages/mcp) - tool registration, input validation, safety annotations, output schemas, the files that must stay byte-identical, auth through API keys and OAuth, tests and the tool lists in the docs. Use when exposing an API capability to MCP clients, or adding, renaming or changing an MCP tool.
---

# MCP tool

Margaya ships two MCP servers with the same tool catalog:
- **HTTP**, inside the API at `/api/mcp`: `apps/api/src/mcp/index.ts`, tools in `apps/api/src/mcp/tools.ts` (`registerMcpTools`).
- **stdio**, the published `@margaya/mcp` package: `packages/mcp/src/tools/register.ts` (`registerTools`), API calls through `MargayaClient` in `packages/mcp/src/margaya/client.ts`.

A tool is a thin adapter over an **existing REST route**. It never touches controllers or the database. It calls the API with the caller's own credential, so authorization, API key scopes, restricted projects, events and webhooks behave exactly as for the REST API. If the route does not exist yet, build it first with the [api-endpoint](../api-endpoint/SKILL.md) skill.

## Auth (nothing to add per tool)

- HTTP: `authenticateMcpRequest()` in `apps/api/src/mcp/index.ts` accepts an API key (`Authorization: Bearer <key>` or `x-api-key`, checked with `verifyApiKey`) or a bearer session token. OAuth access tokens issued by the MCP OAuth flow (`apps/api/src/mcp/oauth.ts`, `oauth-store.ts`) are sessions. The tools receive that token and send it on every API call.
- A scoped API key keeps its own limits (`full` / `read` / `custom` areas and project list, `apps/api/src/api-key/scope.ts`). The REST middleware enforces them, so a read-only key gets an error from write tools. There are no separate MCP scopes to maintain.
- stdio: device flow (`packages/mcp/src/auth/device-flow.ts`) or the `MARGAYA_API_KEY` environment variable (see `packages/mcp/README.md`).

## 1. Register the tool (HTTP)

In `registerMcpTools()` in `apps/api/src/mcp/tools.ts`, next to related tools. Copy `get_project` or `create_project`:

```ts
registerTool(
  "get_project",
  {
    description: "Get a single project by ID, including its feature flags (...)",
    inputSchema: z.object({ id: nonEmptyString }),
  },
  async (args) =>
    run(() => client.json(`/api/project/${encodeURIComponent(args.id)}`)),
);
```

- Names are `snake_case` verbs: `list_`, `get_`, `create_`, `update_`, `set_`, `delete_`...
- The `inputSchema` is checked with `safeParse` before any API call. Bad input comes back as an `isError` result and never reaches the API. Mirror the route's limits (max lengths, enums, ISO dates) so the model gets a clear error early.
- `encodeURIComponent` every path segment. Build query strings with `URLSearchParams` and send only the fields that were given (see `list_projects`).
- `run()` turns the API's JSON into a text result plus `structuredContent`, and API failures into an error result.
- Write descriptions for a model: what the tool does, what each argument means, and what it returns.

## 2. Annotations and output schema

- `apps/api/src/mcp/annotations.ts`: add read-only tools to `READ_ONLY`. Add deletes, full replacements, bulk moves and sharing changes to `DESTRUCTIVE`. Names starting `create_`, `update_`, `set_`, `move_`, `attach_`, `detach_`, `restore_` or `submit_` count as known writes. **Any other unknown name is marked destructive.**
- `apps/api/src/mcp/output.ts`: add an entry to `OUTPUT_SCHEMAS` only if the result shape is stable. Use `z.looseObject` so API additions never break clients.

## 3. Mirror it in the stdio package

- Add the same tool, with the same name, schema, description and API call, to `registerTools()` in `packages/mcp/src/tools/register.ts`. It uses `server.registerTool` on the SDK's `McpServer`. Annotations and output schemas are filled in by `withToolAnnotations()`.
- These files must be **byte-identical** in both places. Edit one and copy it over:
  - `apps/api/src/mcp/annotations.ts` and `packages/mcp/src/tools/annotations.ts`
  - `apps/api/src/mcp/output.ts` and `packages/mcp/src/tools/output.ts`
  - `apps/api/src/mcp/planning-tools.ts` and `packages/mcp/src/tools/planning-tools.ts` (cycles, modules, intake...; registered through `registerPlanningTools`). `tests/api/mcp-planning-tools.test.ts` compares them and asserts the length of `PLANNING_TOOL_NAMES`. Update that count when you add a planning tool.
- Do not bump the package version or `packages/mcp/server.json` unless a release is requested (`.github/workflows/publish-mcp.yml` publishes it).

## 4. Docs

Add the tool to its group in both lists:
- `apps/docs/core/integrations/mcp.mdx`, section `## Available tools`
- `packages/mcp/README.md`, section `## Tools`

## 5. Tests

- HTTP catalog (fetch stubbed): `tests/api/mcp-tools.test.ts` collects tools through a fake `McpToolRegistrar`, stubs `fetch`, calls the tool and asserts the exact URL, method and body. Add tests for the request it sends and for input it refuses before calling the API (e.g. "rejects more than 20 assignees before calling the API").
- Planning tools: `tests/api/mcp-planning-tools.test.ts`.
- Protocol and structured output: `tests/api/mcp-compliance.test.ts` (output schemas, `structuredContent`, errors as text).
- Through the real app with an API key: `tests/api-integration/mcp-api-key.test.ts`, and `callMcpTool(app, userId, name, args)` in `tests/api-integration/helpers/trash.ts`. Use these to check that a key without the scope, or a hidden project, is refused.
- stdio: `packages/mcp/src/tools/register.test.ts` (and `output.test.ts`).

## Done when

- [ ] The tool exists in both `apps/api/src/mcp/tools.ts` (or `planning-tools.ts`) and `packages/mcp/src/tools/register.ts`, with the same name and behavior
- [ ] It is classified in `annotations.ts` (not left to the unknown-is-destructive default), and the shared files are identical (`diff apps/api/src/mcp/annotations.ts packages/mcp/src/tools/annotations.ts` prints nothing; same for `output.ts` and `planning-tools.ts`)
- [ ] `pnpm --filter @margaya/api test:unit tests/api/mcp` passes
- [ ] `pnpm --filter @margaya/mcp test` and `pnpm --filter @margaya/mcp build` pass
- [ ] `pnpm --filter @margaya/api test:integration tests/api-integration/mcp-api-key.test.ts` passes when auth or scope behavior matters
- [ ] The tool is listed in `apps/docs/core/integrations/mcp.mdx` and `packages/mcp/README.md`
