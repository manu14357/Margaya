import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { pageTable } from "../database/schema";
import { requireProjectFeature } from "../project/features";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { PAGE_MESSAGES } from "./rules";

/**
 * Resolves the page in the path and checks workspace access, then sets
 * `workspaceId` and `projectId`. A missing page, or one in a workspace the
 * caller can't access, answers 404 so its existence is not revealed.
 * Visibility of private pages is checked by the controllers. Reads the raw
 * path param: route middleware runs before the validators.
 */
export function pageAccess(idKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

    const pageId = c.req.param(idKey);
    const [page] = pageId
      ? await db
          .select({
            workspaceId: pageTable.workspaceId,
            projectId: pageTable.projectId,
          })
          .from(pageTable)
          .where(eq(pageTable.id, pageId))
          .limit(1)
      : [];
    if (!page)
      throw new HTTPException(404, { message: PAGE_MESSAGES.notFound });

    try {
      await validateWorkspaceAccess(
        userId,
        page.workspaceId,
        c.get("apiKey")?.id,
      );
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        throw new HTTPException(404, { message: PAGE_MESSAGES.notFound });
      }
      throw error;
    }

    c.set("workspaceId", page.workspaceId);
    c.set("projectId", page.projectId);
    return next();
  };
}

/** The Pages feature gate for routes behind `pageAccess`. */
export const requirePagesFeatureForPage = requireProjectFeature("pages", {
  resolveProjectId: async (c) => c.get("projectId") ?? null,
});

/** G: page access, a page permission, then the feature gate. */
export function pageRoute(permission: "read" | "create" | "update") {
  return [
    pageAccess(),
    requireWorkspacePermission({ page: [permission] }),
    requirePagesFeatureForPage,
  ] as const;
}
