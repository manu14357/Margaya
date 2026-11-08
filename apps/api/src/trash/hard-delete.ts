import { eq, inArray, or } from "drizzle-orm";
import db from "../database";
import { assetTable, taskRelationTable, taskTable } from "../database/schema";
import { publishEvent } from "../events";
import { handOverAssets } from "../storage/asset-handover";
import { deleteS3Keys } from "../storage/cleanup-assets";

// Permanent deletes (C7). The database cascades remove comments, labels,
// relations, time entries, attachments and the other task-owned rows. Files
// other text still links are handed to it first (storage/asset-handover.ts);
// the rest leave storage after the rows are gone, fire-and-forget, as before.

const CHUNK = 500;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

async function deleteTaskRows(taskIds: string[]) {
  const deleted: (typeof taskTable.$inferSelect)[] = [];
  const leaving = [...new Set(taskIds)];
  for (const ids of chunks(leaving)) {
    const assets = await db
      .select({
        id: assetTable.id,
        objectKey: assetTable.objectKey,
        workspaceId: assetTable.workspaceId,
        projectId: assetTable.projectId,
      })
      .from(assetTable)
      .where(inArray(assetTable.taskId, ids));
    const orphans = await handOverAssets(assets, { taskIds: leaving });
    const rows = await db
      .delete(taskTable)
      .where(inArray(taskTable.id, ids))
      .returning();
    deleted.push(...rows);
    if (orphans.length > 0) {
      deleteS3Keys(orphans.map((asset) => asset.objectKey)).catch(() => {});
    }
  }
  return deleted;
}

async function publishPurged(
  tasks: (typeof taskTable.$inferSelect)[],
  userId: string | null,
) {
  for (const task of tasks) {
    await publishEvent("task.purged", {
      taskId: task.id,
      projectId: task.projectId,
      userId,
      title: task.title,
      status: task.status,
    });
  }
}

/**
 * Permanently deletes these tasks (trashed or not) and their stored files.
 * Publishes task.purged for each deleted task. Returns the deleted rows.
 */
export async function hardDeleteTasks(
  taskIds: string[],
  userId: string | null,
) {
  const deleted = await deleteTaskRows(taskIds);
  await publishPurged(deleted, userId);
  return deleted;
}

/**
 * The immediate, permanent delete of one live task, used where nothing goes
 * through the trash (an intake request deleted from intake). Publishes
 * task.deleted, the relation removals, then task.purged.
 */
export async function hardDeleteLiveTask(taskId: string, userId: string) {
  const relations = await db
    .select()
    .from(taskRelationTable)
    .where(
      or(
        eq(taskRelationTable.sourceTaskId, taskId),
        eq(taskRelationTable.targetTaskId, taskId),
      ),
    );

  const [task] = await deleteTaskRows([taskId]);
  if (!task) return null;

  await publishEvent("task.deleted", {
    taskId: task.id,
    projectId: task.projectId,
    userId,
    title: task.title,
    // Lets integrations skip a request deleted while still in intake.
    status: task.status,
  });
  for (const relation of relations) {
    await publishEvent("task-relation.deleted", {
      projectId: task.projectId,
      userId,
      taskId: task.id,
      sourceTaskId: relation.sourceTaskId,
      targetTaskId: relation.targetTaskId,
      relationType: relation.relationType,
      // History of the other tasks stays untouched by a delete.
      origin: "task_deleted",
    });
  }
  await publishPurged([task], userId);
  return task;
}
