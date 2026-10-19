import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { intakeItemTable, projectTable } from "../database/schema";
import {
  assertProjectFeatureEnabled,
  requireProjectFeature,
} from "../project/features";
import { hasWorkspacePermission } from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

export const REQUEST_NOT_FOUND = "Request not found";
export const NO_INTAKE_ACCESS = "You don't have access to intake";

export type IntakeItemRef = {
  id: string;
  projectId: string;
  taskId: string;
  submittedBy: string | null;
};

/**
 * Resolves the request in the path to its project and workspace, checks
 * workspace access and the project's intake feature, and sets `workspaceId`,
 * `projectId` and `intakeItem` on the context. Reads the raw path param:
 * route middleware runs before the validators.
 */
export function intakeItemAccess(idKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

    const itemId = c.req.param(idKey);
    const [item] = itemId
      ? await db
          .select({
            id: intakeItemTable.id,
            projectId: intakeItemTable.projectId,
            taskId: intakeItemTable.taskId,
            submittedBy: intakeItemTable.submittedBy,
            workspaceId: projectTable.workspaceId,
          })
          .from(intakeItemTable)
          .innerJoin(
            projectTable,
            eq(projectTable.id, intakeItemTable.projectId),
          )
          .where(eq(intakeItemTable.id, itemId))
          .limit(1)
      : [];
    if (!item) throw new HTTPException(404, { message: REQUEST_NOT_FOUND });

    await validateWorkspaceAccess(
      userId,
      item.workspaceId,
      c.get("apiKey")?.id,
      item.projectId,
    );
    await assertProjectFeatureEnabled(item.projectId, "intake");

    c.set("workspaceId", item.workspaceId);
    c.set("projectId", item.projectId);
    c.set("intakeItem", {
      id: item.id,
      projectId: item.projectId,
      taskId: item.taskId,
      submittedBy: item.submittedBy,
    } satisfies IntakeItemRef);
    return next();
  };
}

/** The intake feature gate for `/project/{projectId}` routes. */
export const requireIntakeFeatureForProject = requireProjectFeature("intake");

/** The intake feature gate for `/task/{taskId}` routes. */
export const requireIntakeFeatureForTask = requireProjectFeature("intake", {
  resource: "task",
  key: "taskId",
});

export type IntakeVisibility = "all" | "own";

/**
 * Who sees what: `intake:read` sees every request of the project,
 * `intake:create` alone only the caller's own, anyone else is refused.
 * `requireWorkspacePermission` can't express "read or create".
 */
export async function resolveIntakeVisibility(
  c: Context,
): Promise<IntakeVisibility> {
  if (await hasWorkspacePermission(c, { intake: ["read"] })) return "all";
  if (await hasWorkspacePermission(c, { intake: ["create"] })) return "own";
  throw new HTTPException(403, { message: NO_INTAKE_ACCESS });
}

/** 404 when an own-only caller asks for someone else's request. */
export function assertVisible(
  visibility: IntakeVisibility,
  item: { submittedBy: { id: string } | null },
  userId: string,
): void {
  if (visibility === "own" && item.submittedBy?.id !== userId) {
    throw new HTTPException(404, { message: REQUEST_NOT_FOUND });
  }
}
