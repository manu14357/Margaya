import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import db from "../../database";
import {
  customFieldDefinitionTable,
  customFieldValueTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { validateCustomFieldValue } from "../../task/validate-task-fields";

type ValueField = {
  name: string;
  type: string;
  required: boolean;
  options: unknown;
};

/**
 * Throws a 400 unless `value` (already trimmed) fits the field. `stored` is the
 * task's current value: an option removed from the field can be kept, but not
 * newly set.
 */
export function assertCustomFieldValue(
  field: ValueField,
  value: string,
  stored?: string | null,
) {
  if (value.length === 0) {
    if (field.required) {
      throw new HTTPException(400, {
        message: "This custom field is required",
      });
    }
    return;
  }

  if (
    field.type === "dropdown" &&
    Array.isArray(field.options) &&
    !field.options.includes(value) &&
    value !== stored
  ) {
    throw new HTTPException(400, {
      message: "Invalid option for this custom field",
    });
  }

  if (field.type === "number" && Number.isNaN(Number(value))) {
    throw new HTTPException(400, {
      message: "Value must be a valid number",
    });
  }

  if (field.type === "boolean" && value !== "true" && value !== "false") {
    throw new HTTPException(400, {
      message: "Value must be true or false",
    });
  }

  if (field.type === "date") {
    const error = validateCustomFieldValue(value, "date", field.name);
    if (error) throw new HTTPException(400, { message: error });
  }
}

async function setCustomFieldValue(
  taskId: string,
  fieldId: string,
  value: string,
  userId?: string,
) {
  const [task] = await db
    .select({
      projectId: taskTable.projectId,
    })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);

  if (!task) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  const [field] = await db
    .select()
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.id, fieldId))
    .limit(1);

  if (!field || field.projectId !== task.projectId) {
    throw new HTTPException(404, {
      message: "Custom field not found",
    });
  }

  const normalizedValue = value.trim();

  // Only a value outside the options needs the stored one to be judged.
  const isOutsideOptions =
    field.type === "dropdown" &&
    Array.isArray(field.options) &&
    !field.options.includes(normalizedValue);
  const [stored] = isOutsideOptions
    ? await db
        .select({ value: customFieldValueTable.value })
        .from(customFieldValueTable)
        .where(
          and(
            eq(customFieldValueTable.taskId, taskId),
            eq(customFieldValueTable.fieldId, fieldId),
          ),
        )
        .limit(1)
    : [];

  assertCustomFieldValue(field, normalizedValue, stored?.value);

  const [result] = await db
    .insert(customFieldValueTable)
    .values({
      taskId,
      fieldId,
      value: normalizedValue,
    })
    .onConflictDoUpdate({
      target: [customFieldValueTable.taskId, customFieldValueTable.fieldId],
      set: {
        value: sql`excluded.value`,
      },
    })
    .returning();

  // Lists group and sort by these values, so other clients must refetch.
  await publishEvent("task.custom_field_changed", {
    taskId,
    fieldId,
    projectId: task.projectId,
    userId,
  });

  return result;
}

export default setCustomFieldValue;
