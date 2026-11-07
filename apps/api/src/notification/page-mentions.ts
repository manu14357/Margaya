import { eq } from "drizzle-orm";
import db from "../database";
import { pageTable, userTable } from "../database/schema";
import { subscribeToEvent } from "../events";
import createNotification from "./controllers/create-notification";

// Page mention notifications (B5): every page content write, create and comment
// names the members mentioned now but not before (without the actor). Each one who
// is a workspace member and can see the page (public, or their own) gets a
// page_mention notification; createNotification enforces that through the
// page branch of the notification resource access rule.

type MentionEvent = {
  pageId?: string;
  userId?: string | null;
  newlyMentionedUserIds?: string[];
};

async function notifyMentions({
  pageId,
  userId,
  newlyMentionedUserIds,
}: MentionEvent) {
  const recipients = [...new Set(newlyMentionedUserIds ?? [])].filter(
    (id) => id && id !== userId,
  );
  if (!pageId || recipients.length === 0) return;

  const [page] = await db
    .select({
      title: pageTable.title,
      projectId: pageTable.projectId,
      workspaceId: pageTable.workspaceId,
    })
    .from(pageTable)
    .where(eq(pageTable.id, pageId))
    .limit(1);
  if (!page) return;

  const [actor] = userId
    ? await db
        .select({ name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, userId))
        .limit(1)
    : [];
  const mentionerName = actor?.name ?? "Someone";
  const pageTitle = page.title || "Untitled";

  for (const recipient of recipients) {
    await createNotification({
      userId: recipient,
      type: "page_mention",
      resourceType: "page",
      resourceId: pageId,
      actorId: userId ?? null,
      eventData: {
        pageTitle,
        mentionerName,
        projectId: page.projectId,
        workspaceId: page.workspaceId,
      },
    });
  }
}

for (const eventName of [
  "page.created",
  "page.content_updated",
  "page.comment_created",
  "page.comment_updated",
]) {
  subscribeToEvent<MentionEvent>(eventName, notifyMentions);
}
