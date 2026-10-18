import { asc, eq } from "drizzle-orm";
import db from "../database";
import {
  columnTable,
  customFieldValueTable,
  estimatePointTable,
  labelTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../database/schema";
import { assigneeIdsOfTasks } from "../task/assignees";
import { resolveTimezone } from "../utils/zoned-date";
import type { TaskFacts } from "./evaluate";

// Reads what conditions, templates and actions need about one task.

export type LoadedTask = TaskFacts & {
  workspaceId: string;
  timezone: string;
  archivedAt: Date | null;
  deletedAt: Date | null;
  projectArchivedAt: Date | null;
  projectDeletedAt: Date | null;
};

export async function loadTaskFacts(
  taskId: string,
): Promise<LoadedTask | null> {
  const [row] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      number: taskTable.number,
      title: taskTable.title,
      status: taskTable.status,
      columnId: taskTable.columnId,
      priority: taskTable.priority,
      dueDate: taskTable.dueDate,
      estimatePointId: taskTable.estimatePointId,
      estimate: estimatePointTable.numericValue,
      createdBy: taskTable.createdBy,
      archivedAt: taskTable.archivedAt,
      deletedAt: taskTable.deletedAt,
      projectSlug: projectTable.slug,
      projectName: projectTable.name,
      leadId: projectTable.leadUserId,
      projectArchivedAt: projectTable.archivedAt,
      projectDeletedAt: projectTable.deletedAt,
      workspaceId: projectTable.workspaceId,
      timezone: workspaceTable.timezone,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .leftJoin(
      estimatePointTable,
      eq(estimatePointTable.id, taskTable.estimatePointId),
    )
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!row) return null;

  const [assignees, labels, fields] = await Promise.all([
    assigneeIdsOfTasks([taskId]),
    db
      .select({ name: labelTable.name })
      .from(labelTable)
      .where(eq(labelTable.taskId, taskId)),
    db
      .select({
        fieldId: customFieldValueTable.fieldId,
        value: customFieldValueTable.value,
      })
      .from(customFieldValueTable)
      .where(eq(customFieldValueTable.taskId, taskId)),
  ]);

  const { estimatePointId, estimate, timezone, ...rest } = row;
  return {
    ...rest,
    priority: row.priority ?? "no-priority",
    estimate: estimate ?? null,
    estimateSet: estimatePointId !== null,
    assigneeIds: assignees.get(taskId) ?? [],
    labels: labels.map((label) => label.name),
    customFields: Object.fromEntries(
      fields.map((field) => [field.fieldId, field.value]),
    ),
    timezone: resolveTimezone(timezone),
  };
}

export type ProjectColumn = {
  id: string;
  slug: string;
  name: string;
  group: string;
  isFinal: boolean;
};

export async function loadColumns(projectId: string): Promise<ProjectColumn[]> {
  return db
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      name: columnTable.name,
      group: columnTable.group,
      isFinal: columnTable.isFinal,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));
}
