import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable, taskExportTable } from "../../database/schema";
import { hiddenProjectIds, notHiddenProject } from "../../project/visibility";
import { textArray } from "../../task-query/context";
import {
  LOCK_NAMESPACE,
  lockUserWorkspaceList,
} from "../../utils/user-workspace-lock";
import { publishExportStatus } from "../events";
import type { TaskExportRow } from "../job";
import { kickExportRunner } from "../runner";
import { MAX_ACTIVE_EXPORTS_PER_USER, type TaskExportFormat } from "../types";

export const NO_PROJECTS = "There are no projects to export";
export const TOO_MANY_ACTIVE = `You already have ${MAX_ACTIVE_EXPORTS_PER_USER} exports in progress. Wait for one to finish.`;

const projectOrder = [
  asc(projectTable.position),
  asc(projectTable.createdAt),
  asc(projectTable.id),
];

/**
 * The projects to export in the workspace's project order: the requested
 * ones (archived allowed; any foreign id is a 404), or every non-archived
 * project when none are named.
 */
export async function resolveExportProjectIds(
  workspaceId: string,
  requested: readonly string[] | undefined,
  /** Restricted projects the requester may not see: read as missing. */
  hidden: readonly string[] = [],
): Promise<string[]> {
  const unique = [...new Set(requested ?? [])];
  if (unique.length > 0) {
    const rows = await db
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          sql`${projectTable.id} = any(${textArray(unique)})`,
          // A trashed project reads as gone (C7).
          isNull(projectTable.deletedAt),
          notHiddenProject(projectTable.id, hidden),
        ),
      )
      .orderBy(...projectOrder);
    if (rows.length !== unique.length) {
      throw new HTTPException(404, { message: "Project not found" });
    }
    return rows.map((row) => row.id);
  }

  const rows = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
        notHiddenProject(projectTable.id, hidden),
      ),
    )
    .orderBy(...projectOrder);
  if (rows.length === 0) {
    throw new HTTPException(400, { message: NO_PROJECTS });
  }
  return rows.map((row) => row.id);
}

export async function createTaskExport(input: {
  workspaceId: string;
  userId: string;
  format: TaskExportFormat;
  projectIds?: string[];
  splitByProject: boolean;
  includeArchived: boolean;
}): Promise<TaskExportRow> {
  const projectIds = await resolveExportProjectIds(
    input.workspaceId,
    input.projectIds,
    await hiddenProjectIds(input.userId, input.workspaceId),
  );

  const row = await db.transaction(async (tx) => {
    // Serializes the in-progress cap with the insert.
    await lockUserWorkspaceList(
      tx,
      LOCK_NAMESPACE.taskExport,
      input.userId,
      input.workspaceId,
    );
    const [active] = await tx
      .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
      .from(taskExportTable)
      .where(
        and(
          eq(taskExportTable.requestedBy, input.userId),
          eq(taskExportTable.workspaceId, input.workspaceId),
          inArray(taskExportTable.status, ["queued", "processing"]),
        ),
      );
    if ((active?.count ?? 0) >= MAX_ACTIVE_EXPORTS_PER_USER) {
      throw new HTTPException(409, { message: TOO_MANY_ACTIVE });
    }
    const [inserted] = await tx
      .insert(taskExportTable)
      .values({
        workspaceId: input.workspaceId,
        requestedBy: input.userId,
        format: input.format,
        projectIds,
        splitByProject: input.splitByProject && projectIds.length > 1,
        includeArchived: input.includeArchived,
      })
      .returning();
    if (!inserted) throw new Error("Failed to create the export");
    return inserted;
  });

  await publishExportStatus(row, "queued");
  void kickExportRunner();
  return row;
}
