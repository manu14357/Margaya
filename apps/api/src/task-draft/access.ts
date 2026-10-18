import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { taskDraftTable } from "../database/schema";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { DRAFT_NOT_FOUND } from "./controllers/shared";

/**
 * Loads the draft in the path and lets only its owner through: anyone else,
 * admins and instance admins included, gets the same 404 as for a missing
 * draft. Then checks the owner still belongs to the draft's workspace, and
 * sets `workspaceId` and `projectId` for the permission middleware. Reads
 * the raw path param: route middleware runs before the validators.
 */
export function draftAccess(idKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

    const draftId = c.req.param(idKey);
    const [draft] = draftId
      ? await db
          .select({
            id: taskDraftTable.id,
            workspaceId: taskDraftTable.workspaceId,
            projectId: taskDraftTable.projectId,
            createdBy: taskDraftTable.createdBy,
          })
          .from(taskDraftTable)
          .where(eq(taskDraftTable.id, draftId))
          .limit(1)
      : [];
    if (!draft || draft.createdBy !== userId) {
      throw new HTTPException(404, { message: DRAFT_NOT_FOUND });
    }

    await validateWorkspaceAccess(
      userId,
      draft.workspaceId,
      c.get("apiKey")?.id,
      draft.projectId,
    );

    c.set("workspaceId", draft.workspaceId);
    c.set("projectId", draft.projectId);
    return next();
  };
}
