import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { taskExportTable } from "../database/schema";
import { hasWorkspacePermission } from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

export const EXPORT_NOT_FOUND = "Export not found";

/**
 * Loads the export in the path. Only its requester and holders of
 * workspace:manage_settings in its workspace get past; anyone else gets
 * the same 404 as for a missing export. Then checks workspace access and
 * sets `workspaceId` and `taskExport`. Reads the raw path param: route
 * middleware runs before the validators.
 */
export function taskExportAccess(idKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

    const exportId = c.req.param(idKey);
    const [row] = exportId
      ? await db
          .select()
          .from(taskExportTable)
          .where(eq(taskExportTable.id, exportId))
          .limit(1)
      : [];
    if (!row) throw new HTTPException(404, { message: EXPORT_NOT_FOUND });

    c.set("workspaceId", row.workspaceId);
    if (
      row.requestedBy !== userId &&
      !(await hasWorkspacePermission(c, { workspace: ["manage_settings"] }))
    ) {
      throw new HTTPException(404, { message: EXPORT_NOT_FOUND });
    }

    await validateWorkspaceAccess(userId, row.workspaceId, c.get("apiKey")?.id);
    c.set("taskExport", row);
    return next();
  };
}
