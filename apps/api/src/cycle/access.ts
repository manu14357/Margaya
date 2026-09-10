import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { cycleTable, projectTable } from "../database/schema";
import { requireProjectFeature } from "../project/features";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { CYCLE_NOT_FOUND } from "./controllers/shared";

/**
 * Resolves the cycle in the path to its project and workspace, checks that
 * the caller may use that workspace, and sets `workspaceId` and `projectId`
 * on the context. Reads the raw path param: route middleware runs before
 * the validators.
 */
export function cycleAccess(idKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

    const cycleId = c.req.param(idKey);
    const [cycle] = cycleId
      ? await db
          .select({
            projectId: cycleTable.projectId,
            workspaceId: projectTable.workspaceId,
          })
          .from(cycleTable)
          .innerJoin(projectTable, eq(projectTable.id, cycleTable.projectId))
          .where(eq(cycleTable.id, cycleId))
          .limit(1)
      : [];
    if (!cycle) throw new HTTPException(404, { message: CYCLE_NOT_FOUND });

    await validateWorkspaceAccess(
      userId,
      cycle.workspaceId,
      c.get("apiKey")?.id,
    );

    c.set("workspaceId", cycle.workspaceId);
    c.set("projectId", cycle.projectId);
    return next();
  };
}

/** The cycles feature gate for routes behind `cycleAccess`. */
export const requireCyclesFeatureForCycle = requireProjectFeature("cycles", {
  resolveProjectId: async (c) => c.get("projectId") ?? null,
});

/** The cycles feature gate for `/project/{projectId}` routes. */
export const requireCyclesFeatureForProject = requireProjectFeature("cycles");

/** The cycles feature gate for `/task/{taskId}` routes. */
export const requireCyclesFeatureForTask = requireProjectFeature("cycles", {
  resource: "task",
  key: "taskId",
});
