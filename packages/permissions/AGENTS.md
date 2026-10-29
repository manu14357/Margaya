# packages/permissions

The canonical permission vocabulary (`statement`), the Better Auth access controller (`ac`), the built-in roles (`viewer`, `member`, `admin`, `owner`) and the helpers `mergeStatements` and `grantsWithin`. Everything lives in `src/index.ts`. Follow the root [AGENTS.md](../../AGENTS.md); skill: `permissions`.

## How it is consumed

- Consumers import the compiled `dist/`. Run `pnpm --filter @margaya/permissions build` (or any turbo task, which builds dependencies first) before the API or web sees a change.
- API: `requireWorkspacePermission` and `hasWorkspacePermission` (`apps/api/src/utils/require-workspace-permission.ts`), `auth.ts` (seeds default role rows on workspace creation), `utils/backfill-role-permissions.ts`, `utils/role-ceiling.ts`, `api-key/scope.ts`, `ai-agent/rights.ts` and `project/access.ts`.
- Web: re-exported through `apps/web/src/lib/permissions.ts`; the role editor is `apps/web/src/routes/_layout/_authenticated/dashboard/settings/workspace/roles.tsx`.

## Built-in roles are stored per workspace

`viewer`, `member` and `admin` are seeded into `workspace_role` rows from `defaultRolePayloads` and can be edited by admins. `owner` stays a static Better Auth role. So changing a role here changes new workspaces only, unless the backfill picks it up:

- **A new resource** (a new key in `statement`) granted to a default role is added once to existing default role rows at API boot by `backfillRolePermissions()`, then recorded in `role_permission_backfill` and never touched again.
- **A new action on an existing resource** is not backfilled. Existing workspaces will not get it. Decide explicitly whether they should, and if so add a migration or a dedicated backfill. Never rewrite admin-edited role rows wholesale.
- Removing or renaming an action leaves stale entries in stored rows and API keys. Treat it as a data migration.

## Adding a resource or action

1. Add it to `statement`, then grant it to each role that should have it. The roles are listed out in full, so a role that does not name an action does not get it.
2. Add or update tests in `src/index.test.ts`, which pin each role's grants.
3. Enforce it in the API with `requireWorkspacePermission({ resource: ["action"] })`.
4. Decide whether API keys and AI agents may use it: `API_KEY_AREAS` in `apps/api/src/api-key/scope.ts` (mirrored in `apps/web/src/components/settings/api-key-scope-fields.tsx`) and `AGENT_AREAS` plus `NEVER` in `apps/api/src/ai-agent/rights.ts`.
5. Give it a label in `RESOURCE_LABELS` / `PERMISSION_LABELS` in the roles route, and translated `settings:workspaceRoles.permissions.<resource>.<action>.label` and `.description` keys in every locale.

## Verify

- `pnpm --filter @margaya/permissions test`
- Typecheck the consumers: `pnpm --filter @margaya/api typecheck` and `pnpm --filter @margaya/web typecheck`.
- Authorization changes need API integration tests (see `tests/AGENTS.md`).
