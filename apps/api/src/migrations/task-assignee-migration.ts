import { sql } from "drizzle-orm";
import db from "../database";
import { taskAssigneeTable, taskTable } from "../database/schema";
import { firstAssigneeOfTaskSql } from "../task/assignee-writes";

/**
 * Idempotent safety net run on every boot, after the Drizzle migrations:
 *
 * 1. Backfill: a task whose `assignee_id` mirror is set but that has no
 *    `task_assignee` rows gets that user as its only assignee. Only legacy
 *    data (or a missed write path) looks like this, and keeping the person
 *    assigned never loses data.
 * 2. Mirror repair: `assignee_id` becomes the first assignee, or null.
 *
 * Each step is one statement whose WHERE matches only inconsistent rows, so
 * a clean database writes nothing, and the unique index plus NOT EXISTS make
 * concurrent boots of several instances safe. Raw SQL keeps
 * `task.updated_at` untouched: a repair is not a user edit.
 */
export async function migrateTaskAssignees() {
  const backfilled = await db.execute(sql`
    INSERT INTO ${taskAssigneeTable} (id, task_id, user_id, position, created_at)
    SELECT gen_random_uuid()::text, t.id, t.assignee_id, 0, t.updated_at
    FROM ${taskTable} AS t
    WHERE t.assignee_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ${taskAssigneeTable} AS existing
        WHERE existing.task_id = t.id
      )
    ON CONFLICT DO NOTHING
  `);

  const repaired = await db.execute(sql`
    UPDATE ${taskTable} AS t
    SET assignee_id = ${firstAssigneeOfTaskSql}
    WHERE (
        t.assignee_id IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM ${taskAssigneeTable} AS present
          WHERE present.task_id = t.id
        )
      )
      AND t.assignee_id IS DISTINCT FROM ${firstAssigneeOfTaskSql}
  `);

  const backfilledCount = backfilled.rowCount ?? 0;
  const repairedCount = repaired.rowCount ?? 0;
  if (backfilledCount > 0 || repairedCount > 0) {
    console.log(
      `Task assignees: backfilled ${backfilledCount}, repaired ${repairedCount}`,
    );
  }
  return { backfilled: backfilledCount, repaired: repairedCount };
}
