import { and, desc, eq } from "drizzle-orm";
import db from "../../database";
import { calendarFeedTable, projectTable } from "../../database/schema";
import { hiddenProjectIds } from "../../project/visibility";

/** The caller's feeds in one workspace, newest first. Never a token. */
export default async function listCalendarFeeds(
  userId: string,
  workspaceId: string,
) {
  const [rows, hidden] = await Promise.all([
    db
      .select({
        id: calendarFeedTable.id,
        kind: calendarFeedTable.kind,
        workspaceId: calendarFeedTable.workspaceId,
        projectId: calendarFeedTable.projectId,
        projectName: projectTable.name,
        projectDeletedAt: projectTable.deletedAt,
        name: calendarFeedTable.name,
        tokenStart: calendarFeedTable.tokenStart,
        createdAt: calendarFeedTable.createdAt,
        lastUsedAt: calendarFeedTable.lastUsedAt,
      })
      .from(calendarFeedTable)
      .leftJoin(projectTable, eq(projectTable.id, calendarFeedTable.projectId))
      .where(
        and(
          eq(calendarFeedTable.userId, userId),
          eq(calendarFeedTable.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(calendarFeedTable.createdAt), desc(calendarFeedTable.id)),
    hiddenProjectIds(userId, workspaceId),
  ]);
  const hiddenSet = new Set(hidden);
  // A feed of a project the owner can no longer see stays listed, so it can
  // be revoked, but without the project's name.
  return rows.map(({ projectDeletedAt, ...row }) => ({
    ...row,
    projectName:
      row.projectId && !projectDeletedAt && !hiddenSet.has(row.projectId)
        ? row.projectName
        : null,
  }));
}
