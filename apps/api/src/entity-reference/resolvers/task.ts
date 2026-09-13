import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import { columnTable, projectTable, taskTable } from "../../database/schema";
import { assigneesOfTasks } from "../../task/assignees";
import { taskColumnJoin, taskGroupSql } from "../../task/scope";
import { type EntityResolver, type EntitySummary, trashedFlag } from "../types";

export const resolveTasks: EntityResolver = async ({ workspaceId }, ids) => {
  const rows = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      status: taskTable.status,
      archivedAt: taskTable.archivedAt,
      priority: taskTable.priority,
      assigneeId: taskTable.userId,
      group: taskGroupSql,
      projectId: projectTable.id,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      projectArchivedAt: projectTable.archivedAt,
      deletedAt: taskTable.deletedAt,
      projectDeletedAt: projectTable.deletedAt,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        inArray(taskTable.id, ids),
      ),
    );
  const assigneesByTask = await assigneesOfTasks(rows.map((task) => task.id));

  return new Map(
    rows.map((task): [string, EntitySummary] => [
      task.id,
      {
        type: "task",
        id: task.id,
        name: task.title,
        key: `${task.projectSlug}-${task.number}`,
        icon: null,
        projectId: task.projectId,
        projectName: task.projectName,
        isArchived: task.archivedAt !== null || task.projectArchivedAt !== null,
        ...trashedFlag(task.deletedAt, task.projectDeletedAt),
        feature: null,
        details: {
          group: task.group,
          priority: task.priority,
          assigneeId: task.assigneeId,
          assigneeIds: assigneesByTask.get(task.id) ?? [],
          status: task.status,
        },
      },
    ]),
  );
};
