import { and, eq, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable, taskTable, timeEntryTable } from "../database/schema";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

export const TIME_ENTRY_NOT_FOUND = "Time entry not found";

/**
 * Resolves the time entry in the path to its workspace, checks that the
 * caller may use that workspace, and sets `workspaceId` on the context. An
 * entry the caller can't see (unknown, or in a workspace they are not part
 * of) answers 404, so the response does not confirm that it exists. Reads
 * the raw path param: route middleware runs before the validators.
 */
export function visibleTimeEntry(idKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

    const timeEntryId = c.req.param(idKey);
    const [found] = timeEntryId
      ? await db
          .select({
            workspaceId: projectTable.workspaceId,
            projectId: projectTable.id,
          })
          .from(timeEntryTable)
          .innerJoin(taskTable, eq(taskTable.id, timeEntryTable.taskId))
          .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
          // Entries of a trashed task read as gone (C7).
          .where(
            and(
              eq(timeEntryTable.id, timeEntryId),
              isNull(taskTable.deletedAt),
            ),
          )
          .limit(1)
      : [];
    if (!found) throw new HTTPException(404, { message: TIME_ENTRY_NOT_FOUND });

    try {
      await validateWorkspaceAccess(
        userId,
        found.workspaceId,
        c.get("apiKey")?.id,
        found.projectId,
      );
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        throw new HTTPException(404, { message: TIME_ENTRY_NOT_FOUND });
      }
      throw error;
    }

    c.set("workspaceId", found.workspaceId);
    return next();
  };
}
