import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { intakeItemTable } from "../database/schema";
import { isProjectFeatureEnabled } from "../project/features";
import { hasWorkspacePermission } from "../utils/require-workspace-permission";
import { effectiveStatusSql } from "./queries";
import { isOpenIntakeStatus } from "./status";

/**
 * Whether the caller is the requester (with intake:create) of an open
 * request on this task, with intake still on for its project.
 */
export async function isOpenRequestRequester(c: Context, taskId: string) {
  const userId = c.get("userId") as string | undefined;
  if (!userId || !taskId) return false;
  const [item] = await db
    .select({
      projectId: intakeItemTable.projectId,
      submittedBy: intakeItemTable.submittedBy,
      status: effectiveStatusSql,
    })
    .from(intakeItemTable)
    .where(eq(intakeItemTable.taskId, taskId))
    .limit(1);
  if (!item || item.submittedBy !== userId) return false;
  if (!isOpenIntakeStatus(item.status)) return false;
  if (!(await isProjectFeatureEnabled(item.projectId, "intake"))) return false;
  return hasWorkspacePermission(c, { intake: ["create"] });
}

/**
 * task:update, or the requester of an open request on the task in the path:
 * the requester edits their request's description (PATCH /intake/item/{id})
 * and may put images and files in it the same way. Runs after
 * `workspaceAccess.fromTask()`, and reads the raw path param because route
 * middleware runs before the validators.
 */
export function requireTaskUpdateOrOpenRequester(taskIdKey = "id") {
  return async (c: Context, next: Next) => {
    if (await hasWorkspacePermission(c, { task: ["update"] })) return next();
    if (!c.get("userId")) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    if (await isOpenRequestRequester(c, c.req.param(taskIdKey) ?? "")) {
      // A requester edits only the description; commenting needs task:update.
      const body = (await c.req.json().catch(() => null)) as {
        surface?: unknown;
      } | null;
      if (body?.surface === "description") return next();
    }
    throw new HTTPException(403, { message: "Insufficient permissions" });
  };
}
