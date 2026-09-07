import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { taskLinkTable, taskTable } from "../database/schema";

const COUNT_ALIAS = "task_link_count";
const counted = alias(taskLinkTable, COUNT_ALIAS);

/**
 * The number of user links of the outer, unaliased `task` row, for display
 * properties and ordering. Nested once so drizzle keeps the correlation
 * qualified even in a single-table select.
 */
export const taskLinkCountSql = sql<number>`${sql`(
  select count(*) from ${taskLinkTable} as ${sql.identifier(COUNT_ALIAS)}
  where ${counted.taskId} = ${taskTable.id}
)`}`.mapWith(Number);
