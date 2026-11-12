import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { commentAiProvenance } from "../../ai/provenance";
import db from "../../database";
import {
  activityTable,
  projectTable,
  taskTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import { decodeCommentCursor, encodeCommentCursor } from "../cursor";

export const DEFAULT_COMMENT_PAGE_SIZE = 50;

const createdAtKey = sql<string>`to_char(${activityTable.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

type PageOptions = { limit?: number; cursor?: string };

async function selectComments(taskId: string, page?: PageOptions) {
  const after = page?.cursor ? decodeCommentCursor(page.cursor) : null;
  const query = db
    .select({
      id: activityTable.id,
      taskId: activityTable.taskId,
      userId: userTable.id,
      content: activityTable.content,
      createdAt: activityTable.createdAt,
      createdAtKey,
      updatedAt: activityTable.updatedAt,
      userName: userTable.name,
      userImage: userTable.image,
      visibility: activityTable.visibility,
      parentId: activityTable.parentId,
      isAnonymous: userTable.isAnonymous,
      memberId: workspaceUserTable.userId,
      aiProvenance: activityTable.aiProvenance,
      eventData: activityTable.eventData,
    })
    .from(activityTable)
    // A deleted author (person or agent) leaves user_id null: the comment
    // stays, without an author.
    .leftJoin(userTable, eq(activityTable.userId, userTable.id))
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    // B12: public board authors may be outside the workspace.
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, projectTable.workspaceId),
        eq(workspaceUserTable.userId, userTable.id),
      ),
    )
    .where(
      and(
        eq(activityTable.taskId, taskId),
        eq(activityTable.type, "comment"),
        isNotNull(activityTable.content),
        after
          ? sql`(${activityTable.createdAt}, ${activityTable.id}) > (${after.createdAt}::timestamp, ${after.id})`
          : undefined,
      ),
    )
    // The id breaks ties so a page boundary never skips or repeats a row.
    .orderBy(asc(activityTable.createdAt), asc(activityTable.id));

  return page
    ? query.limit((page.limit ?? DEFAULT_COMMENT_PAGE_SIZE) + 1)
    : query;
}

type CommentRow = Awaited<ReturnType<typeof selectComments>>[number];

function toComment(c: CommentRow) {
  return {
    id: c.id,
    taskId: c.taskId,
    userId: c.userId,
    content: c.content as string,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    visibility: c.visibility,
    parentId: c.parentId,
    aiProvenance: commentAiProvenance(c),
    user:
      c.userId === null
        ? null
        : {
            name: c.userName ?? "",
            image: c.userImage,
            isWorkspaceMember: Boolean(c.memberId),
            isGuest: Boolean(c.isAnonymous),
          },
  };
}

/** Every comment on a task, oldest first. */
async function getComments(taskId: string) {
  return (await selectComments(taskId)).map(toComment);
}

/**
 * One page of a task's comments, oldest first. A reply is always newer than
 * the comment it answers, so reading pages in order meets every thread's
 * top-level comment before its replies.
 */
export async function getCommentPage(
  taskId: string,
  { limit = DEFAULT_COMMENT_PAGE_SIZE, cursor }: PageOptions = {},
) {
  const rows = await selectComments(taskId, { limit, cursor });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toComment),
    nextCursor:
      rows.length > limit && last
        ? encodeCommentCursor({ createdAt: last.createdAtKey, id: last.id })
        : null,
  };
}

export default getComments;
