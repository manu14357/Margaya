import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  projectTable,
  projectUpdateCommentTable,
  projectUpdateTable,
} from "../database/schema";
import { requireProjectFeature } from "../project/features";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

export const UPDATE_NOT_FOUND = "Project update not found";
export const COMMENT_NOT_FOUND = "Comment not found";

type Located = { workspaceId: string; projectId: string } | undefined;

async function locate(
  c: Context,
  next: Next,
  found: Located,
  notFound: string,
) {
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  if (!found) throw new HTTPException(404, { message: notFound });
  // 404 for a project the caller can't see; caps rights by project role.
  await validateWorkspaceAccess(
    userId,
    found.workspaceId,
    c.get("apiKey")?.id,
    found.projectId,
  );
  c.set("workspaceId", found.workspaceId);
  c.set("projectId", found.projectId);
  return next();
}

/**
 * Resolves the update in the path to its project and workspace (raw param:
 * route middleware runs before the validators). A trashed project's updates
 * read as gone.
 */
export function projectUpdateAccess(idKey = "id") {
  return async (c: Context, next: Next) => {
    const id = c.req.param(idKey);
    const [row] = id
      ? await db
          .select({
            workspaceId: projectUpdateTable.workspaceId,
            projectId: projectUpdateTable.projectId,
            deletedAt: projectTable.deletedAt,
          })
          .from(projectUpdateTable)
          .innerJoin(
            projectTable,
            eq(projectTable.id, projectUpdateTable.projectId),
          )
          .where(eq(projectUpdateTable.id, id))
          .limit(1)
      : [];
    return locate(c, next, row?.deletedAt ? undefined : row, UPDATE_NOT_FOUND);
  };
}

/** Resolves a comment on an update to its project and workspace. */
export function projectUpdateCommentAccess(idKey = "commentId") {
  return async (c: Context, next: Next) => {
    const id = c.req.param(idKey);
    const [row] = id
      ? await db
          .select({
            workspaceId: projectUpdateTable.workspaceId,
            projectId: projectUpdateTable.projectId,
            deletedAt: projectTable.deletedAt,
          })
          .from(projectUpdateCommentTable)
          .innerJoin(
            projectUpdateTable,
            eq(projectUpdateTable.id, projectUpdateCommentTable.updateId),
          )
          .innerJoin(
            projectTable,
            eq(projectTable.id, projectUpdateTable.projectId),
          )
          .where(eq(projectUpdateCommentTable.id, id))
          .limit(1)
      : [];
    return locate(c, next, row?.deletedAt ? undefined : row, COMMENT_NOT_FOUND);
  };
}

/** The updates feature gate for `/project/{projectId}` routes. */
export const requireUpdatesFeatureForProject = requireProjectFeature("updates");

/** The updates feature gate after projectUpdateAccess / commentAccess. */
export const requireUpdatesFeatureForEntity = requireProjectFeature("updates", {
  resolveProjectId: async (c) => c.get("projectId") ?? null,
});
