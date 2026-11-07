import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import db from "../database";
import { notificationTable, pageTable, userTable } from "../database/schema";
import { subscribeToEvent } from "../events";
import { pageWatcherIds } from "../page/watching";
import createNotification from "./controllers/create-notification";

// What a page's watchers hear: new comments, and content changes. Saves arrive
// every few seconds while people type, so a watcher gets one page_updated per
// page until they read it, and at most one an hour. createNotification checks
// that each watcher is a member who can still see the page.

const PAGE_UPDATE_WINDOW_MS = 60 * 60 * 1000;

async function loadPage(pageId: string) {
  const [page] = await db
    .select({
      id: pageTable.id,
      title: pageTable.title,
      ownerId: pageTable.ownerId,
      projectId: pageTable.projectId,
      workspaceId: pageTable.workspaceId,
    })
    .from(pageTable)
    .where(eq(pageTable.id, pageId))
    .limit(1);
  return page ?? null;
}

async function actorName(userId: string | null | undefined) {
  if (!userId) return "Someone";
  const [actor] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return actor?.name ?? "Someone";
}

subscribeToEvent<{
  pageId?: string;
  userId?: string | null;
  commentId?: string;
  commentPreview?: string;
  newlyMentionedUserIds?: string[];
}>(
  "page.comment_created",
  async ({
    pageId,
    userId,
    commentId,
    commentPreview,
    newlyMentionedUserIds,
  }) => {
    const page = pageId ? await loadPage(pageId) : null;
    if (!page) return;
    // A mention already notifies them (notification/page-mentions.ts).
    const skip = new Set([userId, ...(newlyMentionedUserIds ?? [])]);
    const recipients = (await pageWatcherIds(page)).filter(
      (id) => !skip.has(id),
    );
    if (recipients.length === 0) return;

    const commenterName = await actorName(userId);
    for (const recipient of recipients) {
      await createNotification({
        userId: recipient,
        type: "page_comment",
        resourceType: "page",
        resourceId: page.id,
        actorId: userId ?? null,
        eventData: {
          pageTitle: page.title || "Untitled",
          commenterName,
          commentId,
          commentPreview,
          projectId: page.projectId,
          workspaceId: page.workspaceId,
        },
      });
    }
  },
);

subscribeToEvent<{
  pageId?: string;
  userId?: string | null;
  contributorIds?: string[];
}>("page.content_updated", async ({ pageId, userId, contributorIds }) => {
  const page = pageId ? await loadPage(pageId) : null;
  if (!page) return;
  const skip = new Set([userId, ...(contributorIds ?? [])]);
  const watchers = (await pageWatcherIds(page)).filter((id) => !skip.has(id));
  if (watchers.length === 0) return;

  const pending = await db
    .select({ userId: notificationTable.userId })
    .from(notificationTable)
    .where(
      and(
        inArray(notificationTable.userId, watchers),
        eq(notificationTable.type, "page_updated"),
        eq(notificationTable.resourceType, "page"),
        eq(notificationTable.resourceId, page.id),
        or(
          sql`${notificationTable.isRead} is not true`,
          gt(
            notificationTable.createdAt,
            new Date(Date.now() - PAGE_UPDATE_WINDOW_MS),
          ),
        ),
      ),
    );
  const told = new Set(pending.map((row) => row.userId));
  const recipients = watchers.filter((id) => !told.has(id));
  if (recipients.length === 0) return;

  const editorName = await actorName(userId);
  for (const recipient of recipients) {
    await createNotification({
      userId: recipient,
      type: "page_updated",
      resourceType: "page",
      resourceId: page.id,
      actorId: userId ?? null,
      eventData: {
        pageTitle: page.title || "Untitled",
        editorName,
        projectId: page.projectId,
        workspaceId: page.workspaceId,
      },
    });
  }
});
