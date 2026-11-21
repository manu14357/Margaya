import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  task: null as Record<string, unknown> | null,
  column: null as Record<string, unknown> | null,
  update: vi.fn(),
  remove: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("../../../apps/api/src/database", () => {
  const returning = async () => [{ ...m.task, updated: true }];
  return {
    default: {
      query: {
        taskTable: { findFirst: async () => m.task },
        columnTable: { findFirst: async () => m.column },
      },
      update: (...args: unknown[]) => {
        m.update(...args);
        return { set: () => ({ where: () => ({ returning }) }) };
      },
      delete: (...args: unknown[]) => {
        m.remove(...args);
        return { where: async () => undefined };
      },
    },
  };
});
vi.mock("../../../apps/api/src/events", () => ({ publishEvent: m.publish }));
vi.mock("../../../apps/api/src/task/assignees", () => ({
  withAssigneeIds: async (task: unknown) => task,
}));
vi.mock("../../../apps/api/src/intake/guards", () => ({
  assertTasksNotInTriage: async () => undefined,
}));
vi.mock("../../../apps/api/src/task/validate-task-fields", () => ({
  assertValidTaskStatus: async () => undefined,
}));

const { default: updateTaskPriority } = await import(
  "../../../apps/api/src/task/controllers/update-task-priority"
);
const { default: updateTaskDueDate } = await import(
  "../../../apps/api/src/task/controllers/update-task-due-date"
);
const { default: updateTaskStatus } = await import(
  "../../../apps/api/src/task/controllers/update-task-status"
);

const due = new Date("2026-12-01T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  m.task = {
    id: "t1",
    projectId: "p1",
    title: "Task",
    priority: "no-priority",
    status: "to-do",
    columnId: "c1",
    archivedAt: null,
    dueDate: due,
    userId: null,
  };
  m.column = { id: "c1", slug: "to-do" };
});

describe("same-value task field updates", () => {
  it("setting the current priority writes and records nothing", async () => {
    await updateTaskPriority({
      id: "t1",
      priority: "no-priority",
      currentUserId: "u1",
    });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("a new priority still records the change", async () => {
    await updateTaskPriority({
      id: "t1",
      priority: "high",
      currentUserId: "u1",
    });
    expect(m.publish).toHaveBeenCalledWith(
      "task.priority_changed",
      expect.objectContaining({
        oldPriority: "no-priority",
        newPriority: "high",
      }),
    );
  });

  it("setting the current due date keeps reminders and records nothing", async () => {
    await updateTaskDueDate({
      id: "t1",
      dueDate: new Date(due.getTime()),
      currentUserId: "u1",
    });
    expect(m.remove).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("clearing an empty due date records nothing", async () => {
    m.task = { ...m.task, dueDate: null };
    await updateTaskDueDate({ id: "t1", dueDate: null, currentUserId: "u1" });
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("setting the current status records nothing", async () => {
    await updateTaskStatus({ id: "t1", status: "to-do", currentUserId: "u1" });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("a different status still records the change", async () => {
    m.column = { id: "c2", slug: "done" };
    await updateTaskStatus({ id: "t1", status: "done", currentUserId: "u1" });
    expect(m.publish).toHaveBeenCalledWith(
      "task.status_changed",
      expect.objectContaining({ oldStatus: "to-do", newStatus: "done" }),
    );
  });
});
