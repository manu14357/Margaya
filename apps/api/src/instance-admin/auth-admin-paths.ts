import type { InstanceAuditInput } from "./audit";

// Better Auth's admin endpoints (/api/auth/admin/*) that change accounts.
// They need the same recent sign-in as the instance-admin routes and are
// written to the instance audit trail.

const ADMIN_AUDIT_ACTIONS: Record<string, InstanceAuditInput["action"]> = {
  "/admin/create-user": "user.created",
  "/admin/set-role": "user.role_changed",
  "/admin/ban-user": "user.banned",
  "/admin/unban-user": "user.unbanned",
  "/admin/remove-user": "user.removed",
  "/admin/set-user-password": "user.password_set",
  "/admin/revoke-user-session": "user.sessions_revoked",
  "/admin/revoke-user-sessions": "user.sessions_revoked",
  "/admin/impersonate-user": "user.impersonated",
};

// update-user edits a profile (name, image); it needs the recent sign-in
// but is not audited.
const ADMIN_MUTATION_PATHS = new Set([
  ...Object.keys(ADMIN_AUDIT_ACTIONS),
  "/admin/update-user",
]);

export function isAdminMutationPath(path: string): boolean {
  return ADMIN_MUTATION_PATHS.has(path);
}

/**
 * The audit entry for a successful admin endpoint call, or null. Only the
 * target and harmless fields are kept: never passwords or tokens.
 */
export function instanceAuditForAdminPath(
  path: string,
  body: Record<string, unknown> | undefined,
): Omit<InstanceAuditInput, "actor"> | null {
  const action = ADMIN_AUDIT_ACTIONS[path];
  if (!action) return null;
  const userId = typeof body?.userId === "string" ? body.userId : null;
  const email = typeof body?.email === "string" ? body.email : null;
  const metadata: Record<string, unknown> = {};
  if (path === "/admin/set-role") metadata.role = body?.role ?? null;
  if (path === "/admin/ban-user") {
    metadata.reason =
      typeof body?.banReason === "string" ? body.banReason : null;
    metadata.expiresInSeconds =
      typeof body?.banExpiresIn === "number" ? body.banExpiresIn : null;
  }
  return {
    action,
    target: { type: "user", id: userId, label: email },
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  };
}
