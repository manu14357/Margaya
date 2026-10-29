---
name: permissions
description: Workflow for adding or changing a workspace permission (resource:action) in packages/permissions and carrying it through built-in roles, existing workspaces' role rows, API enforcement, API key scopes, restricted projects, the roles editor and UI capability checks. Use when a feature needs a new permission, when changing what viewer/member/admin/owner may do, or when guarding a route or button by permission.
---

# Permissions

`@margaya/permissions` is the single vocabulary. The API enforces it. The UI only reflects it. Hiding a button is never an authorization check ([AGENTS.md](../../../AGENTS.md)).

## Where a permission lives

| Layer | File |
| --- | --- |
| Vocabulary and built-in roles | `packages/permissions/src/index.ts` (`statement`, `viewer`, `member`, `admin`, `owner`, `defaultRolePayloads`) |
| Existing workspaces' role rows | `apps/api/src/utils/backfill-role-permissions.ts` (runs on every boot) |
| Route enforcement | `apps/api/src/utils/require-workspace-permission.ts` (`requireWorkspacePermission`, `hasWorkspacePermission`, `workspacePermissionChecker`) |
| Restricted projects | `apps/api/src/project/visibility.ts` (`projectReach`, `canSeeProject`) and project roles in `apps/api/src/project/access.ts` |
| API key scopes | `apps/api/src/api-key/scope.ts` (`API_KEY_AREAS`) and `apps/web/src/components/settings/api-key-scope-fields.tsx` |
| UI capabilities | `apps/web/src/hooks/use-workspace-permission.ts` (`CAPABILITIES`) |
| Roles editor labels | `apps/web/src/routes/_layout/_authenticated/dashboard/settings/workspace/roles.tsx` (`RESOURCE_LABELS`, `PERMISSION_LABELS`) |

## 1. Add it to the vocabulary

In `packages/permissions/src/index.ts`:
- Add the action to an existing resource, or a new resource, in `statement`. Leave a one-line comment on what each action allows (see `intake`, `page`, `ai`).
- Grant it to the built-in roles that should have it by default: `viewer`, `member`, `admin`, `owner`. Defaults are a product decision. Keep viewers read-only and keep settings-level actions for admins and owners (compare `audit_log` and `ai: ["use", "manage"]`).
- The package is consumed from `dist/`. Rebuild it before typechecking consumers:

```sh
pnpm --filter @margaya/permissions build
pnpm --filter @margaya/permissions test
```

Update `packages/permissions/src/index.test.ts`. It asserts the exact `statement` surface and each role's grants.

## 2. Existing workspaces

`viewer`, `member` and `admin` are stored per workspace as `workspace_role` rows (seeded by `apps/api/src/utils/seed-default-workspace-roles.ts`). Admins can edit them. `owner` stays static.
- **New resource**: nothing to write. On boot, `backfillRolePermissions()` adds every resource the built-in roles grant that is neither in `BASELINE_ROLE_RESOURCES` nor already recorded in `role_permission_backfill`, with the default actions, to rows that lack it. It never touches custom roles or a resource a row already has.
- **New action on an existing resource**: **not backfilled.** Existing default-role rows keep their old action list, so the feature answers 403 there until an admin edits the role. Prefer a new resource. If it has to be an action, make an explicit decision and, if needed, write an idempotent boot step (see the [database-migration](../database-migration/SKILL.md) skill).

## 3. Enforce it in the API

- Guard routes with middleware, after a `workspaceAccess.*` resolver (see the [api-endpoint](../api-endpoint/SKILL.md) skill):
  ```ts
  middleware: [workspaceAccess.fromBody(), requireWorkspacePermission({ label: ["create"] })] as const,
  ```
  Shared guards can be constants: `requireAiUse` in `apps/api/src/ai/access.ts`, `readAuditLog` in `apps/api/src/audit-log/index.ts`.
- For reads that report many capabilities, use `workspacePermissionChecker(c)` once and ask it repeatedly.
- `requireWorkspacePermission` already covers: API key scopes (403 `Insufficient API key scope`), instance admins, custom roles (DB row first, built-in fallback) and restricted-project ceilings.
- **Restricted projects**: when the middleware set `projectId` / `projectIds`, a project member's rights are their workspace role intersected with their project role. Something the caller cannot see answers **404**, not 403 (`assertProjectVisible`, `canSeeProject`). Workspace-wide lists filter with `requestHiddenProjectIds(c)`.

## 4. API keys, agents and MCP

- To make a **new resource** selectable for scoped API keys, add it to `API_KEY_AREAS` in both `apps/api/src/api-key/scope.ts` and `apps/web/src/components/settings/api-key-scope-fields.tsx` (with `AREA_KEYS`, and `READ_ONLY_AREAS` / `WRITE_ONLY_AREAS` if it has only one kind of action). A custom-scoped key that lacks the resource is refused.
- AI agent tools declare `requires: { resource: [...] }` in `apps/api/src/ai-agent/tools.ts`. See the [ai-feature](../ai-feature/SKILL.md) skill.
- MCP tools call the REST API with the caller's credential, so they inherit enforcement. Nothing to add there.

## 5. Reflect it in the UI

- Add a capability to `CAPABILITIES` and a `canX` helper in `apps/web/src/hooks/use-workspace-permission.ts` (e.g. `readAuditLog: { audit_log: ["read"] }`). Checks go to the server's `/organization/has-permission`, so custom roles work.
- While `isCheckingPermissions` is true, hide the action rather than flash it.
- Roles editor: add English defaults to `RESOURCE_LABELS` / `PERMISSION_LABELS` in `roles.tsx`, plus i18n keys in `i18n/en-US.json`: `settings.workspaceRoles.resources.<resource>` and `settings.workspaceRoles.permissions.<resource>.<action>.label` / `.description`. Translate them in every locale file in `i18n/`.
- Update the user docs that list role rights, e.g. `apps/docs/core/functional/collaborate-with-team.mdx` or the feature's own page (`apps/docs/core/functional/audit-log.mdx`).

## 6. Tests

- Package: `packages/permissions/src/index.test.ts`.
- Backfill: `tests/api/utils/backfill-role-permissions.test.ts` (pure) and `tests/api-integration/role-permission-backfill.test.ts` (seeds `LEGACY` rows, boots the backfill, then calls a route).
- Enforcement per role: copy `tests/api-integration/analytics-permissions.test.ts` (built-in roles, a custom role, an API key without the scope).
- Restricted projects: `tests/api-integration/restricted-projects.test.ts` ("caps a member's rights by their project role").
- Web: `apps/web/src/routes/_layout/_authenticated/dashboard/settings/workspace/roles.test.tsx`, `apps/web/src/lib/grantable-roles.test.ts`.

## Done when

- [ ] `pnpm --filter @margaya/permissions build` and `pnpm --filter @margaya/permissions test` pass
- [ ] Every route that needs the permission uses `requireWorkspacePermission` (or the checker), with a 403 test for a role without it and a 404 test for a hidden restricted project
- [ ] Existing workspaces get it (new resource), or the no-backfill decision is written down (new action)
- [ ] `pnpm --filter @margaya/api test:integration tests/api-integration/role-permission-backfill.test.ts` passes
- [ ] `pnpm --filter @margaya/api typecheck` and `pnpm --filter @margaya/web typecheck` pass
- [ ] `pnpm i18n:check` passes
