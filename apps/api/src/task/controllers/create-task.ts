import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  columnTable,
  customFieldDefinitionTable,
  customFieldValueTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { assertTaskEstimatePoint } from "../../estimate/assert-task-estimate";
import { shareProjectEstimates } from "../../estimate/write";
import { publishEvent } from "../../events";
import { assertProjectFeatureEnabled } from "../../project/features";
import {
  assertAssignableUsers,
  getProjectWorkspaceId,
} from "../../utils/assert-assignable-user";
import { archivedTaskLanding, publishArchiveChange } from "../archive";
import { resolveCreateAssignees } from "../assignee-rules";
import { insertInitialAssignees, type Transaction } from "../assignee-writes";
import {
  completedAtForInsert,
  parseStatusInput,
  type TaskGroup,
  taskGroupOf,
} from "../scope";
import {
  assertRequiredCustomFields,
  assertValidTaskStatus,
} from "../validate-task-fields";
import { claimTaskNumber } from "./claim-task-numbers";
import { nextTaskPosition } from "./next-task-position";

type CustomFieldInput = {
  fieldId: string;
  value: string;
};

function deduplicateCustomFields(
  customFields?: CustomFieldInput[],
): CustomFieldInput[] | undefined {
  if (!customFields) {
    return undefined;
  }

  const fieldsById = new Map<string, CustomFieldInput>();

  for (const customField of customFields) {
    fieldsById.set(customField.fieldId, customField);
  }

  return Array.from(fieldsById.values());
}

export type CreateTaskInput = {
  projectId: string;
  currentUserId: string;
  userId?: string;
  assigneeIds?: string[];
  title: string;
  status: string;
  startDate?: Date;
  dueDate?: Date;
  description?: string;
  priority?: string;
  customFields?: CustomFieldInput[];
  estimatePointId?: string | null;
};

/** Everything a create needs once validated, before the transaction. */
export type PreparedTaskCreate = {
  projectId: string;
  currentUserId: string;
  title: string;
  description: string;
  status: string;
  column: { id: string; group: TaskGroup } | undefined;
  /** Set when the legacy `archived` status creates the task archived. */
  archived: boolean;
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  assigneeIds: string[];
  assigneeName: string | undefined;
  customFields: CustomFieldInput[];
  estimatePointId: string | null;
};

/**
 * The validation half of a create: status, required custom fields (filled
 * from their defaults), assignees and the target column. Throws the create
 * route's 4xx answers; writes nothing.
 */
export async function prepareTaskCreate({
  projectId,
  currentUserId,
  userId,
  assigneeIds: requestedAssigneeIds,
  title,
  status,
  startDate,
  dueDate,
  description,
  priority,
  customFields,
  estimatePointId,
}: CreateTaskInput): Promise<PreparedTaskCreate> {
  const resolvedStatus = status || "to-do";
  const resolvedPriority = priority || "no-priority";
  const normalizedCustomFields = deduplicateCustomFields(customFields);

  const assigneeIds = resolveCreateAssignees({
    assigneeIds: requestedAssigneeIds,
    userId,
  });

  // Only a real estimate needs the feature, so clients that never send one
  // are unaffected by it being off.
  if (estimatePointId) {
    await assertProjectFeatureEnabled(projectId, "estimates");
  }

  await assertValidTaskStatus(resolvedStatus, projectId);

  const allFields = await db
    .select()
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.projectId, projectId));

  const mergedCustomFields: CustomFieldInput[] = normalizedCustomFields ?? [];
  const providedFieldIds = new Set(mergedCustomFields.map((f) => f.fieldId));

  for (const field of allFields) {
    if (
      !providedFieldIds.has(field.id) &&
      field.required &&
      field.defaultValue != null &&
      field.defaultValue.trim() !== ""
    ) {
      mergedCustomFields.push({
        fieldId: field.id,
        value: field.defaultValue,
      });
    }
  }

  await assertRequiredCustomFields(projectId, mergedCustomFields);

  let assignee: { name: string } | undefined;
  const [firstAssigneeId] = assigneeIds;

  if (firstAssigneeId) {
    await assertAssignableUsers(
      assigneeIds,
      await getProjectWorkspaceId(projectId),
    );

    [assignee] = await db
      .select({ name: userTable.name })
      .from(userTable)
      .where(eq(userTable.id, firstAssigneeId));
  }

  // The legacy "archived" status creates an archived task in the entry
  // column (D7).
  const statusInput = parseStatusInput(resolvedStatus);
  const landing = statusInput.archive
    ? await archivedTaskLanding(db, projectId, "entry")
    : null;
  const column = landing
    ? landing.columnId
      ? { id: landing.columnId, group: landing.group }
      : undefined
    : await db.query.columnTable.findFirst({
        where: and(
          eq(columnTable.projectId, projectId),
          eq(columnTable.slug, resolvedStatus),
        ),
      });

  return {
    projectId,
    currentUserId,
    title: title || "",
    description: description || "",
    status: landing?.status ?? resolvedStatus,
    column: column ? { id: column.id, group: column.group } : undefined,
    archived: landing !== null,
    priority: resolvedPriority,
    startDate: startDate || null,
    dueDate: dueDate || null,
    assigneeIds,
    assigneeName: assignee?.name,
    customFields: mergedCustomFields,
    estimatePointId: estimatePointId || null,
  };
}

/**
 * The write half of a create, inside the caller's transaction: claims the
 * next number (which locks the project row), places the task at the bottom
 * of its column and writes its assignees and custom field values. Publishes
 * nothing.
 */
export async function insertTaskInTransaction(
  tx: Transaction,
  prepared: PreparedTaskCreate,
) {
  const { projectId, estimatePointId } = prepared;
  if (estimatePointId) {
    await shareProjectEstimates(tx, projectId);
    await assertTaskEstimatePoint(projectId, estimatePointId, tx);
  }
  const taskNumber = await claimTaskNumber(projectId, tx);
  const nextPosition = await nextTaskPosition(
    tx,
    projectId,
    prepared.status,
    prepared.column?.id ?? null,
  );

  const [task] = await tx
    .insert(taskTable)
    .values({
      projectId,
      userId: prepared.assigneeIds[0] ?? null,
      title: prepared.title,
      status: prepared.status,
      columnId: prepared.column?.id ?? null,
      completedAt: completedAtForInsert(
        taskGroupOf(prepared.status, prepared.column),
        new Date(),
      ),
      archivedAt: prepared.archived ? new Date() : null,
      createdBy: prepared.currentUserId || null,
      startDate: prepared.startDate,
      dueDate: prepared.dueDate,
      description: prepared.description,
      priority: prepared.priority,
      number: taskNumber,
      position: nextPosition,
      estimatePointId,
    })
    .returning();

  if (!task) {
    throw new HTTPException(500, { message: "Failed to create task" });
  }

  await insertInitialAssignees(tx, task.id, prepared.assigneeIds);

  if (prepared.customFields.length) {
    await tx.insert(customFieldValueTable).values(
      prepared.customFields.map(({ fieldId, value }) => ({
        taskId: task.id,
        fieldId,
        value: value.trim(),
      })),
    );
  }

  return task;
}

type CreatedTask = Awaited<ReturnType<typeof insertTaskInTransaction>>;

/**
 * After the commit: `task.created` (activity, notifications, realtime,
 * integrations), plus `task.archived` for a task created archived.
 */
export async function publishTaskCreated(
  task: CreatedTask,
  prepared: Pick<PreparedTaskCreate, "assigneeIds" | "currentUserId">,
  extra: { source?: string } = {},
) {
  await publishEvent("task.created", {
    ...task,
    taskId: task.id,
    userId: task.userId ?? "",
    assigneeIds: prepared.assigneeIds,
    currentUserId: prepared.currentUserId,
    type: "created",
    content: null,
    ...extra,
  });

  if (task.archivedAt) {
    await publishArchiveChange(true, task, prepared.currentUserId);
  }
}

async function createTask(input: CreateTaskInput) {
  const prepared = await prepareTaskCreate(input);
  const createdTask = await db.transaction((tx) =>
    insertTaskInTransaction(tx, prepared),
  );

  await publishTaskCreated(createdTask, prepared);

  return {
    ...createdTask,
    assigneeIds: prepared.assigneeIds,
    assigneeName: prepared.assigneeName,
  };
}

export default createTask;
