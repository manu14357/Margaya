import { and, eq } from "drizzle-orm";
import db from "../database";
import { recentVisitTable } from "../database/schema";
import { removeEntityReferences } from "../entity-reference/registry";
import { subscribeToEvent } from "../events";

// Recent visits follow task lifecycle events instead of being cleaned up in
// the task controllers. Listing also deletes unresolvable rows as a backstop.

// A trashed task's references are only hidden (the resolver skips trashed
// tasks), so a restore brings them back; a purge removes them.
subscribeToEvent<{ taskId?: string }>("task.purged", async ({ taskId }) => {
  if (taskId) await removeEntityReferences("task", [taskId]);
});

subscribeToEvent<{ taskId?: string; toProjectId?: string }>(
  "task.moved",
  async ({ taskId, toProjectId }) => {
    if (!taskId || !toProjectId) return;
    // Moves stay inside one workspace, so only the project changes.
    await db
      .update(recentVisitTable)
      .set({ projectId: toProjectId })
      .where(
        and(
          eq(recentVisitTable.entityType, "task"),
          eq(recentVisitTable.entityId, taskId),
        ),
      );
  },
);
