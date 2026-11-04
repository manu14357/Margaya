import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable, taskExportTable } from "../../database/schema";
import { hiddenProjectIds, notHiddenProject } from "../../project/visibility";
import {
  LOCK_NAMESPACE,
  lockUserWorkspaceList,
} from "../../utils/user-workspace-lock";
import { publishExportStatus } from "../events";
import type { TaskExportRow } from "../job";
import { kickExportRunner } from "../runner";
import { MAX_ACTIVE_EXPORTS_PER_USER } from "../types";
import { TOO_MANY_ACTIVE } from "./create-task-export";

export const WORKSPACE_EXPORT_RUNNING =
  "A whole-workspace export is already in progress. Wait for it to finish.";

/**
 * Queues a whole-workspace export: every project that isn't trashed, archived
 * ones included, except those the requester may not see. A workspace without
 * projects still has pages and settings to export.
 */
export async function createWorkspaceExport(input: {
  workspaceId: string;
  userId: string;
  includeFiles: boolean;
}): Promise<TaskExportRow> {
  const hidden = await hiddenProjectIds(input.userId, input.workspaceId);
  const projects = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, input.workspaceId),
        isNull(projectTable.deletedAt),
        notHiddenProject(projectTable.id, hidden),
      ),
    )
    .orderBy(
      asc(projectTable.position),
      asc(projectTable.createdAt),
      asc(projectTable.id),
    );

  const row = await db.transaction(async (tx) => {
    // Across requesters: two admins starting at once must not both pass the
    // one-at-a-time check below, and the lock after this one is per person.
    await lockUserWorkspaceList(
      tx,
      LOCK_NAMESPACE.taskExport,
      "whole-workspace",
      input.workspaceId,
    );
    await lockUserWorkspaceList(
      tx,
      LOCK_NAMESPACE.taskExport,
      input.userId,
      input.workspaceId,
    );
    const [active] = await tx
      .select({
        mine: sql<number>`count(*) filter (where ${taskExportTable.requestedBy} = ${input.userId})::int`.mapWith(
          Number,
        ),
        workspaceExports:
          sql<number>`count(*) filter (where ${taskExportTable.kind} = 'workspace')::int`.mapWith(
            Number,
          ),
      })
      .from(taskExportTable)
      .where(
        and(
          eq(taskExportTable.workspaceId, input.workspaceId),
          inArray(taskExportTable.status, ["queued", "processing"]),
        ),
      );
    // One at a time: each costs minutes of work and gigabytes of disk.
    if ((active?.workspaceExports ?? 0) > 0) {
      throw new HTTPException(409, { message: WORKSPACE_EXPORT_RUNNING });
    }
    if ((active?.mine ?? 0) >= MAX_ACTIVE_EXPORTS_PER_USER) {
      throw new HTTPException(409, { message: TOO_MANY_ACTIVE });
    }
    const [inserted] = await tx
      .insert(taskExportTable)
      .values({
        workspaceId: input.workspaceId,
        requestedBy: input.userId,
        kind: "workspace",
        // The data files inside the archive are JSON.
        format: "json",
        projectIds: projects.map((project) => project.id),
        includeArchived: true,
        includeFiles: input.includeFiles,
      })
      .returning();
    if (!inserted) throw new Error("Failed to create the export");
    return inserted;
  });

  await publishExportStatus(row, "queued");
  void kickExportRunner();
  return row;
}
