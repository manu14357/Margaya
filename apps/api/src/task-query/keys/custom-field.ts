import { inArray, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { customFieldValueTable, taskTable } from "../../database/schema";
import type { SetFilterKey } from "./registry";

const VALUE_ALIAS = "custom_field_value_filter";
const fieldValue = alias(customFieldValueTable, VALUE_ALIAS);

function valueExists(fieldId: string, condition: SQL): SQL {
  return sql`exists (
    select 1 from ${customFieldValueTable} as ${sql.identifier(VALUE_ALIAS)}
    where ${fieldValue.taskId} = ${taskTable.id}
      and ${fieldValue.fieldId} = ${fieldId}
      and (${condition})
  )`;
}

/** The task's stored value of a field, with "" read as no value; never rows. */
export function customFieldValueSql(fieldId: string): SQL<string | null> {
  return sql<string | null>`(
    select nullif(${fieldValue.value}, '')
    from ${customFieldValueTable} as ${sql.identifier(VALUE_ALIAS)}
    where ${fieldValue.taskId} = ${taskTable.id}
      and ${fieldValue.fieldId} = ${fieldId}
  )`;
}

// Values compare exactly as stored; no row, null and "" all count as no value
// (the board's rule).
export const customFieldKey: SetFilterKey = {
  key: "customField",
  kind: "set",
  needsFieldId: true,
  matchAny: (values, _context, condition) =>
    valueExists(
      condition.fieldId ?? "",
      inArray(fieldValue.value, [...values]),
    ),
  isEmpty: (_context, condition) =>
    sql`not ${valueExists(
      condition.fieldId ?? "",
      sql`${fieldValue.value} is not null and ${fieldValue.value} <> ''`,
    )}`,
};
