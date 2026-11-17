import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTemplateApplicationTable, taskTable } from "../database/schema";
import { trashTasks } from "../trash/task-trash";

// The example tasks a template seeded, and their one-step removal. Removal
// moves the recorded tasks that are still live in this project to the trash
// as one batch (restoring that batch is the undo). Nothing else is trashed:
// tasks the team moved to another project and sub-tasks the team added
// under an example are left alone. It is idempotent.

export const NO_SAMPLE_DATA = "This project has no example tasks";
export const SAMPLE_REMOVAL_FORBIDDEN =
  "Removing example tasks needs task:delete, or task:create for the person who created the project from its template";

async function liveSampleTaskIds(projectId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(
      and(
        inArray(taskTable.id, ids),
        eq(taskTable.projectId, projectId),
        isNull(taskTable.deletedAt),
      ),
    )
    .orderBy(asc(taskTable.number));
  return rows.map((row) => row.id);
}

async function loadApplication(projectId: string) {
  const [row] = await db
    .select()
    .from(projectTemplateApplicationTable)
    .where(eq(projectTemplateApplicationTable.projectId, projectId))
    .limit(1);
  return row ?? null;
}

/** Whether the project still shows example tasks (the web's banner). */
export async function hasSampleData(projectId: string): Promise<boolean> {
  const row = await loadApplication(projectId);
  if (!row || row.sampleRemovedAt || row.sampleTaskIds.length === 0) {
    return false;
  }
  const [live] = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(
      and(
        inArray(taskTable.id, row.sampleTaskIds),
        eq(taskTable.projectId, projectId),
        isNull(taskTable.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(live);
}

export async function removeSampleData({
  projectId,
  userId,
  canDeleteTasks,
  canCreateTasks,
}: {
  projectId: string;
  userId: string;
  /** task:delete in this project: anyone with it may remove. */
  canDeleteTasks: boolean;
  /**
   * task:create in this project, checked for the caller as they are now
   * (role, API key scope, restricted project). The person who applied the
   * template may remove without task:delete only while they hold it, so a
   * demoted applier or a narrower key is refused.
   */
  canCreateTasks: boolean;
}) {
  const row = await loadApplication(projectId);
  if (!row || row.sampleTaskIds.length === 0) {
    throw new HTTPException(404, { message: NO_SAMPLE_DATA });
  }
  const isApplier = row.appliedBy !== null && row.appliedBy === userId;
  if (!canDeleteTasks && !(isApplier && canCreateTasks)) {
    throw new HTTPException(403, { message: SAMPLE_REMOVAL_FORBIDDEN });
  }
  if (row.sampleRemovedAt) return { removedTaskCount: 0, trashBatchId: null };

  const ids = await liveSampleTaskIds(projectId, row.sampleTaskIds);
  // Only recorded example tasks still in this project: sub-tasks the team
  // added under an example, or examples moved elsewhere, stay live.
  const trashed = await trashTasks(ids, userId, {
    singleBatch: true,
    onlyWithin: { projectId, taskIds: new Set(row.sampleTaskIds) },
  });
  await db
    .update(projectTemplateApplicationTable)
    .set({ sampleRemovedAt: new Date() })
    .where(eq(projectTemplateApplicationTable.projectId, projectId));
  return {
    removedTaskCount: trashed.length,
    trashBatchId: trashed[0]?.trashBatchId ?? null,
  };
}
