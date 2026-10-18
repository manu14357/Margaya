import { sql } from "drizzle-orm";
import { taskRecurrenceTable, taskTable } from "../database/schema";

/**
 * True while the task holds a repeat rule (the series' current instance).
 * For list selects from the unaliased task table; one index probe per row.
 */
export const isRecurringSql = sql<boolean>`exists (
  select 1 from ${taskRecurrenceTable}
  where ${taskRecurrenceTable.taskId} = ${taskTable.id}
)`;
