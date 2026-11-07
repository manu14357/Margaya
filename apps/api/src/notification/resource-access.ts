import { and, eq, type SQLWrapper, sql } from "drizzle-orm";
import db from "../database";
import { userTable } from "../database/schema";
import { projectVisibleSql } from "../project/visibility";

// Membership, rather than public visibility or global admin privileges, defines
// who may be subscribed to private task activity. Use the same predicate when
// creating, reading and delivering notifications, including historical rows.
// Rows of a trashed task or page, or of a task or page in a trashed project, are
// hidden while it is in the trash (C7) and come back with a restore. Rows of a
// restricted project are hidden from people who may no longer see it.
export function notificationResourceAccess(
  userId: string,
  resourceId: string | null | SQLWrapper,
  resourceType: string | null | SQLWrapper,
) {
  return sql<boolean>`(
    (${resourceId}::text IS NULL AND ${resourceType}::text IS NULL)
    OR (${resourceType}::text = 'task' AND EXISTS (
      SELECT 1 FROM task AS notification_task
      JOIN project AS notification_project ON notification_project.id = notification_task.project_id
      JOIN workspace_member AS notification_member ON notification_member.workspace_id = notification_project.workspace_id
      WHERE notification_task.id = ${resourceId} AND notification_member.user_id = ${userId}
        AND notification_task.deleted_at IS NULL
        AND notification_project.deleted_at IS NULL
        AND ${projectVisibleSql(sql`notification_project.id`, userId)}
    ))
    OR (${resourceType}::text = 'workspace' AND EXISTS (
      SELECT 1 FROM workspace_member AS notification_member
      WHERE notification_member.workspace_id = ${resourceId} AND notification_member.user_id = ${userId}
    ))
    OR (${resourceType}::text = 'page' AND EXISTS (
      SELECT 1 FROM page AS notification_page
      JOIN workspace_member AS notification_member ON notification_member.workspace_id = notification_page.workspace_id
      WHERE notification_page.id = ${resourceId} AND notification_member.user_id = ${userId}
        AND (notification_page.access = 'public' OR notification_page.owner_id = ${userId})
        AND notification_page.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM project AS notification_page_project
          WHERE notification_page_project.id = notification_page.project_id
            AND notification_page_project.deleted_at IS NOT NULL
        )
        AND ${projectVisibleSql(sql`notification_page.project_id`, userId)}
    ))
  )`;
}

export async function canReceiveResourceNotification(
  userId: string,
  resourceId?: string | null,
  resourceType?: string | null,
) {
  const [user] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(
      and(
        eq(userTable.id, userId),
        notificationResourceAccess(
          userId,
          resourceId ?? null,
          resourceType ?? null,
        ),
      ),
    )
    .limit(1);
  return Boolean(user);
}
