import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { assetTable, projectTable, taskTable } from "../database/schema";
import { publishEvent } from "../events";
import { handOverAssets } from "../storage/asset-handover";
import { deleteS3Keys } from "../storage/cleanup-assets";
import { restoreBatch } from "./task-trash";

// Project trash (C7). Deleting a project stamps it and every live task in it
// (batch id = the project id), so a restore brings back exactly those tasks;
// tasks trashed on their own before stay in the project's trash. While
// trashed, the project and everything in it read as gone.

type ProjectRow = typeof projectTable.$inferSelect;

function projectEvent(project: ProjectRow, userId: string | null) {
  return {
    projectId: project.id,
    workspaceId: project.workspaceId,
    userId,
    name: project.name,
    slug: project.slug,
  };
}

/** Moves a live project and its live tasks to the trash. */
export async function trashProject(
  projectId: string,
  workspaceId: string,
  userId: string,
) {
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [project] = await tx
      .update(projectTable)
      .set({ deletedAt: now, deletedBy: userId })
      .where(
        and(
          eq(projectTable.id, projectId),
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
        ),
      )
      .returning();
    if (!project) return null;
    const tasks = await tx
      .update(taskTable)
      .set({ deletedAt: now, deletedBy: userId, trashBatchId: projectId })
      .where(
        and(eq(taskTable.projectId, projectId), isNull(taskTable.deletedAt)),
      )
      .returning({ id: taskTable.id });
    return { project, taskCount: tasks.length };
  });
  if (!result) throw new HTTPException(404, { message: "Project not found" });

  // One event for the whole batch: no per-task task.deleted, so integrations
  // and webhooks are not flooded; project.deleted keeps meaning "gone".
  await publishEvent("project.deleted", {
    ...projectEvent(result.project, userId),
    taskCount: result.taskCount,
    type: "deleted",
  });
  return result.project;
}

async function loadTrashedProject(projectId: string, workspaceId: string) {
  const [project] = await db
    .select()
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNotNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!project) {
    throw new HTTPException(404, { message: "Project not found in the trash" });
  }
  return project;
}

/** Restores a trashed project with the tasks that were trashed with it. */
export async function restoreTrashedProject(
  projectId: string,
  workspaceId: string,
  userId: string,
) {
  await loadTrashedProject(projectId, workspaceId);
  const result = await db.transaction(async (tx) => {
    const [project] = await tx
      .update(projectTable)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(eq(projectTable.id, projectId), isNotNull(projectTable.deletedAt)),
      )
      .returning();
    if (!project) return null;
    const tasks = await restoreBatch(tx, projectId, projectId);
    return { project, taskCount: tasks.length };
  });
  if (!result) {
    throw new HTTPException(404, { message: "Project not found in the trash" });
  }
  await publishEvent("project.restored", {
    ...projectEvent(result.project, userId),
    taskCount: result.taskCount,
    type: "restored",
  });
  return result.project;
}

/**
 * Permanently deletes a project: the database cascades remove its tasks and
 * everything else in it. Files that text in another project still links are
 * handed to it first; the other stored files are cleaned up afterwards.
 */
export async function hardDeleteProject(
  project: ProjectRow,
  userId: string | null,
) {
  const assets = await db
    .select({
      id: assetTable.id,
      objectKey: assetTable.objectKey,
      workspaceId: assetTable.workspaceId,
      projectId: assetTable.projectId,
    })
    .from(assetTable)
    .where(eq(assetTable.projectId, project.id));
  const orphans = await handOverAssets(assets, { projectId: project.id });
  const [deleted] = await db
    .delete(projectTable)
    .where(eq(projectTable.id, project.id))
    .returning();
  if (!deleted) return null;
  if (orphans.length > 0) {
    deleteS3Keys(orphans.map((asset) => asset.objectKey)).catch(() => {});
  }
  await publishEvent("project.purged", projectEvent(deleted, userId));
  return deleted;
}

/** Permanently deletes a trashed project. */
export async function purgeTrashedProject(
  projectId: string,
  workspaceId: string,
  userId: string,
) {
  const project = await loadTrashedProject(projectId, workspaceId);
  const deleted = await hardDeleteProject(project, userId);
  if (!deleted) {
    throw new HTTPException(404, { message: "Project not found in the trash" });
  }
  return deleted;
}
