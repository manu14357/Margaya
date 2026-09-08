import { and, eq, isNull, not, sql } from "drizzle-orm";
import db from "../database";
import {
  projectTable,
  taskMentionTable,
  taskTable,
  workspaceUserTable,
} from "../database/schema";
import { notifyTaskEvent } from "../notification/recipients";
import { subscribeUsers } from "../subscription/service";
import { parseMentionIds } from "../utils/parse-mentions";
import { plainTextPreview } from "../utils/plain-text-preview";
import { newlyMentionedIds } from "./diff";

// Keeps the mention index in step with one source (a task description or
// one comment) and, in interactive mode, subscribes and notifies the
// members this write newly mentions (B10 §3.4). Imports and integrations
// use `indexOnly`.

export type MentionSyncInput = {
  taskId: string;
  /** Null for the task description, otherwise the comment's id. */
  commentId: string | null;
  previous: string | null | undefined;
  next: string | null | undefined;
  actorId: string | null | undefined;
  mode: "interactive" | "indexOnly";
};

/** The mentioned ids that are current members of the task's workspace. */
async function memberIdsOf(
  taskId: string,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .selectDistinct({ userId: workspaceUserTable.userId })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .innerJoin(
      workspaceUserTable,
      eq(workspaceUserTable.workspaceId, projectTable.workspaceId),
    )
    .where(
      and(
        eq(taskTable.id, taskId),
        sql`${workspaceUserTable.userId} = any(${sql.param([...ids])}::text[])`,
      ),
    );
  return rows.map((row) => row.userId);
}

/** Replaces the index rows of one source with `memberIds`. */
async function replaceIndexRows(
  taskId: string,
  commentId: string | null,
  memberIds: readonly string[],
): Promise<void> {
  const source =
    commentId === null
      ? and(
          eq(taskMentionTable.taskId, taskId),
          isNull(taskMentionTable.commentId),
        )
      : eq(taskMentionTable.commentId, commentId);
  await db.transaction(async (tx) => {
    await tx
      .delete(taskMentionTable)
      .where(
        and(
          source,
          memberIds.length > 0
            ? not(
                sql`${taskMentionTable.userId} = any(${sql.param([...memberIds])}::text[])`,
              )
            : undefined,
        ),
      );
    if (memberIds.length > 0) {
      await tx
        .insert(taskMentionTable)
        .values(memberIds.map((userId) => ({ taskId, userId, commentId })))
        .onConflictDoNothing();
    }
  });
}

/**
 * Syncs the index and returns the members this write newly mentioned (in
 * interactive mode; always empty for `indexOnly`). Self-mentions are
 * indexed but never notify or subscribe.
 */
export async function syncMentions(input: MentionSyncInput): Promise<string[]> {
  const memberIds = await memberIdsOf(
    input.taskId,
    parseMentionIds(input.next),
  );
  await replaceIndexRows(input.taskId, input.commentId, memberIds);
  if (input.mode !== "interactive") return [];

  const members = new Set(memberIds);
  const newlyMentioned = newlyMentionedIds(
    input.previous,
    input.next,
    input.actorId,
  ).filter((id) => members.has(id));
  if (newlyMentioned.length === 0) return [];

  await subscribeUsers(input.taskId, newlyMentioned, "mention");
  await notifyTaskEvent({
    taskId: input.taskId,
    kind: "mention",
    actorId: input.actorId ?? null,
    mentionedIds: newlyMentioned,
    eventData:
      input.commentId === null
        ? { source: "description" }
        : {
            source: "comment",
            commentId: input.commentId,
            commentPreview: plainTextPreview(input.next),
          },
  });
  return newlyMentioned;
}
