import { and, asc, eq, inArray, ne } from "drizzle-orm";
import {
  customFieldDefinitionTable,
  customFieldValueTable,
  labelTable,
} from "../database/schema";
import type { Transaction } from "../estimate/write";

function fieldKey(field: { name: string; type: string }) {
  return `${field.type}:${field.name.trim().toLowerCase()}`;
}

function acceptsValue(
  field: { type: string; options: unknown },
  value: string | null,
) {
  if (field.type !== "dropdown" || !value) return true;
  return !Array.isArray(field.options) || field.options.includes(value);
}

/**
 * Custom fields belong to one project. A moved task's value follows to the
 * destination's field of the same name and type when that field accepts it;
 * every other value is removed, since it could no longer be shown or edited.
 */
export async function carryCustomFieldValues(
  tx: Transaction,
  taskIds: string[],
  destinationProjectId: string,
) {
  const values = await tx
    .select({
      id: customFieldValueTable.id,
      taskId: customFieldValueTable.taskId,
      fieldId: customFieldValueTable.fieldId,
      value: customFieldValueTable.value,
      name: customFieldDefinitionTable.name,
      type: customFieldDefinitionTable.type,
      projectId: customFieldDefinitionTable.projectId,
    })
    .from(customFieldValueTable)
    .innerJoin(
      customFieldDefinitionTable,
      eq(customFieldValueTable.fieldId, customFieldDefinitionTable.id),
    )
    .where(inArray(customFieldValueTable.taskId, taskIds));

  const stale = values.filter((row) => row.projectId !== destinationProjectId);
  if (stale.length === 0) return;

  const fields = await tx
    .select({
      id: customFieldDefinitionTable.id,
      name: customFieldDefinitionTable.name,
      type: customFieldDefinitionTable.type,
      options: customFieldDefinitionTable.options,
    })
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.projectId, destinationProjectId))
    .orderBy(asc(customFieldDefinitionTable.position));

  // One value per task and field: a value already there is never overwritten.
  const filled = new Set(
    values
      .filter((row) => row.projectId === destinationProjectId)
      .map((row) => `${row.taskId}:${row.fieldId}`),
  );

  const removed: string[] = [];
  for (const row of stale) {
    const target = fields.find(
      (field) =>
        fieldKey(field) === fieldKey(row) && acceptsValue(field, row.value),
    );
    const slot = target && `${row.taskId}:${target.id}`;
    if (!target || !slot || filled.has(slot)) {
      removed.push(row.id);
      continue;
    }
    filled.add(slot);
    await tx
      .update(customFieldValueTable)
      .set({ fieldId: target.id })
      .where(eq(customFieldValueTable.id, row.id));
  }

  if (removed.length > 0) {
    await tx
      .delete(customFieldValueTable)
      .where(inArray(customFieldValueTable.id, removed));
  }
}

/**
 * Labels are workspace-wide, so they stay on a moved task. Only a row stored
 * under another workspace (older releases allowed that) has no place in the
 * destination and is dropped; rows without a workspace are not touched.
 */
export function dropLabelsFromOtherWorkspaces(
  tx: Transaction,
  taskIds: string[],
  workspaceId: string,
) {
  return tx
    .delete(labelTable)
    .where(
      and(
        inArray(labelTable.taskId, taskIds),
        ne(labelTable.workspaceId, workspaceId),
      ),
    )
    .returning();
}
