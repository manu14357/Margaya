# Margaya agent guide

Margaya is a fast, self-hosted project-management platform.
- The Hono API owns domain behavior and authorization.
- The React app consumes the API's typed client.
- PostgreSQL stores durable state.
- Events plus WebSockets keep clients current.
- Redis is optional; it coordinates realtime delivery across multiple API instances.

This is an operating guide, not a README. Its rules are good defaults. Explicit developer and user instructions take precedence.

## Principles

- Simplicity is a product requirement. Build the smallest model that makes correct behavior obvious.
- Planning features (cycles, modules, views, pages, estimates, intake, analytics) must stay out of the way: routine work must never get heavier because a feature exists.
- Protect performance, especially on task-heavy boards and realtime views.
- Keep self-hosting straightforward and single-instance deployments first-class. Do not make Redis or another managed service mandatory without an explicit product decision.
- Support both bundled same-origin deployments and separately hosted API and web deployments.
- Protect user data, workspace boundaries and authorization checks.
- Read the relevant implementation before changing it. Follow an established local pattern when it fits, but do not preserve accidental complexity just because it exists.
- Stay focused. Do not mix requested work with speculative features, broad refactors or unrelated cleanup.

## Architecture

- `apps/api`: Hono API, Better Auth, controllers, database access, events, integrations, MCP HTTP routes and WebSockets.
- `apps/web`: React/Vite UI, TanStack Router and Query, fetchers, hooks and realtime cache updates.
- `apps/docs`: product and API documentation content.
- `apps/site`: the public Next.js site, which also hosts the documentation.
- `packages/libs`: the shared typed Hono client and URL helpers.
- `packages/permissions`: the canonical permission vocabulary and built-in roles.
- `packages/email`: transactional email templates and delivery.
- `packages/mcp`: the published stdio MCP package.
- `charts/margaya`: the Helm deployment surface.
- `tests/api`: API unit tests. `tests/api-integration`: PostgreSQL-backed integration tests.

## Boundaries that must hold

- The API is the authority for authentication and authorization. Hiding an action in the UI is not an authorization check.
- Workspace-scoped operations must use the existing `@margaya/permissions` vocabulary and API middleware.
- Do not expose secrets, credentials, internal fields or private workspace data through responses, logs, events, WebSockets or MCP tools.
- Public API behavior must keep accurate Zod validation and OpenAPI metadata.
- Mutations that affect realtime state must account for event publication, WebSocket delivery and client cache invalidation.
- Database changes must work for existing installations, not only empty development databases.
- User-facing web copy must use static i18n keys. `i18n/en-US.json` is the source of truth.

## Follow a change through

Before calling a behavior change complete, decide which of these surfaces apply:

- API route, validator, controller, authorization, error behavior and OpenAPI description. Route middleware declared via `createRoute({ middleware })` runs BEFORE the request validators, so middleware must read the raw request rather than `c.req.valid()`.
- Typed client, web fetcher, query or mutation hook, cache invalidation and UI states.
- Events, project- or user-scoped WebSockets, and optional Redis fan-out.
- Permission definitions, API enforcement and UI capability checks.
- MCP, API keys, webhooks and relevant external integrations.
- Schema, relations, generated migration, indexes, cascades and existing data.
- Translations, accessibility, user documentation, Docker and Helm.
- Reverse states: create/delete, assign/unassign, enable/disable, connect/disconnect, and a visible current state.

Not every change touches every surface. Decide deliberately rather than expanding scope automatically.

## Project conventions

- Keep API handlers thin, with domain behavior in controllers or focused utilities.
- Validate API inputs with Zod through `@hono/zod-openapi`:
  - Define routes with `createRoute` and mount them on the `apiRouter()` factory in `apps/api/src/openapi.ts`.
  - Request schemas live in a feature's `schema.ts`. Response schemas live in its `response.ts`, named with `.openapi("Name")` so they become reusable components.
  - Use `HTTPException` for expected HTTP failures.
  - Valibot remains only for internal, non-HTTP config validation under `plugins/` and `ws/`.
- Use `requireWorkspacePermission` rather than duplicating role checks.
- Use `publishEvent()` when a mutation drives activity, notifications, integrations or realtime updates.
- Keep web requests in `apps/web/src/fetchers/` and server state in TanStack Query hooks.
- Use the client from `@margaya/libs`. Do not create a parallel untyped request layer.
- Define the database schema in `apps/api/src/database/schema.ts` and relations in `apps/api/src/database/relations.ts`.
- Generate migrations with `pnpm --filter @margaya/api db:generate`, inspect the SQL, and include it with the schema change.
- `apps/docs/openapi.json` is a committed artifact served by the docs site. Regenerate it with `pnpm openapi:check:fix` whenever a route, request schema or response schema changes; CI fails when it drifts.
- Prefer inferred TypeScript types, and prefer `type` over `interface` unless extension or declaration merging is required.
- Comments should explain constraints or surprising decisions, not narrate code.

## Safety and tooling

- Use pnpm 10.32.1 and Node.js 24 or newer.
- Server environment variables come from the root `.env`. Local Vite-only overrides belong in `apps/web/.env.local`. See `ENVIRONMENT_SETUP.md`.
- Never use production databases, storage or credentials for development or tests.
- Preserve unrelated work in a dirty worktree. Do not delete data or generated files unless the task requires it and the target is verified.
- Track the processes you start and stop only those. Never kill by broad name or path patterns.
- The root and package `lint` scripts run Biome with `--write` and can modify unrelated files. Prefer targeted checks while iterating, and inspect formatter changes.
- Do not commit, push or open a pull request unless explicitly requested.

## Verification

Use the smallest proof that covers the changed behavior, then broaden it when the blast radius requires it.

- Utility or UI logic: focused unit or component tests, plus a typecheck of the affected package.
- API behavior: focused API tests. Use integration tests when routing, authentication, authorization or PostgreSQL behavior matters.
- Database changes: relevant integration tests and migration inspection.
- Cross-package contracts: typecheck or build every affected consumer.
- Realtime changes: verify the event-to-WebSocket-to-cache path, with both in-memory and Redis delivery in mind.
- Deployment changes: validate the affected Docker, Helm or startup path.
- User-visible flows: use a real browser pass when requested, or when it is the only meaningful proof.

Run repository-wide checks when a change crosses packages broadly, before a requested commit or pull request, or when explicitly asked. Report what ran and what did not.

## Folder guides, skills and agents

- Folders with their own rules have an `AGENTS.md`: `apps/api`, `apps/web`, `apps/docs`, `apps/site`, `packages/libs`, `packages/permissions`, `packages/mcp`, `packages/email`, `tests`, `charts/margaya` and `i18n`. Read the one for the folder you change.
- Step-by-step workflows live in `.claude/skills/<name>/SKILL.md`:
  - API and data: `api-endpoint`, `database-migration`, `realtime-events`, `permissions`, `integration-plugin`, `ai-feature`, `mcp-tool`.
  - Web, text and docs: `web-data-flow`, `i18n`, `docs-and-openapi`.
  - Running and shipping: `testing`, `local-stack`, `commit-and-release`.
- Review and helper agents live in `.claude/agents/`: `authz-reviewer`, `migration-reviewer`, `i18n-translator`, `docs-writer` and `change-verifier`.

## Glossary

- **instance**: one deployed Margaya installation.
- **workspace**: the top-level collaboration and authorization boundary.
- **project**: a task container inside a workspace.
- **column**: a project workflow status that tasks move through.
- **role**: a workspace-scoped set of permission statements.
- **activity**: durable, user-visible history.
- **event**: an internal notification used by activity, integrations, notifications or realtime updates.

Update this guide only for recurring, observed failure modes. Put narrow workflows in skills or dedicated documentation.
