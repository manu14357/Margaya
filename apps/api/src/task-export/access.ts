import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { taskExportTable } from "../database/schema";
import { hiddenProjectIds } from "../project/visibility";
import { hasWorkspacePermission } from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { WORKSPACE_EXPORT_PERMISSIONS } from "./types";

export const EXPORT_NOT_FOUND = "Export not found";

/**
 * Loads the export in the path. Only its requester and holders of
 * workspace:manage_settings in its workspace get past, and a whole-workspace
 * export takes WORKSPACE_EXPORT_PERMISSIONS even from its requester, who may
 * have lost them since; anyone else gets the same 404 as for a missing export.
 * Then checks workspace access and its projects, and sets `workspaceId` and
 * `taskExport`. Reads the raw path param: route middleware runs before the
 * validators.
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
    const needed =
      row.kind === "workspace"
        ? WORKSPACE_EXPORT_PERMISSIONS
        : row.requestedBy !== userId
          ? { workspace: ["manage_settings"] }
          : null;
    if (needed && !(await hasWorkspacePermission(c, needed))) {
      throw new HTTPException(404, { message: EXPORT_NOT_FOUND });
    }

    await validateWorkspaceAccess(userId, row.workspaceId, c.get("apiKey")?.id);
    // An export holds data of its projects: all of them must be visible to the
    // caller now (restricted projects, project/visibility.ts), its requester
    // included, who may have been removed from one since.
    const hidden = await hiddenProjectIds(userId, row.workspaceId);
    if (row.projectIds.some((id) => hidden.includes(id))) {
      throw new HTTPException(404, { message: EXPORT_NOT_FOUND });
    }
    c.set("taskExport", row);
    return next();
  };
}
