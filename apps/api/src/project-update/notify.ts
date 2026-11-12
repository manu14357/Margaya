import { and, eq, ne } from "drizzle-orm";
import db from "../database";
import {
  projectTable,
  projectUpdateCommentTable,
  projectUpdateTable,
  userTable,
} from "../database/schema";
import { subscribeToEvent } from "../events";
import createNotification from "../notification/controllers/create-notification";
import { usersWhoCanSeeProject } from "../project/visibility";
import { followerIds } from "./controllers/social";

// Who hears about project updates. A new update notifies the project's
// followers (subscribed people plus the lead); a comment notifies the
// update's author and earlier commenters. Only people who can still see the
// project are told, and createNotification checks that again.

export const PROJECT_UPDATE_POSTED = "project_update_posted";
export const PROJECT_UPDATE_COMMENT = "project_update_comment";
export const PROJECT_UPDATE_REMINDER = "project_update_reminder";

const SUMMARY_PREVIEW_CHARS = 200;

async function loadUpdate(updateId: string) {
  const [row] = await db
    .select({
      id: projectUpdateTable.id,
      projectId: projectUpdateTable.projectId,
      workspaceId: projectUpdateTable.workspaceId,
      authorId: projectUpdateTable.authorId,
      health: projectUpdateTable.health,
      summary: projectUpdateTable.summary,
      projectName: projectTable.name,
    })
    .from(projectUpdateTable)
    .innerJoin(projectTable, eq(projectTable.id, projectUpdateTable.projectId))
    .where(eq(projectUpdateTable.id, updateId))
    .limit(1);
  return row ?? null;
}

async function nameOf(userId: string | null | undefined) {
  if (!userId) return null;
  const [row] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.name ?? null;
}

async function visibleTo(projectId: string, userIds: readonly string[]) {
  const allowed = await usersWhoCanSeeProject(projectId, userIds);
  return userIds.filter((id) => allowed.has(id));
}

subscribeToEvent<{ updateId?: string; userId?: string | null }>(
  "project_update.created",
  async ({ updateId, userId }) => {
    const update = updateId ? await loadUpdate(updateId) : null;
    if (!update) return;
    const recipients = await visibleTo(
      update.projectId,
      (await followerIds(update.projectId)).filter((id) => id !== userId),
    );
    if (recipients.length === 0) return;
    const authorName = await nameOf(userId);
    const preview = update.summary.slice(0, SUMMARY_PREVIEW_CHARS);
    for (const recipient of recipients) {
      await createNotification({
        userId: recipient,
        type: PROJECT_UPDATE_POSTED,
        resourceType: "project",
        resourceId: update.projectId,
        actorId: userId ?? null,
        title: `${authorName ?? "Someone"} posted an update on ${update.projectName}`,
        content: preview,
        eventData: {
          updateId: update.id,
          projectId: update.projectId,
          workspaceId: update.workspaceId,
          projectName: update.projectName,
          health: update.health,
          authorName,
          summaryPreview: preview,
        },
      });
    }
  },
);

subscribeToEvent<{
  updateId?: string;
  commentId?: string;
  userId?: string | null;
  commentPreview?: string;
}>(
  "project_update.comment_created",
  async ({ updateId, commentId, userId, commentPreview }) => {
    const update = updateId ? await loadUpdate(updateId) : null;
    if (!update) return;
    const earlier = await db
      .selectDistinct({ userId: projectUpdateCommentTable.userId })
      .from(projectUpdateCommentTable)
      .where(
        and(
          eq(projectUpdateCommentTable.updateId, update.id),
          userId ? ne(projectUpdateCommentTable.userId, userId) : undefined,
        ),
      );
    const candidates = new Set(
      earlier
        .map((row) => row.userId)
        .filter((id): id is string => Boolean(id)),
    );
    if (update.authorId) candidates.add(update.authorId);
    if (userId) candidates.delete(userId);
    const recipients = await visibleTo(update.projectId, [...candidates]);
    if (recipients.length === 0) return;
    const commenterName = await nameOf(userId);
    for (const recipient of recipients) {
      await createNotification({
        userId: recipient,
        type: PROJECT_UPDATE_COMMENT,
        resourceType: "project",
        resourceId: update.projectId,
        actorId: userId ?? null,
        title: `${commenterName ?? "Someone"} commented on an update of ${update.projectName}`,
        content: commentPreview ?? null,
        eventData: {
          updateId: update.id,
          commentId,
          projectId: update.projectId,
          workspaceId: update.workspaceId,
          projectName: update.projectName,
          commenterName,
          commentPreview: commentPreview ?? null,
        },
      });
    }
  },
);

/** The weekly nudge to a project lead (reminder.ts). */
export async function notifyLeadToPostUpdate(input: {
  leadUserId: string;
  projectId: string;
  workspaceId: string;
  projectName: string;
}) {
  const [allowed] = await visibleTo(input.projectId, [input.leadUserId]);
  if (!allowed) return null;
  return createNotification({
    userId: input.leadUserId,
    type: PROJECT_UPDATE_REMINDER,
    resourceType: "project",
    resourceId: input.projectId,
    title: `Time to post an update on ${input.projectName}`,
    content: "Share how the project is going with a short status update.",
    eventData: {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      projectName: input.projectName,
    },
  });
}
