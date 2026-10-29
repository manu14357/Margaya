---
name: ai-feature
description: Workflow for adding or changing an AI feature in apps/api - calling models only through the gateway (apps/api/src/ai/gateway.ts), the on/off switches, data tiers and local routing, prompt and data minimisation, the usage ledger and budgets, agent tools with approval and undo (apps/api/src/ai-agent), and tests on the fake provider. Use when adding an AI-powered endpoint, a new agent tool or change type, a new model call, or touching AI privacy, routing or cost.
---

# AI feature

AI is optional and off by default. Every model call goes through one gateway, which checks the switches, routes by data sensitivity, applies budgets and records usage. Read the header comment of `apps/api/src/ai/gateway.ts` first. The smallest complete example is translate-on-read: `apps/api/src/ai-translate/index.ts` (route) and `translate.ts` (call).

## The switches (all must be on)

1. Instance: setting `ai.enabled`, default `false` (`apps/api/src/instance-settings/catalog.ts`; env `MARGAYA_AI_ENABLED`).
2. Workspace: `workspace_ai_setting.enabled` (`saveWorkspaceAiSettings` in `apps/api/src/ai/workspace-settings.ts`).
3. Project: `project.ai_enabled`. Context loaders skip projects with AI off, and the gateway checks every project in context.
4. Caller: permission `ai:use` (`ai:manage` for settings and usage).

The default provider is Anthropic Claude (`ANTHROPIC_DEFAULT_MODELS` in `apps/api/src/ai/instance-config.ts`, tiers `fast` / `balanced` / `deep`). The other providers are an OpenAI-compatible endpoint (`provider/openai-compatible.ts`), also used for the operator's local model, and `provider/fake.ts` for dev and tests.

## 1. Register the feature name

Add the name to `AI_FEATURES` in `apps/api/src/ai/features.ts` (the ledger groups by it), and add `ai.features.<name>` to `i18n/en-US.json` and every other locale file.

## 2. The route

Follow the [api-endpoint](../api-endpoint/SKILL.md) skill, with these middleware, in this order:

```ts
middleware: [workspaceAccess.fromBody(), requireAiUse, requireAiEnabled()] as const,
```

(`requireAiUse` and `requireAiEnabled` come from `apps/api/src/ai/access.ts`.) Declare the AI failure responses with `aiErrorResponse()` from `apps/api/src/ai/sse.ts`, as `translateRoute` does: 403 `AI_DISABLED` / `AI_ROUTE_BLOCKED`, 409 `AI_NOT_CONFIGURED`, 429 `AI_BUDGET_EXCEEDED` / `AI_RATE_LIMITED`, 502 `AI_PROVIDER_ERROR`. Codes live in `apps/api/src/ai/errors.ts` (`AiError`). For streamed answers use `aiStreamResponse()` in the route and `respondWithAi(c, stream)` in the handler (see `apps/api/src/ai-brief/`).

## 3. Load only what the caller may see, and only what is needed

- `const scope = await resolveAiScope(c)` (`apps/api/src/ai/context.ts`), then load with `loadTaskContext(scope, id, { comments: 0 })`, `loadPageContext`, `loadProjectsContext`. These respect restricted projects and per-project AI. Use `filterToScope()` on search results. Something out of scope answers 404.
- Ask for the minimum: fewer comments, a `maxChars` cap, no fields the task does not need. Never send credentials, emails you do not need, or other users' private data.
- Pass what you loaded as `context` to the gateway. The data tier (`public` / `private` / `restricted`) is computed from it. If project data reaches the prompt some other way, pass `projectIds` or raise `dataTier`. A wrong tier can send restricted data to the cloud.

## 4. The prompt

- System prompt: `buildSystemPrompt({ instructions, locale })` from `apps/api/src/ai/prompt.ts`. Instructions come only from code.
- Workspace content is data. Wrap every piece with `wrapUntrusted({ source, author, text, maxChars })`. It neutralizes forged tags and truncates visibly.
- For structured output, use `aiCompleteJson` with a `jsonSchema`, and validate the result before using it (`translate.ts` checks `typeof value?.translation === "string"`).

## 5. Call the gateway

```ts
const { value } = await aiCompleteJson<{ translation?: unknown }>({
  workspaceId, userId, feature: "translate", tier: "fast",
  context: [source.item],
  system: buildSystemPrompt({ instructions: TRANSLATE_INSTRUCTIONS, locale }),
  messages: [{ role: "user", content: wrapUntrusted({ source, text, maxChars }) }],
  jsonSchema: TRANSLATE_JSON_SCHEMA, effort: "low",
});
```

`aiStream` / `aiComplete` / `aiCompleteJson` all:
- refuse when AI is off;
- route by tier through `routeAiCall()` in `apps/api/src/ai/router.ts`: restricted goes `blocked` / `local` / `cloud`, private goes `local` / `cloud`, and local-only mode sends everything to the local endpoint. A workspace can only tighten what the instance allows. (`aiEmbed` routes through `embeddingRoute()` in `embedding-endpoint.ts` instead.);
- check the workspace monthly and user daily budget (`assertWithinBudget`, `apps/api/src/ai/usage.ts`) and the rate and concurrency limits;
- redact PII for cloud calls when redaction is on (`apps/api/src/ai/redact.ts`);
- write one `ai_usage` row through `recordAiUsage()` with counts, cost, tier and status, never prompt or answer text.

Never import a provider SDK or `fetch` a model endpoint directly.

## 6. Agent tools (apps/api/src/ai-agent)

- Tools are `ToolDef`s in `AGENT_TOOLS` in `apps/api/src/ai-agent/tools.ts`: `name`, `description`, `risk` (`read` / `write` / `destructive`), `requires` (permission map), and a `.strict()` Zod `schema`.
  - **Read tools** implement `read()`. Load through the context loaders under `ctx.scope`, push to `ctx.seen` (this sets the tier of later calls), and return `renderContext` / `wrapUntrusted` text. See `read_task`.
  - **Write tools** implement `plan()`, which only returns a typed `Change` and never writes. Check `assertPrincipalMay(...)`, record `before` and `after`, and throw `NothingToChange` for no-ops. See `update_task`.
- A new kind of write needs a `Change` variant plus cases in `applyChange`, `undoChange`, `changePermissions` and `describeChange` in `apps/api/src/ai-agent/changes.ts`. Apply and undo call the API's own routes with the run's key (`AgentApi`), so authorization, events, activity and webhooks behave as for a person. Undo must invert apply exactly (create, then delete or archive; set, then restore `before`). If it cannot be undone, throw `ChangeError` from `undoChange` and set `alwaysApprove`.
- Approval: `destructive` tools, `alwaysApprove` tools, and every write when the agent's policy requires it are held through `createApproval()` (`apps/api/src/ai-agent/approvals.ts`) instead of applied (see `apps/api/src/ai-agent/runtime.ts`).
- Web: add `ai.agents.tools.<name>` to the i18n files, and render a new change in `apps/web/src/components/ai/agents/change-preview.tsx`.
- Do not add tools that touch roles, invitations, keys, webhooks, sharing or publication (header comment of `tools.ts`).

## 7. Tests (never call a real model)

- Integration on the fake provider: copy the setup of `tests/api-integration/ai-writing.test.ts`. Set `MARGAYA_AI_ENABLED=true` and `MARGAYA_AI_PROVIDER=fake`, call `saveWorkspaceAiSettings(workspaceId, { enabled: true }, ownerId)`, and script answers with `setFakeResponder()`. In `afterEach`, clean up with `setAiProviderFactory(null)`, `setFakeResponder(null)` and `resetAiGatewayState()`. Assert: AI off gives `AI_DISABLED`, a missing `ai:use` gives 403, a hidden project gives 404, the prompt holds only the intended data inside `<untrusted>`, and one `aiUsageTable` row has the right `feature`.
- Agent tools: the fake provider calls a tool when the user text contains `[[fake:tool:<name> <json>]]`. See `tests/api-integration/ai-agents.test.ts` ("applies writes with attribution, and undo reverts them", "holds writes for approval; rejected changes never apply").
- Pure units: `tests/api/ai/router.test.ts`, `ledger.test.ts`, `redact.test.ts`.

## 8. Docs

Update the matching `apps/docs/core/functional/ai-*.mdx` page. If the feature reads new kinds of data or sends them somewhere new, update `apps/docs/core/functional/ai-privacy-and-data.mdx`.

## Done when

- [ ] The feature is in `AI_FEATURES`, with `ai.features.<name>` in every locale (`pnpm i18n:check`)
- [ ] All model calls go through the gateway with an honest `context` / `projectIds`
- [ ] Workspace text reaches the model only inside `wrapUntrusted`
- [ ] `pnpm --filter @margaya/api test:unit tests/api/ai` passes
- [ ] `pnpm --filter @margaya/api test:integration tests/api-integration/<feature>.test.ts` passes on the fake provider
- [ ] New agent writes have apply, undo, permissions and description, with an undo test
- [ ] `pnpm openapi:check` and `pnpm --filter @margaya/api typecheck` pass
