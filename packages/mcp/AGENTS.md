# packages/mcp

`@margaya/mcp`, the published stdio MCP server and installer CLI (`margaya-mcp`). It is a separate npm package, not a workspace library: nothing in the monorepo imports it. Follow the root [AGENTS.md](../../AGENTS.md); skill: `mcp-tool`.

## Two MCP surfaces

- **stdio package (here):** runs on the user's machine and calls the public HTTP API with a device-flow token or `MARGAYA_API_KEY` (`src/margaya/client.ts`). It has no database access and no privileges beyond that token.
- **HTTP MCP (`apps/api/src/mcp/`):** served by every instance at `/api/mcp`, with its own tool registration in `apps/api/src/mcp/tools.ts`.

A tool added to one surface is not automatically on the other. Decide whether both need it, and keep names, input schemas and behavior aligned when they do.

## Files that must stay byte-identical

These exist in both surfaces and must be edited together, copied verbatim:

| Here | API copy | Enforced by |
| --- | --- | --- |
| `src/tools/annotations.ts` | `apps/api/src/mcp/annotations.ts` | nothing; check with `diff` |
| `src/tools/output.ts` | `apps/api/src/mcp/output.ts` | `src/tools/output.test.ts` |
| `src/tools/planning-tools.ts` | `apps/api/src/mcp/planning-tools.ts` | `tests/api/mcp-planning-tools.test.ts` |

They may import `zod` only. A new tool also needs its read-only or destructive classification in `annotations.ts`.

## Rules

- In `serve` mode stdout is the JSON-RPC channel. Log with `console.error`, never `console.log`. The installer and help commands may print to stdout.
- Imports use NodeNext-style `.js` extensions (`./auth/auth-service.js`).
- Tools call documented public API routes. If a tool needs a new route, add it to the API first (skill `api-endpoint`), including OpenAPI metadata.
- Never print or persist the API key or device token anywhere except the token store in `src/auth/token-store.ts`.
- The user-facing guide is `apps/docs/core/integrations/mcp.mdx`; update it and `README.md` when tools or setup change.

## Versioning and publishing

- The package is versioned on its own (`version` in `package.json`), not by the app release. `server.json` carries the same version for the MCP Registry; keep both fields in step.
- `.github/workflows/publish-mcp.yml` publishes on a GitHub release tagged `mcp-v<version>` (or a manual run from `main`) and fails if the tag and `package.json` disagree. Do not run `npm publish` locally, and do not bump the version or create releases unless asked.

## Verify

- `pnpm --filter @margaya/mcp test` and `pnpm --filter @margaya/mcp build`.
- After touching a shared file: `pnpm --filter @margaya/api test` as well.
