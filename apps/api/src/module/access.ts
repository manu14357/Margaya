import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { moduleTable, projectTable } from "../database/schema";
import { requireProjectFeature } from "../project/features";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { MODULE_NOT_FOUND } from "./controllers/shared";

/**
 * Resolves the module in the path to its project and workspace, checks that
 * the caller may use that workspace, and sets `workspaceId` and `projectId`
 * on the context. Reads the raw path param: route middleware runs before
 * the validators.
 */
export function moduleAccess(idKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

    const moduleId = c.req.param(idKey);
    const [found] = moduleId
      ? await db
          .select({
            projectId: moduleTable.projectId,
            workspaceId: projectTable.workspaceId,
          })
          .from(moduleTable)
          .innerJoin(projectTable, eq(projectTable.id, moduleTable.projectId))
          .where(eq(moduleTable.id, moduleId))
          .limit(1)
      : [];
    if (!found) throw new HTTPException(404, { message: MODULE_NOT_FOUND });

    await validateWorkspaceAccess(
      userId,
      found.workspaceId,
      c.get("apiKey")?.id,
    );

    c.set("workspaceId", found.workspaceId);
    c.set("projectId", found.projectId);
    return next();
  };
}

/** The modules feature gate for routes behind `moduleAccess`. */
export const requireModulesFeatureForModule = requireProjectFeature("modules", {
  resolveProjectId: async (c) => c.get("projectId") ?? null,
});

/** The modules feature gate for `/project/{projectId}` routes. */
export const requireModulesFeatureForProject = requireProjectFeature("modules");

/** The modules feature gate for `/task/{taskId}` routes. */
export const requireModulesFeatureForTask = requireProjectFeature("modules", {
  resource: "task",
  key: "taskId",
});
