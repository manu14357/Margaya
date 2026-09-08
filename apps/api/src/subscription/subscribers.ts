import { eq } from "drizzle-orm";
import db from "../database";
import { taskTable } from "../database/schema";
import { subscribeToEvent } from "../events";
import { syncMentions } from "../mention/sync";
import { assigneesOfTask } from "../task/assignees";
import { subscribeUsers } from "./service";

// Auto-subscribe (B10 §3.5). Editing properties never subscribes the editor
// (K3); creating, being assigned, commenting and being mentioned do.
// Auto-subscribes publish nothing.

subscribeToEvent<{
  taskId: string;
  currentUserId?: string;
  type?: string;
  source?: string;
}>("task.created", async (data) => {
  // Interactive creates only: imports and integrations have another type
  // or no user, and an intake request's submitter subscribes on
  // intake.item_created instead.
  const interactive =
    data.type === "created" &&
    Boolean(data.currentUserId) &&
    data.source !== "intake";
  if (interactive) {
    await subscribeUsers(data.taskId, [data.currentUserId], "creator");
  }
  // Every origin: the current assignees, read fresh (payloads carry only
  // the first).
  await subscribeUsers(
    data.taskId,
    await assigneesOfTask(data.taskId),
    "assignee",
  );

  const [task] = await db
    .select({ description: taskTable.description })
    .from(taskTable)
    .where(eq(taskTable.id, data.taskId))
    .limit(1);
  if (!task?.description) return;
  await syncMentions({
    taskId: data.taskId,
    commentId: null,
    previous: null,
    next: task.description,
    actorId: data.currentUserId || null,
    mode: interactive ? "interactive" : "indexOnly",
  });
});

subscribeToEvent<{ taskId: string; newAssigneeId?: string }>(
  "task.assignee_changed",
  async (data) => {
    if (!data.newAssigneeId) return;
    await subscribeUsers(data.taskId, [data.newAssigneeId], "assignee");
  },
);

// Intake (B7): the submitter hears about comments while the request waits
// in triage.
subscribeToEvent<{ taskId?: string; userId?: string }>(
  "intake.item_created",
  async (data) => {
    if (!data.taskId || !data.userId) return;
    await subscribeUsers(data.taskId, [data.userId], "creator");
  },
);
