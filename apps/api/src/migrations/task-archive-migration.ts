import { sql } from "drizzle-orm";
import db from "../database";
import {
  activityTable,
  columnTable,
  taskTable,
  userTable,
} from "../database/schema";

// D7: archiving moved from `status = 'archived'` to `task.archived_at`,
// orthogonal to the column. Legacy rows still carry the virtual status; this
// boot step gives them back a real column. Run it after the column
// migration. Each step is one UPDATE whose WHERE matches only rows that still
// need it, so a clean database writes nothing and every boot is safe. Raw
// SQL keeps `task.updated_at` untouched: a repair is not an edit.

/**
 * Converts legacy archived rows. The restore status is, in order: the
 * `oldStatus` of the task's latest status change to archived when that is
 * `planned` or a current non-triage column; else the first completed column;
 * else the entry column (first not started, then first open); else
 * `planned`. `archived_at` keeps an earlier value or takes `updated_at`; a
 * task restored into a completed column without a completion time takes the
 * archive time.
 */
async function convertLegacyArchivedTasks(): Promise<number> {
  const result = await db.execute(sql`
    WITH legacy AS (
      SELECT t.id, t.project_id, (
        SELECT a.event_data ->> 'oldStatus'
        FROM ${activityTable} AS a
        WHERE a.task_id = t.id
          AND a.type = 'status_changed'
          AND a.event_data ->> 'newStatus' = 'archived'
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 1
      ) AS history_status
      FROM ${taskTable} AS t
      WHERE t.status = 'archived'
    ),
    restored AS (
      SELECT l.id, COALESCE(
        CASE WHEN l.history_status = 'planned' THEN 'planned' END,
        (SELECT c.slug FROM ${columnTable} AS c
          WHERE c.project_id = l.project_id
            AND c.slug = l.history_status
            AND c.status_group <> 'triage'
          LIMIT 1),
        (SELECT c.slug FROM ${columnTable} AS c
          WHERE c.project_id = l.project_id AND c.status_group = 'completed'
          ORDER BY c.position, c.id LIMIT 1),
        (SELECT c.slug FROM ${columnTable} AS c
          WHERE c.project_id = l.project_id AND c.status_group = 'unstarted'
          ORDER BY c.position, c.id LIMIT 1),
        (SELECT c.slug FROM ${columnTable} AS c
          WHERE c.project_id = l.project_id
            AND c.status_group IN ('backlog', 'unstarted', 'started')
          ORDER BY c.position, c.id LIMIT 1),
        'planned'
      ) AS status
      FROM legacy AS l
    )
    UPDATE ${taskTable} AS t SET
      status = r.status,
      column_id = (
        SELECT c.id FROM ${columnTable} AS c
        WHERE c.project_id = t.project_id AND c.slug = r.status
        ORDER BY c.position, c.id LIMIT 1
      ),
      archived_at = COALESCE(t.archived_at, t.updated_at),
      completed_at = CASE
        WHEN t.completed_at IS NULL AND EXISTS (
          SELECT 1 FROM ${columnTable} AS c
          WHERE c.project_id = t.project_id
            AND c.slug = r.status
            AND c.status_group = 'completed'
        ) THEN COALESCE(t.archived_at, t.updated_at)
        ELSE t.completed_at
      END
    FROM restored AS r
    WHERE t.id = r.id AND t.status = 'archived'
  `);
  return result.rowCount ?? 0;
}

/**
 * D13: `task.created_by` from the task's earliest creation activity
 * ("created", or "create" for imports) when that user still exists. Tasks
 * made by integrations have no such row and stay null.
 */
async function backfillCreatedBy(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE ${taskTable} AS t SET created_by = first.user_id
    FROM (
      SELECT pending.id AS task_id, (
        SELECT a.user_id FROM ${activityTable} AS a
        WHERE a.task_id = pending.id AND a.type IN ('created', 'create')
        ORDER BY a.created_at ASC, a.id ASC
        LIMIT 1
      ) AS user_id
      FROM ${taskTable} AS pending
      WHERE pending.created_by IS NULL
    ) AS first
    WHERE t.id = first.task_id
      AND t.created_by IS NULL
      AND first.user_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM ${userTable} AS u WHERE u.id = first.user_id)
  `);
  return result.rowCount ?? 0;
}

export async function migrateTaskArchive() {
  const archived = await convertLegacyArchivedTasks();
  const createdBy = await backfillCreatedBy();
  if (archived > 0 || createdBy > 0) {
    console.log(
      `Task archive migration: converted ${archived} archived tasks, backfilled ${createdBy} creators`,
    );
  }
  return { archived, createdBy };
}
