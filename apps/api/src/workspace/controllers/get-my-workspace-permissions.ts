import { statement } from "@margaya/permissions";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceUserTable } from "../../database/schema";
import { isInstanceAdmin } from "../../utils/is-instance-admin";
import {
  builtInRoleStatements,
  customRoleStatements,
  workspacePermissionChecker,
} from "../../utils/require-workspace-permission";

// Enforced by the auth library's organization routes (invitations, member
// roles), which go by the workspace role alone: an instance admin's reach
// does not apply there, so it is not reported for them either.
const ROLE_ONLY_RESOURCES: ReadonlySet<string> = new Set([
  "organization",
  "member",
  "invitation",
  "team",
  "ac",
]);

/**
 * The caller's role and every permission of the vocabulary they hold in the
 * workspace, answered with the API's own checks so a client can ask once
 * instead of once per action. Members only.
 */
async function getMyWorkspacePermissions(c: Context) {
  const workspaceId = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;

  const [member] = await db
    .select({
      role: workspaceUserTable.role,
      joinedAt: workspaceUserTable.joinedAt,
    })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  // An instance admin reaches every workspace, but has no role in this one.
  if (!member) {
    throw new HTTPException(403, {
      message: "You don't have access to this workspace",
    });
  }

  const can = await workspacePermissionChecker(c);
  const roleStatements = (await isInstanceAdmin(c))
    ? ((await customRoleStatements(workspaceId, member.role)) ??
      builtInRoleStatements(member.role) ??
      {})
    : null;

  const permissions: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(statement)) {
    const granted = actions.filter((action) =>
      roleStatements && ROLE_ONLY_RESOURCES.has(resource)
        ? (roleStatements[resource]?.includes(action) ?? false)
        : can({ [resource]: [action] }),
    );
    if (granted.length > 0) permissions[resource] = granted;
  }

  return {
    workspaceId,
    userId,
    role: member.role,
    joinedAt: member.joinedAt,
    permissions,
  };
}

export default getMyWorkspacePermissions;
