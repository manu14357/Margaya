import { subscribeToEvent } from "../events";
import { enqueueTrigger } from "./engine";

// Trigger events, read from the internal events the existing controllers
// publish after their commit. Each subscriber only queues; the engine runs
// on a later tick, outside the publisher.

type Base = { taskId?: string | null; projectId?: string | null };

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function ids(data: Base): { taskId: string; projectId: string } | null {
  const taskId = str(data.taskId);
  const projectId = str(data.projectId);
  return taskId && projectId ? { taskId, projectId } : null;
}

subscribeToEvent<Base & { source?: string }>("task.created", async (data) => {
  const at = ids(data);
  if (at) {
    enqueueTrigger({
      ...at,
      type: "task_created",
      fromIntake: data.source === "intake",
    });
  }
});

subscribeToEvent<Base & { oldStatus?: string | null; newStatus?: string }>(
  "task.status_changed",
  async (data) => {
    const at = ids(data);
    const to = str(data.newStatus);
    if (!at || !to || data.oldStatus === to) return;
    enqueueTrigger({
      ...at,
      type: "status_changed",
      from: str(data.oldStatus),
      to,
    });
  },
);

subscribeToEvent<Base & { newAssigneeId?: string }>(
  "task.assignee_changed",
  async (data) => {
    const at = ids(data);
    const userId = str(data.newAssigneeId);
    if (at && userId) enqueueTrigger({ ...at, type: "assignee_added", userId });
  },
);

subscribeToEvent<Base & { oldAssigneeId?: string }>(
  "task.unassigned",
  async (data) => {
    const at = ids(data);
    const userId = str(data.oldAssigneeId);
    if (at && userId) {
      enqueueTrigger({ ...at, type: "assignee_removed", userId });
    }
  },
);

for (const [eventName, type] of [
  ["task.label_assigned", "label_added"],
  ["task.label_created", "label_added"],
  ["task.label_unassigned", "label_removed"],
] as const) {
  subscribeToEvent<Base & { label?: { name?: unknown } }>(
    eventName,
    async (data) => {
      const at = ids(data);
      const label = str(data.label?.name);
      if (at && label) enqueueTrigger({ ...at, type, label });
    },
  );
}

subscribeToEvent<Base & { oldPriority?: string; newPriority?: string }>(
  "task.priority_changed",
  async (data) => {
    const at = ids(data);
    const to = str(data.newPriority);
    if (!at || !to || data.oldPriority === to) return;
    enqueueTrigger({ ...at, type: "priority_changed", to });
  },
);

subscribeToEvent<Base & { newDueDate?: unknown }>(
  "task.due_date_changed",
  async (data) => {
    const at = ids(data);
    if (at && data.newDueDate) enqueueTrigger({ ...at, type: "due_date_set" });
  },
);

subscribeToEvent<Base>("comment.created", async (data) => {
  const at = ids(data);
  if (at) enqueueTrigger({ ...at, type: "comment_added" });
});

subscribeToEvent<Base & { newCycleId?: string | null }>(
  "task.cycle_changed",
  async (data) => {
    const at = ids(data);
    const cycleId = str(data.newCycleId);
    if (at && cycleId)
      enqueueTrigger({ ...at, type: "moved_to_cycle", cycleId });
  },
);

subscribeToEvent<{
  projectId?: string;
  moduleId?: string;
  added?: unknown;
}>("module.tasks_changed", async (data) => {
  const projectId = str(data.projectId);
  const moduleId = str(data.moduleId);
  if (!projectId || !moduleId || !Array.isArray(data.added)) return;
  for (const taskId of data.added) {
    if (typeof taskId === "string" && taskId) {
      enqueueTrigger({ projectId, taskId, type: "moved_to_module", moduleId });
    }
  }
});
