import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { assetTable, taskTable } from "../database/schema";
import { ATTACHMENT_SURFACE } from "./queries";

const COUNT_ALIAS = "task_attachment_count";
const counted = alias(assetTable, COUNT_ALIAS);

/**
 * The number of panel attachments of the outer, unaliased `task` row, for
 * display properties and ordering. Nested once so drizzle keeps the
 * correlation qualified even in a single-table select.
 */
export const taskAttachmentCountSql = sql<number>`${sql`(
  select count(*) from ${assetTable} as ${sql.identifier(COUNT_ALIAS)}
  where ${counted.taskId} = ${taskTable.id}
    and ${counted.surface} = ${ATTACHMENT_SURFACE}
)`}`.mapWith(Number);
