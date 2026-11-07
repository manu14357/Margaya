import { and, desc, eq, isNull } from "drizzle-orm";
import db from "../../database";
import { projectTable, taskTable, timeEntryTable } from "../../database/schema";
import { projectFeatureEnabledCondition } from "../../project/features";
import { notHiddenProject } from "../../project/visibility";

/**
 * The caller's running timer in this workspace, with what the web app needs to
 * name and link its task. Timers the caller could not act on read as none: on
 * a trashed task, in a project they can't see, or with time tracking off.
 */
async function getRunningTimeEntry({
  workspaceId,
  userId,
  hiddenProjectIds,
}: {
  workspaceId: string;
  userId: string;
  hiddenProjectIds: readonly string[];
}) {
  const [entry] = await db
    .select({
      id: timeEntryTable.id,
      taskId: timeEntryTable.taskId,
      startTime: timeEntryTable.startTime,
      description: timeEntryTable.description,
      taskTitle: taskTable.title,
      taskNumber: taskTable.number,
      projectId: projectTable.id,
      projectSlug: projectTable.slug,
    })
    .from(timeEntryTable)
    .innerJoin(taskTable, eq(taskTable.id, timeEntryTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(timeEntryTable.userId, userId),
        isNull(timeEntryTable.endTime),
        isNull(taskTable.deletedAt),
        eq(projectTable.workspaceId, workspaceId),
        projectFeatureEnabledCondition("timeTracking"),
        notHiddenProject(projectTable.id, hiddenProjectIds),
      ),
    )
    .orderBy(desc(timeEntryTable.startTime))
    .limit(1);

  return { entry: entry ?? null };
}

export default getRunningTimeEntry;
