import { and, eq, isNotNull, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  customFieldDefinitionTable,
  customFieldValueTable,
  intakeItemTable,
  projectTable,
  taskTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { claimTaskNumber } from "../task/controllers/claim-task-numbers";
import { nextTaskPosition } from "../task/controllers/next-task-position";
import { formatTaskKey } from "../task-activity/task-snapshot";
import { INTAKE_ITEM_CREATED, type IntakeItemCreatedEvent } from "./events";
import { type IntakeItemResponse, loadIntakeItem } from "./queries";
import type { IntakeSource } from "./status";
import { ensureTriageColumn } from "./triage-column";

export const PROJECT_ARCHIVED_MESSAGE = "This project is archived";

/**
 * Files a request: a task in the project's triage column plus its intake
 * row, in one transaction. Only required custom fields with a default get a
 * value; nothing is required (K15). Publishes intake.item_created and, on
 * purpose, not task.created: the task reaches the board only when accepted.
 * Used by the create route and, later, public-board intake.
 */
export async function submitIntakeItem({
  projectId,
  submittedBy,
  title,
  description,
  priority,
  source,
}: {
  projectId: string;
  submittedBy: string | null;
  title: string;
  description?: string;
  priority?: string;
  source: IntakeSource;
}): Promise<IntakeItemResponse> {
  const [project] = await db
    .select({
      id: projectTable.id,
      slug: projectTable.slug,
      workspaceId: projectTable.workspaceId,
      archivedAt: projectTable.archivedAt,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  // A trashed project reads as gone (C7).
  if (!project || project.deletedAt) {
    throw new HTTPException(404, { message: "Project not found" });
  }
  if (project.archivedAt) {
    throw new HTTPException(409, { message: PROJECT_ARCHIVED_MESSAGE });
  }

  const defaults = await db
    .select({
      fieldId: customFieldDefinitionTable.id,
      value: customFieldDefinitionTable.defaultValue,
    })
    .from(customFieldDefinitionTable)
    .where(
      and(
        eq(customFieldDefinitionTable.projectId, projectId),
        eq(customFieldDefinitionTable.required, true),
        isNotNull(customFieldDefinitionTable.defaultValue),
        ne(customFieldDefinitionTable.defaultValue, ""),
      ),
    );

  const { itemId, task } = await db.transaction(async (tx) => {
    const column = await ensureTriageColumn(tx, projectId);
    const number = await claimTaskNumber(projectId, tx);
    const position = await nextTaskPosition(
      tx,
      projectId,
      column.slug,
      column.id,
    );

    const [task] = await tx
      .insert(taskTable)
      .values({
        projectId,
        title,
        description: description ?? "",
        priority: priority ?? "no-priority",
        status: column.slug,
        columnId: column.id,
        number,
        position,
        completedAt: null,
        createdBy: submittedBy,
      })
      .returning({
        id: taskTable.id,
        number: taskTable.number,
        title: taskTable.title,
      });
    if (!task) throw new HTTPException(500, { message: "Failed to submit" });

    const values = defaults
      .map(({ fieldId, value }) => ({
        taskId: task.id,
        fieldId,
        value: value?.trim() ?? "",
      }))
      .filter((row) => row.value !== "");
    if (values.length > 0) {
      await tx.insert(customFieldValueTable).values(values);
    }

    const [item] = await tx
      .insert(intakeItemTable)
      .values({
        projectId,
        taskId: task.id,
        status: "pending",
        source,
        submittedBy,
      })
      .returning({ id: intakeItemTable.id });
    if (!item) throw new HTTPException(500, { message: "Failed to submit" });

    return { itemId: item.id, task };
  });

  const created: IntakeItemCreatedEvent = {
    intakeItemId: itemId,
    taskId: task.id,
    projectId,
    workspaceId: project.workspaceId,
    userId: submittedBy,
    title: task.title,
    taskKey: formatTaskKey(project.slug, task.number),
    source,
  };
  await publishEvent(INTAKE_ITEM_CREATED, created);

  const item = await loadIntakeItem(itemId);
  if (!item) throw new HTTPException(404, { message: "Request not found" });
  return item;
}
