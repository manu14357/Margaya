import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable, whiteboardTable } from "../database/schema";
import { requireProjectFeature } from "../project/features";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { WHITEBOARD_MESSAGES } from "./rules";

// Route middleware reads the raw request: it runs before the validators.

async function grantWorkspace(
  c: Context,
  workspaceId: string,
  projectId: string,
  notFound: string,
) {
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      workspaceId,
      c.get("apiKey")?.id,
      projectId,
    );
  } catch (error) {
    // A board in another workspace reads as missing, never as forbidden.
    if (error instanceof HTTPException && error.status === 403) {
      throw new HTTPException(404, { message: notFound });
    }
    throw error;
  }
  c.set("workspaceId", workspaceId);
  c.set("projectId", projectId);
}

/**
 * Resolves the board in the path, checks workspace access (and restricted
 * projects), then sets `workspaceId` and `projectId`. Live boards only, or
 * with `trashed`, boards in the trash only. A missing or foreign board is 404.
 */
export function whiteboardAccess(idKey = "id", { trashed = false } = {}) {
  return async (c: Context, next: Next) => {
    if (!c.get("userId")) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    const notFound = trashed
      ? WHITEBOARD_MESSAGES.notInTrash
      : WHITEBOARD_MESSAGES.notFound;
    const whiteboardId = c.req.param(idKey);
    const [board] = whiteboardId
      ? await db
          .select({
            workspaceId: whiteboardTable.workspaceId,
            projectId: whiteboardTable.projectId,
          })
          .from(whiteboardTable)
          .where(
            and(
              eq(whiteboardTable.id, whiteboardId),
              trashed
                ? isNotNull(whiteboardTable.deletedAt)
                : isNull(whiteboardTable.deletedAt),
            ),
          )
          .limit(1)
      : [];
    if (!board) throw new HTTPException(404, { message: notFound });
    await grantWorkspace(c, board.workspaceId, board.projectId, notFound);
    return next();
  };
}

/**
 * Resolves `projectId` from the query string (lists), checking workspace
 * access like `workspaceAccess.fromProject` does for paths and bodies.
 */
export function projectFromQuery(key = "projectId") {
  return async (c: Context, next: Next) => {
    if (!c.get("userId")) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    const projectId = c.req.query(key);
    const [project] = projectId
      ? await db
          .select({
            workspaceId: projectTable.workspaceId,
            deletedAt: projectTable.deletedAt,
          })
          .from(projectTable)
          .where(eq(projectTable.id, projectId))
          .limit(1)
      : [];
    if (!projectId || !project || project.deletedAt) {
      throw new HTTPException(404, { message: "Project not found" });
    }
    await grantWorkspace(
      c,
      project.workspaceId,
      projectId,
      "Project not found",
    );
    return next();
  };
}

/** The Whiteboards feature gate for routes that already resolved the project. */
export const requireWhiteboardsFeature = requireProjectFeature("whiteboards", {
  resolveProjectId: async (c) => c.get("projectId") ?? null,
});

/** Board access, a whiteboard permission, then the feature gate. */
export function whiteboardRoute(
  permission: "read" | "create" | "update" | "delete",
  options: { trashed?: boolean; idKey?: string } = {},
) {
  return [
    whiteboardAccess(options.idKey ?? "id", { trashed: options.trashed }),
    requireWorkspacePermission({ whiteboard: [permission] }),
    requireWhiteboardsFeature,
  ] as const;
}
