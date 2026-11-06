import { and, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import db from "../../database";
import {
  customFieldDefinitionTable,
  customFieldValueTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { liveTaskCondition } from "../../task/scope";
import { assertCustomFieldValue } from "./set-custom-field-value";

const CHUNK_SIZE = 500;

/** Sets (or, with "", clears) one field on many tasks of its project. */
async function bulkSetCustomFieldValue(
  fieldId: string,
  taskIds: string[],
  value: string,
) {
  const [field] = await db
    .select()
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.id, fieldId))
    .limit(1);

  if (!field) {
    throw new HTTPException(404, { message: "Custom field not found" });
  }

  const normalizedValue = value.trim();
  assertCustomFieldValue(field, normalizedValue);

  const tasks = await db
    .select({ id: taskTable.id, projectId: taskTable.projectId })
    .from(taskTable)
    .where(and(inArray(taskTable.id, taskIds), liveTaskCondition));

  if (tasks.length === 0) {
    throw new HTTPException(404, { message: "No tasks found" });
  }
  if (tasks.some((task) => task.projectId !== field.projectId)) {
    throw new HTTPException(400, {
      message: "Every task must be in the custom field's project",
    });
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < tasks.length; i += CHUNK_SIZE) {
      await tx
        .insert(customFieldValueTable)
        .values(
          tasks.slice(i, i + CHUNK_SIZE).map((task) => ({
            taskId: task.id,
            fieldId,
            value: normalizedValue,
          })),
        )
        .onConflictDoUpdate({
          target: [customFieldValueTable.taskId, customFieldValueTable.fieldId],
          set: { value: sql`excluded.value` },
        });
    }
  });

  await publishEvent("custom_field.values_changed", {
    fieldId,
    projectId: field.projectId,
  });

  return { updatedCount: tasks.length };
}

export default bulkSetCustomFieldValue;
