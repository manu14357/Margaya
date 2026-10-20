import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable } from "../database/schema";
import {
  notHiddenProject,
  requestHiddenProjectIds,
} from "../project/visibility";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";

// Archives read the whole workspace (its projects that are not archived;
// things inside an archived project come back with the project) or one
// project, archived or not. Permissions are resolved once per request.

export type ArchiveCapabilities = {
  taskRead: boolean;
  cycleRead: boolean;
  cycleUpdate: boolean;
  cycleDelete: boolean;
  moduleRead: boolean;
  moduleUpdate: boolean;
  moduleDelete: boolean;
  projectUpdate: boolean;
  projectDelete: boolean;
};

export type ArchiveScope = {
  workspaceId: string;
  userId: string;
  /** Set in a project scope. */
  projectId: string | null;
  /** A condition on `projectTable` selecting the scope's projects. */
  projects: SQL;
  /** Whether any project in scope has the feature on. */
  cyclesOn: boolean;
  modulesOn: boolean;
  can: ArchiveCapabilities;
};

export async function resolveArchiveScope(
  c: Context,
  projectId: string | undefined,
): Promise<ArchiveScope> {
  const workspaceId: string = c.get("workspaceId");
  // Restricted projects the caller may not see read as missing.
  const hidden = await requestHiddenProjectIds(c);
  // Trashed projects read as gone (C7).
  const projects = projectId
    ? (and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
        notHiddenProject(projectTable.id, hidden),
      ) as SQL)
    : (and(
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
        notHiddenProject(projectTable.id, hidden),
      ) as SQL);

  const [features] = await db
    .select({
      total: sql<number>`count(*)::int`,
      cycles: sql<number>`count(*) filter (where ${projectTable.cyclesEnabled})::int`,
      modules: sql<number>`count(*) filter (where ${projectTable.modulesEnabled})::int`,
    })
    .from(projectTable)
    .where(projects);
  if (projectId && !features?.total) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  // A project scope's rights are capped by the caller's project role.
  if (projectId) c.set("projectId", projectId);
  const allowed = await workspacePermissionChecker(c);
  return {
    workspaceId,
    userId: c.get("userId"),
    projectId: projectId ?? null,
    projects,
    cyclesOn: (features?.cycles ?? 0) > 0,
    modulesOn: (features?.modules ?? 0) > 0,
    can: {
      taskRead: allowed({ task: ["read"] }),
      cycleRead: allowed({ cycle: ["read"] }),
      cycleUpdate: allowed({ cycle: ["update"] }),
      cycleDelete: allowed({ cycle: ["delete"] }),
      moduleRead: allowed({ module: ["read"] }),
      moduleUpdate: allowed({ module: ["update"] }),
      moduleDelete: allowed({ module: ["delete"] }),
      projectUpdate: allowed({ project: ["update"] }),
      projectDelete: allowed({ project: ["delete"] }),
    },
  };
}
