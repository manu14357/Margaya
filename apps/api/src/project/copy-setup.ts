import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  activityTable,
  columnTable,
  customFieldDefinitionTable,
  customFieldValueTable,
  estimatePointTable,
  estimateTable,
  labelTable,
  projectAutomationTable,
  projectTable,
  taskAssigneeTable,
  taskRelationTable,
  taskTable,
  taskTemplateTable,
  workspaceUserTable,
} from "../database/schema";
import type { Transaction } from "../task/assignee-writes";
import { taskColumnJoin, taskGroupSql } from "../task/scope";
import { shiftDate } from "../utils/calendar-date";
import { projectToday } from "../utils/timezone";

// "Create project from an existing project": the new project gets the
// source's setup (statuses, custom fields, estimate systems, feature
// toggles, lead and default assignee, scheduled automations) and, when
// asked, its task templates and open tasks. Integrations, webhooks, public
// boards, workflow rules and members' personal data are never copied, and
// the source must be a live project of the same workspace.

export const MAX_COPIED_OPEN_TASKS = 500;
export const SOURCE_NOT_FOUND = "Source project not found";

export type CopyFromOptions = {
  projectId: string;
  taskTemplates: boolean;
  openTasks: boolean;
};

type SourceProject = typeof projectTable.$inferSelect;

/** The source project's row, locked against concurrent deletes. */
export async function loadSourceProject(
  tx: Transaction,
  workspaceId: string,
  projectId: string,
): Promise<SourceProject> {
  const [source] = await tx
    .select()
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .for("share");
  if (!source) throw new HTTPException(404, { message: SOURCE_NOT_FOUND });
  return source;
}

/** The project fields copied onto the new project's insert. */
export async function copiedProjectFields(
  tx: Transaction,
  source: SourceProject,
) {
  const people = [source.leadUserId, source.defaultAssigneeUserId].filter(
    (id): id is string => Boolean(id),
  );
  const members = await memberSet(tx, source.workspaceId, people);
  const member = (id: string | null) => (id && members.has(id) ? id : null);
  return {
    description: source.description,
    cyclesEnabled: source.cyclesEnabled,
    modulesEnabled: source.modulesEnabled,
    viewsEnabled: source.viewsEnabled,
    pagesEnabled: source.pagesEnabled,
    intakeEnabled: source.intakeEnabled,
    estimatesEnabled: source.estimatesEnabled,
    timeTrackingEnabled: source.timeTrackingEnabled,
    updatesEnabled: source.updatesEnabled,
    leadUserId: member(source.leadUserId),
    defaultAssigneeUserId: member(source.defaultAssigneeUserId),
  };
}

async function memberSet(
  tx: Transaction,
  workspaceId: string,
  userIds: readonly string[],
) {
  if (userIds.length === 0) return new Set<string>();
  const rows = await tx
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        inArray(workspaceUserTable.userId, [...new Set(userIds)]),
      ),
    );
  return new Set(rows.map((row) => row.userId));
}

/**
 * Copies the source's setup into the freshly inserted project, inside the
 * create's transaction. Returns how many open tasks were copied.
 */
export async function copyProjectSetup(
  tx: Transaction,
  {
    source,
    targetId,
    userId,
    options,
  }: {
    source: SourceProject;
    targetId: string;
    userId: string;
    options: CopyFromOptions;
  },
): Promise<{ copiedTaskCount: number }> {
  // Statuses. The intake triage column is made lazily, so it is skipped.
  const sourceColumns = await tx
    .select()
    .from(columnTable)
    .where(eq(columnTable.projectId, source.id))
    .orderBy(asc(columnTable.position));
  const columnMap = new Map<string, string>();
  for (const column of sourceColumns) {
    if (column.group === "triage") continue;
    const [created] = await tx
      .insert(columnTable)
      .values({
        projectId: targetId,
        name: column.name,
        slug: column.slug,
        position: column.position,
        icon: column.icon,
        color: column.color,
        group: column.group,
        isFinal: column.isFinal,
      })
      .returning({ id: columnTable.id });
    if (created) columnMap.set(column.id, created.id);
  }

  // Custom field definitions.
  const fields = await tx
    .select()
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.projectId, source.id));
  const fieldMap = new Map<string, string>();
  for (const field of fields) {
    const [created] = await tx
      .insert(customFieldDefinitionTable)
      .values({
        projectId: targetId,
        name: field.name,
        type: field.type,
        required: field.required,
        defaultValue: field.defaultValue,
        options: field.options,
        position: field.position,
      })
      .returning({ id: customFieldDefinitionTable.id });
    if (created) fieldMap.set(field.id, created.id);
  }

  // Estimate systems and their values.
  const estimates = await tx
    .select()
    .from(estimateTable)
    .where(eq(estimateTable.projectId, source.id));
  const pointMap = new Map<string, string>();
  for (const estimate of estimates) {
    const [created] = await tx
      .insert(estimateTable)
      .values({
        projectId: targetId,
        name: estimate.name,
        type: estimate.type,
        isActive: estimate.isActive,
        createdBy: userId,
      })
      .returning({ id: estimateTable.id });
    if (!created) continue;
    const points = await tx
      .select()
      .from(estimatePointTable)
      .where(eq(estimatePointTable.estimateId, estimate.id));
    for (const point of points) {
      const [copy] = await tx
        .insert(estimatePointTable)
        .values({
          estimateId: created.id,
          value: point.value,
          numericValue: point.numericValue,
          position: point.position,
        })
        .returning({ id: estimatePointTable.id });
      if (copy) pointMap.set(point.id, copy.id);
    }
  }

  // Scheduled automations (settings only, never their history).
  const [automation] = await tx
    .select()
    .from(projectAutomationTable)
    .where(eq(projectAutomationTable.projectId, source.id))
    .limit(1);
  if (automation) {
    await tx.insert(projectAutomationTable).values({
      projectId: targetId,
      autoArchiveEnabled: automation.autoArchiveEnabled,
      autoArchiveMonths: automation.autoArchiveMonths,
      autoCloseEnabled: automation.autoCloseEnabled,
      autoCloseMonths: automation.autoCloseMonths,
      autoCloseColumnId: automation.autoCloseColumnId
        ? (columnMap.get(automation.autoCloseColumnId) ?? null)
        : null,
      cycleRolloverEnabled: automation.cycleRolloverEnabled,
      cycleRolloverSince: automation.cycleRolloverEnabled
        ? shiftDate(await projectToday(source.id, tx), -1)
        : null,
      updatedBy: userId,
    });
  }

  if (options.taskTemplates) {
    const templates = await tx
      .select()
      .from(taskTemplateTable)
      .where(eq(taskTemplateTable.projectId, source.id));
    if (templates.length > 0) {
      await tx.insert(taskTemplateTable).values(
        templates.map((template) => ({
          projectId: targetId,
          name: template.name,
          titlePattern: template.titlePattern,
          description: template.description,
          columnId: template.columnId
            ? (columnMap.get(template.columnId) ?? null)
            : null,
          priority: template.priority,
          labelIds: template.labelIds,
          assigneeIds: template.assigneeIds,
          estimatePointId: template.estimatePointId
            ? (pointMap.get(template.estimatePointId) ?? null)
            : null,
          subtasks: template.subtasks,
          position: template.position,
          createdBy: userId,
        })),
      );
    }
  }

  const copiedTaskCount = options.openTasks
    ? await copyOpenTasks(tx, {
        source,
        targetId,
        userId,
        columnMap,
        fieldMap,
        pointMap,
      })
    : 0;
  return { copiedTaskCount };
}

/**
 * Copies the source's open tasks (backlog, not started, started; not
 * archived, trashed or waiting in intake) with their assignees who are
 * still members, labels, custom field values, estimates and sub-task links
 * among the copied tasks. Comments, attachments, history, cycles and
 * modules stay with the source.
 */
async function copyOpenTasks(
  tx: Transaction,
  {
    source,
    targetId,
    userId,
    columnMap,
    fieldMap,
    pointMap,
  }: {
    source: SourceProject;
    targetId: string;
    userId: string;
    columnMap: Map<string, string>;
    fieldMap: Map<string, string>;
    pointMap: Map<string, string>;
  },
): Promise<number> {
  const tasks = await tx
    .select({
      id: taskTable.id,
      title: taskTable.title,
      description: taskTable.description,
      status: taskTable.status,
      columnId: taskTable.columnId,
      priority: taskTable.priority,
      position: taskTable.position,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      estimatePointId: taskTable.estimatePointId,
      number: taskTable.number,
    })
    .from(taskTable)
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        eq(taskTable.projectId, source.id),
        isNull(taskTable.archivedAt),
        isNull(taskTable.deletedAt),
        sql`${taskGroupSql} in ('backlog', 'unstarted', 'started')`,
      ),
    )
    .orderBy(asc(taskTable.number))
    .limit(MAX_COPIED_OPEN_TASKS + 1);
  if (tasks.length > MAX_COPIED_OPEN_TASKS) {
    throw new HTTPException(400, {
      message: `The project has more than ${MAX_COPIED_OPEN_TASKS} open tasks; copy it without them`,
    });
  }
  if (tasks.length === 0) return 0;
  const sourceIds = tasks.map((task) => task.id);

  const assignees = await tx
    .select({
      taskId: taskAssigneeTable.taskId,
      userId: taskAssigneeTable.userId,
    })
    .from(taskAssigneeTable)
    .innerJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, taskAssigneeTable.userId),
        eq(workspaceUserTable.workspaceId, source.workspaceId),
      ),
    )
    .where(inArray(taskAssigneeTable.taskId, sourceIds))
    .orderBy(asc(taskAssigneeTable.position));
  const assigneesOf = new Map<string, string[]>();
  for (const row of assignees) {
    assigneesOf.set(row.taskId, [
      ...(assigneesOf.get(row.taskId) ?? []),
      row.userId,
    ]);
  }

  const taskMap = new Map<string, string>();
  let number = 0;
  for (const task of tasks) {
    number += 1;
    const owners = assigneesOf.get(task.id) ?? [];
    const columnId = task.columnId
      ? (columnMap.get(task.columnId) ?? null)
      : null;
    const [created] = await tx
      .insert(taskTable)
      .values({
        projectId: targetId,
        number,
        position: task.position,
        title: task.title,
        description: task.description,
        status: task.status,
        columnId,
        priority: task.priority,
        startDate: task.startDate,
        dueDate: task.dueDate,
        userId: owners[0] ?? null,
        createdBy: userId,
        estimatePointId: task.estimatePointId
          ? (pointMap.get(task.estimatePointId) ?? null)
          : null,
      })
      .returning({ id: taskTable.id });
    if (!created) continue;
    taskMap.set(task.id, created.id);
    if (owners.length > 0) {
      await tx.insert(taskAssigneeTable).values(
        owners.map((owner, position) => ({
          taskId: created.id,
          userId: owner,
          position,
        })),
      );
    }
  }
  await tx
    .update(projectTable)
    .set({ lastTaskNumber: number })
    .where(eq(projectTable.id, targetId));

  const newId = (id: string) => taskMap.get(id);

  const labels = await tx
    .select({
      taskId: labelTable.taskId,
      name: labelTable.name,
      color: labelTable.color,
    })
    .from(labelTable)
    .where(inArray(labelTable.taskId, sourceIds));
  const labelRows = labels.flatMap((label) => {
    const taskId = label.taskId ? newId(label.taskId) : undefined;
    return taskId
      ? [
          {
            taskId,
            name: label.name,
            color: label.color,
            workspaceId: source.workspaceId,
          },
        ]
      : [];
  });
  if (labelRows.length > 0) await tx.insert(labelTable).values(labelRows);

  const values = await tx
    .select({
      taskId: customFieldValueTable.taskId,
      fieldId: customFieldValueTable.fieldId,
      value: customFieldValueTable.value,
    })
    .from(customFieldValueTable)
    .where(inArray(customFieldValueTable.taskId, sourceIds));
  const valueRows = values.flatMap((row) => {
    const taskId = newId(row.taskId);
    const fieldId = fieldMap.get(row.fieldId);
    return taskId && fieldId ? [{ taskId, fieldId, value: row.value }] : [];
  });
  if (valueRows.length > 0) {
    await tx.insert(customFieldValueTable).values(valueRows);
  }

  const relations = await tx
    .select({
      sourceTaskId: taskRelationTable.sourceTaskId,
      targetTaskId: taskRelationTable.targetTaskId,
    })
    .from(taskRelationTable)
    .where(
      and(
        eq(taskRelationTable.relationType, "subtask"),
        inArray(taskRelationTable.sourceTaskId, sourceIds),
        inArray(taskRelationTable.targetTaskId, sourceIds),
      ),
    );
  const relationRows = relations.flatMap((relation) => {
    const parent = newId(relation.sourceTaskId);
    const child = newId(relation.targetTaskId);
    return parent && child
      ? [{ sourceTaskId: parent, targetTaskId: child, relationType: "subtask" }]
      : [];
  });
  if (relationRows.length > 0) {
    await tx.insert(taskRelationTable).values(relationRows);
  }

  // One "created" history row per copy, written here rather than through
  // per-task events: the project is new, nobody watches it yet, and
  // assignees should not get one notification per copied task.
  await tx.insert(activityTable).values(
    [...taskMap.values()].map((taskId) => ({
      taskId,
      type: "create",
      userId,
      content: null,
      eventData: { copiedFromProjectId: source.id },
    })),
  );
  return taskMap.size;
}
