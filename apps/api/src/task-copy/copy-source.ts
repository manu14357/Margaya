import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  customFieldValueTable,
  cycleTable,
  cycleTaskTable,
  labelTable,
  moduleTable,
  moduleTaskTable,
  projectTable,
  taskLinkTable,
  taskRelationTable,
  taskTable,
} from "../database/schema";
import { assigneesOfTask } from "../task/assignees";
import { inTriageColumnSql, liveTaskCondition } from "../task/scope";
import { countAttachments } from "../task-attachment/queries";

async function loadSourceTask(taskId: string, workspaceId: string) {
  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      title: taskTable.title,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      estimatePointId: taskTable.estimatePointId,
      number: taskTable.number,
      slug: projectTable.slug,
      inTriage: inTriageColumnSql,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(taskTable.id, taskId),
        eq(projectTable.workspaceId, workspaceId),
        liveTaskCondition,
      ),
    )
    .limit(1);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  if (task.inTriage) {
    throw new HTTPException(409, {
      message: "This task is waiting in intake. Accept it before copying it.",
    });
  }
  return task;
}

/** The oldest parent inside the workspace (legacy data can hold several). */
async function loadParent(taskId: string, workspaceId: string) {
  const [parent] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      inTriage: inTriageColumnSql,
    })
    .from(taskRelationTable)
    .innerJoin(taskTable, eq(taskTable.id, taskRelationTable.sourceTaskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(taskRelationTable.targetTaskId, taskId),
        eq(taskRelationTable.relationType, "subtask"),
        eq(projectTable.workspaceId, workspaceId),
        // A trashed parent reads as gone (C7).
        liveTaskCondition,
      ),
    )
    .orderBy(asc(taskRelationTable.createdAt), asc(taskRelationTable.id))
    .limit(1);
  return parent ? { ...parent, inTriage: Boolean(parent.inTriage) } : null;
}

async function loadLabels(taskId: string, workspaceId: string) {
  const [labels, deleting] = await Promise.all([
    db
      .select({ name: labelTable.name, color: labelTable.color })
      .from(labelTable)
      .where(eq(labelTable.taskId, taskId))
      .orderBy(asc(labelTable.createdAt), asc(labelTable.id)),
    db
      .select({ name: labelTable.name })
      .from(labelTable)
      .where(
        and(
          eq(labelTable.workspaceId, workspaceId),
          isNull(labelTable.taskId),
          isNotNull(labelTable.deletionStartedAt),
        ),
      ),
  ]);
  // A label being deleted is not handed on: its sweep may have passed.
  const gone = new Set(deleting.map((label) => label.name));
  const seen = new Set<string>();
  return labels.filter((label) => {
    if (gone.has(label.name) || seen.has(label.name)) return false;
    seen.add(label.name);
    return true;
  });
}

/** Everything a copy may take from its source, read up front. */
export async function loadCopySource(taskId: string, workspaceId: string) {
  const task = await loadSourceTask(taskId, workspaceId);

  const [
    assigneeIds,
    labels,
    customValues,
    parent,
    cycles,
    modules,
    links,
    attachmentCount,
  ] = await Promise.all([
    assigneesOfTask(taskId),
    loadLabels(taskId, workspaceId),
    db
      .select({
        fieldId: customFieldValueTable.fieldId,
        value: customFieldValueTable.value,
      })
      .from(customFieldValueTable)
      .where(eq(customFieldValueTable.taskId, taskId)),
    loadParent(taskId, workspaceId),
    db
      .select({ cycleId: cycleTaskTable.cycleId })
      .from(cycleTaskTable)
      .innerJoin(cycleTable, eq(cycleTable.id, cycleTaskTable.cycleId))
      .where(
        and(
          eq(cycleTaskTable.taskId, taskId),
          eq(cycleTable.projectId, task.projectId),
        ),
      )
      .limit(1),
    db
      .select({ moduleId: moduleTaskTable.moduleId })
      .from(moduleTaskTable)
      .innerJoin(moduleTable, eq(moduleTable.id, moduleTaskTable.moduleId))
      .where(
        and(
          eq(moduleTaskTable.taskId, taskId),
          eq(moduleTable.projectId, task.projectId),
          isNull(moduleTable.archivedAt),
        ),
      ),
    db
      .select({ url: taskLinkTable.url, title: taskLinkTable.title })
      .from(taskLinkTable)
      .where(eq(taskLinkTable.taskId, taskId))
      .orderBy(asc(taskLinkTable.createdAt), asc(taskLinkTable.id)),
    countAttachments(taskId),
  ]);

  return {
    task,
    assigneeIds,
    labels,
    customValues: new Map(customValues.map((row) => [row.fieldId, row.value])),
    parent,
    cycleId: cycles[0]?.cycleId ?? null,
    moduleIds: modules.map((row) => row.moduleId),
    links,
    attachmentCount,
  };
}

export type CopySource = Awaited<ReturnType<typeof loadCopySource>>;
