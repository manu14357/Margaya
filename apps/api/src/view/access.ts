import { and, eq, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable, savedViewTable } from "../database/schema";
import {
  assertProjectFeatureEnabled,
  featureDisabledMessage,
} from "../project/features";
import { PROJECT_NOT_FOUND } from "../task-query/context";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

export { visibleViewCondition } from "./visibility";

export const VIEW_NOT_FOUND = "View not found";

/**
 * Resolves the view in the path, answering 404 when it is unknown or private
 * to someone else (its existence is not revealed), then checks workspace
 * access and sets `workspaceId` and `projectId` (null for workspace views)
 * on the context. Reads the raw path param: route middleware runs before the
 * validators.
 */
export function viewAccess(idKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

    const viewId = c.req.param(idKey);
    const [view] = viewId
      ? await db
          .select({
            workspaceId: savedViewTable.workspaceId,
            projectId: savedViewTable.projectId,
            access: savedViewTable.access,
            ownerId: savedViewTable.ownerId,
          })
          .from(savedViewTable)
          .where(eq(savedViewTable.id, viewId))
          .limit(1)
      : [];
    if (!view || (view.access === "private" && view.ownerId !== userId)) {
      throw new HTTPException(404, { message: VIEW_NOT_FOUND });
    }

    await validateWorkspaceAccess(
      userId,
      view.workspaceId,
      c.get("apiKey")?.id,
    );

    c.set("workspaceId", view.workspaceId);
    c.set("projectId", view.projectId);
    return next();
  };
}

/** The views feature gate for routes behind `viewAccess` (project views only). */
export async function requireViewsFeatureForView(c: Context, next: Next) {
  const projectId: string | null = c.get("projectId") ?? null;
  if (projectId) await assertProjectFeatureEnabled(projectId, "views");
  return next();
}

async function readProjectId(
  c: Context,
  location: "query" | "body",
): Promise<string | null> {
  if (location === "query") return c.req.query("projectId") || null;
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>).projectId;
  return typeof value === "string" && value ? value : null;
}

/**
 * For list and create: a `projectId` in the request must be a project of the
 * workspace (404) with views on (403). Without one the request is about
 * workspace views, which are never gated. Runs after workspace access and
 * the permission check, and sets `projectId` (or null) on the context.
 */
export function viewProjectScope(location: "query" | "body") {
  return async (c: Context, next: Next) => {
    const projectId = await readProjectId(c, location);
    if (projectId) {
      const [project] = await db
        .select({ viewsEnabled: projectTable.viewsEnabled })
        .from(projectTable)
        .where(
          and(
            eq(projectTable.id, projectId),
            eq(projectTable.workspaceId, c.get("workspaceId")),
            // A trashed project reads as gone (C7).
            isNull(projectTable.deletedAt),
          ),
        )
        .limit(1);
      if (!project) {
        throw new HTTPException(404, { message: PROJECT_NOT_FOUND });
      }
      if (!project.viewsEnabled) {
        throw new HTTPException(403, {
          message: featureDisabledMessage("views"),
        });
      }
    }
    c.set("projectId", projectId);
    return next();
  };
}
