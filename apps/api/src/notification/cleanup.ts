import { and, eq } from "drizzle-orm";
import db from "../database";
import { notificationTable } from "../database/schema";
import { publishEvent, subscribeToEvent } from "../events";

// Notifications have no foreign key to their task, so a deleted task's rows
// would linger invisibly behind the access predicate. Remove them once the
// task is gone for good (task.purged; a trashed task's rows are only hidden,
// so a restore brings them back) and tell each affected user's clients to
// refresh their counts.
subscribeToEvent<{ taskId?: string }>("task.purged", async ({ taskId }) => {
  if (!taskId) return;
  const removed = await db
    .delete(notificationTable)
    .where(
      and(
        eq(notificationTable.resourceType, "task"),
        eq(notificationTable.resourceId, taskId),
      ),
    )
    .returning({
      userId: notificationTable.userId,
      workspaceId: notificationTable.workspaceId,
    });

  const seen = new Set<string>();
  for (const { userId, workspaceId } of removed) {
    const key = `${userId}:${workspaceId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await publishEvent("notification.updated", { userId, workspaceId });
  }
});
