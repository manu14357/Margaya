import { subscribeToEvent } from "../events";
import createNotification from "./controllers/create-notification";
import { notifyTaskEvent } from "./recipients";

// Event-driven notifications. Every task path goes through notifyTaskEvent,
// which decides the audience (B10 §3.2, §3.3); subscribers never trust
// assignee fields in payloads.

/** ISO string of a date-like payload value, or null. */
function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string" && value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

subscribeToEvent<{
  taskId: string;
  currentUserId?: string;
}>("task.created", async (data) => {
  await notifyTaskEvent({
    taskId: data.taskId,
    kind: "created",
    actorId: data.currentUserId || null,
  });
});

subscribeToEvent<{
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string;
  ownerId?: string;
}>("workspace.created", async (data) => {
  if (data.ownerId) {
    await createNotification({
      userId: data.ownerId,
      type: "workspace_created",
      eventData: {
        workspaceName: data.workspaceName,
      },
      resourceId: data.workspaceId,
      resourceType: "workspace",
    });
  }
});

subscribeToEvent<{
  taskId: string;
  userId: string | null;
  oldStatus: string;
  newStatus: string;
}>("task.status_changed", async (data) => {
  // Integration-originated changes have no actor, so everyone hears.
  await notifyTaskEvent({
    taskId: data.taskId,
    kind: "statusChanged",
    actorId: data.userId || null,
    eventData: { oldStatus: data.oldStatus, newStatus: data.newStatus },
  });
});

subscribeToEvent<{
  taskId: string;
  userId: string;
  newAssigneeId: string;
}>("task.assignee_changed", async (data) => {
  // One event per added user; adding yourself notifies nobody.
  if (!data.newAssigneeId) return;
  await notifyTaskEvent({
    taskId: data.taskId,
    kind: "assigned",
    actorId: data.userId || null,
    directIds: [data.newAssigneeId],
  });
});

subscribeToEvent<{
  timeEntryId: string;
  taskId: string;
  userId: string;
}>("time-entry.created", async (data) => {
  await notifyTaskEvent({
    taskId: data.taskId,
    kind: "timeEntry",
    actorId: data.userId || null,
  });
});

subscribeToEvent<{
  taskId: string;
  userId?: string | null;
  oldPriority?: string | null;
  newPriority?: string | null;
}>("task.priority_changed", async (data) => {
  if ((data.oldPriority ?? null) === (data.newPriority ?? null)) return;
  await notifyTaskEvent({
    taskId: data.taskId,
    kind: "updated",
    actorId: data.userId || null,
    eventData: {
      field: "priority",
      oldValue: data.oldPriority ?? null,
      newValue: data.newPriority ?? null,
    },
  });
});

subscribeToEvent<{
  taskId: string;
  userId?: string | null;
  oldDueDate?: unknown;
  newDueDate?: unknown;
}>("task.due_date_changed", async (data) => {
  const oldValue = isoOrNull(data.oldDueDate);
  const newValue = isoOrNull(data.newDueDate);
  if (oldValue === newValue) return;
  await notifyTaskEvent({
    taskId: data.taskId,
    kind: "updated",
    actorId: data.userId || null,
    eventData: { field: "dueDate", oldValue, newValue },
  });
});

subscribeToEvent<{
  taskId: string;
  userId?: string | null;
  oldTitle?: string | null;
  newTitle?: string | null;
}>("task.title_changed", async (data) => {
  if ((data.oldTitle ?? null) === (data.newTitle ?? null)) return;
  await notifyTaskEvent({
    taskId: data.taskId,
    kind: "updated",
    actorId: data.userId || null,
    eventData: {
      field: "title",
      oldValue: data.oldTitle ?? null,
      newValue: data.newTitle ?? null,
    },
  });
});
