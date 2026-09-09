import { eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../../database";
import {
  notificationTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { formatTaskKey } from "../../task-activity/task-snapshot";
import {
  decodeInboxCursor,
  encodeInboxCursor,
  type InboxTab,
  type InboxType,
  type InboxView,
  inboxCondition,
  inboxOrderBy,
  inboxSortExpression,
  inboxSortKey,
  taskJoinCondition,
} from "../inbox";

const actorUser = alias(userTable, "inbox_actor");

export type InboxRequest = {
  userId: string;
  workspaceId: string;
  tab: InboxTab;
  view: InboxView;
  unread: boolean;
  types: InboxType[];
  limit: number;
  cursor?: string;
};

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** One keyset page of the caller's inbox in a workspace. */
async function getInbox(request: InboxRequest) {
  const now = new Date();
  const cursor = request.cursor
    ? decodeInboxCursor(request.cursor, request.view)
    : null;

  const rows = await db
    .select({
      notification: notificationTable,
      actorId: actorUser.id,
      actorName: actorUser.name,
      actorImage: actorUser.image,
      taskId: taskTable.id,
      taskNumber: taskTable.number,
      taskTitle: taskTable.title,
      projectId: projectTable.id,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      projectWorkspaceId: projectTable.workspaceId,
      sortAt: sql<Date>`${inboxSortExpression(request.view)}`.mapWith(
        notificationTable.createdAt,
      ),
      sortKey: inboxSortKey(request.view),
    })
    .from(notificationTable)
    .leftJoin(taskTable, taskJoinCondition)
    .leftJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(actorUser, eq(actorUser.id, notificationTable.actorId))
    .where(
      inboxCondition({
        userId: request.userId,
        workspaceId: request.workspaceId,
        view: request.view,
        tab: request.tab,
        unread: request.unread,
        types: request.types,
        now,
        cursor,
      }),
    )
    .orderBy(...inboxOrderBy(request.view))
    .limit(request.limit + 1);

  const page = rows.slice(0, request.limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > request.limit && last
      ? encodeInboxCursor({
          view: request.view,
          value: last.sortKey,
          id: last.notification.id,
        })
      : null;

  const items = page.map((row) => {
    const { notification } = row;
    const task =
      row.taskId && row.projectId && row.projectSlug && row.taskTitle !== null
        ? {
            id: row.taskId,
            key: formatTaskKey(row.projectSlug, row.taskNumber),
            title: row.taskTitle,
            projectId: row.projectId,
            projectName: row.projectName ?? "",
          }
        : null;
    const eventData = task
      ? {
          ...objectOf(notification.eventData),
          projectId: task.projectId,
          workspaceId: row.projectWorkspaceId,
        }
      : notification.eventData;
    return {
      ...notification,
      eventData,
      actor: row.actorId
        ? { id: row.actorId, name: row.actorName ?? "", image: row.actorImage }
        : null,
      task,
      sortAt: row.sortAt,
      isSnoozed: Boolean(
        notification.snoozedUntil &&
          notification.snoozedUntil.getTime() > now.getTime(),
      ),
    };
  });

  return { items, nextCursor };
}

export default getInbox;
