import { and, eq, inArray, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  currentRequestApiKey,
  projectScopedWorkspaceRouteAllowed,
} from "../api-key/scope";
import { auditContext } from "../audit-log/context";
import db, { schema } from "../database";
import { PROJECT_NOT_FOUND, projectReach } from "../project/visibility";
import { assertWorkspaceNotLocked } from "../workspace-deletion/lock";
import {
  currentRequestUsesApiKey,
  instanceAdminApiKeysAllowed,
} from "./admin-api-keys";

/**
 * Project-limited API keys (api-key/scope.ts): a project outside the key
 * reads as missing (404). A request that names no project only passes on the
 * few workspace routes that narrow their answer to the key's projects, and
 * only in a workspace that holds one of them; anything else is refused, so a
 * route that does not pass its project fails closed.
 */
async function assertApiKeyProjectScope(
  workspaceId: string,
  projectId: string | null | undefined,
) {
  const projectIds = currentRequestApiKey()?.projectIds;
  if (!projectIds || projectIds.length === 0) return;
  if (projectId) {
    if (!projectIds.includes(projectId)) {
      throw new HTTPException(404, { message: "Project not found" });
    }
    return;
  }
  const c = auditContext.getStore()?.c;
  const allowed =
    c && projectScopedWorkspaceRouteAllowed(c.req.method, c.req.path);
  if (allowed) {
    const [inWorkspace] = await db
      .select({ id: schema.projectTable.id })
      .from(schema.projectTable)
      .where(
        and(
          eq(schema.projectTable.workspaceId, workspaceId),
          inArray(schema.projectTable.id, projectIds),
        ),
      )
      .limit(1);
    if (inWorkspace) return;
  }
  throw new HTTPException(403, {
    message: "This API key is limited to specific projects",
  });
}

export async function validateWorkspaceAccess(
  userId: string,
  workspaceId: string,
  apiKeyId?: string,
  /** The project the request acts on, when it acts on one. */
  projectId?: string | null,
): Promise<void> {
  await assertApiKeyProjectScope(workspaceId, projectId);

  if (apiKeyId) {
    const apiKey = await db
      .select()
      .from(schema.apikeyTable)
      .where(
        and(
          eq(schema.apikeyTable.id, apiKeyId),
          or(
            eq(schema.apikeyTable.referenceId, userId),
            eq(schema.apikeyTable.userId, userId),
          ),
          eq(schema.apikeyTable.enabled, true),
        ),
      )
      .limit(1);

    if (apiKey.length === 0) {
      throw new HTTPException(403, {
        message: "Invalid API key for this workspace",
      });
    }
  }

  const [user] = await db
    .select({ role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);

  // Instance admins reach every workspace, but not through an API key
  // unless the operator allows it (admin-api-keys.ts).
  const viaApiKey = Boolean(apiKeyId) || currentRequestUsesApiKey();
  if (user?.role === "admin" && (!viaApiKey || instanceAdminApiKeysAllowed())) {
    await assertWorkspaceNotLocked(workspaceId, apiKeyId);
    if (projectId)
      await assertProjectInWorkspace(userId, workspaceId, projectId);
    return;
  }

  const membership = await db
    .select()
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (membership.length === 0) {
    throw new HTTPException(403, {
      message: "You don't have access to this workspace",
    });
  }

  // Checked after membership, so outsiders can't tell a pending deletion.
  await assertWorkspaceNotLocked(workspaceId, apiKeyId);

  // A restricted project the caller is not a member of reads as missing.
  if (projectId) await assertProjectInWorkspace(userId, workspaceId, projectId);
}

/** 404 unless the project is in the workspace and visible to the user. */
async function assertProjectInWorkspace(
  userId: string,
  workspaceId: string,
  projectId: string,
) {
  const reach = await projectReach(userId, projectId);
  if (!reach || reach.workspaceId !== workspaceId || !reach.visible) {
    throw new HTTPException(404, { message: PROJECT_NOT_FOUND });
  }
}
