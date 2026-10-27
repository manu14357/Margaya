import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import bulkUpdateTasks from "../../apps/api/src/task/controllers/bulk-update-tasks";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const publish = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../apps/api/src/events", () => ({ publishEvent: publish }));

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
});

describe("bulk task event snapshots", () => {
  it("preserves each task's old status, title and assignee for reopening and notifications", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const tasks = await db
      .insert(schema.taskTable)
      .values([
        {
          projectId: project.id,
          title: "Completed",
          status: "done",
          userId: user.id,
          number: 1,
        },
        { projectId: project.id, title: "Queued", status: "to-do", number: 2 },
      ])
      .returning();
    await bulkUpdateTasks({
      taskIds: tasks.map((task) => task.id),
      operation: "updateStatus",
      value: "in-progress",
      userId: user.id,
    });
    for (const task of tasks) {
      expect(publish).toHaveBeenCalledWith(
        "task.status_changed",
        expect.objectContaining({
          taskId: task.id,
          projectId: project.id,
          oldStatus: task.status,
          newStatus: "in-progress",
          title: task.title,
          assigneeId: task.userId,
        }),
      );
    }
    expect(await db.query.taskTable.findMany()).toEqual(
      expect.arrayContaining(
        tasks.map((task) =>
          expect.objectContaining({ id: task.id, status: "in-progress" }),
        ),
      ),
    );
  });

  it("preserves differing old priorities and titles in a single bulk operation", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const tasks = await db
      .insert(schema.taskTable)
      .values([
        { projectId: project.id, title: "Low", priority: "low", number: 1 },
        { projectId: project.id, title: "High", priority: "high", number: 2 },
      ])
      .returning();
    await bulkUpdateTasks({
      taskIds: tasks.map((task) => task.id),
      operation: "updatePriority",
      value: "medium",
      userId: user.id,
    });
    for (const task of tasks) {
      expect(publish).toHaveBeenCalledWith(
        "task.priority_changed",
        expect.objectContaining({
          taskId: task.id,
          oldPriority: task.priority,
          newPriority: "medium",
          title: task.title,
        }),
      );
    }
  });

  it("sets and clears start dates with one event per task", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const earlier = new Date("2026-03-01T00:00:00.000Z");
    const tasks = await db
      .insert(schema.taskTable)
      .values([
        {
          projectId: project.id,
          title: "Dated",
          startDate: earlier,
          number: 1,
        },
        { projectId: project.id, title: "Undated", number: 2 },
      ])
      .returning();
    const start = new Date("2026-04-01T00:00:00.000Z");

    const result = await bulkUpdateTasks({
      taskIds: tasks.map((task) => task.id),
      operation: "updateStartDate",
      value: start.toISOString(),
      userId: user.id,
    });
    expect(result.updatedCount).toBe(2);
    for (const task of tasks) {
      expect(publish).toHaveBeenCalledWith(
        "task.start_date_changed",
        expect.objectContaining({
          taskId: task.id,
          projectId: project.id,
          oldStartDate: task.startDate,
          newStartDate: start,
          title: task.title,
        }),
      );
    }
    const stored = await db.query.taskTable.findMany();
    expect(stored.map((task) => task.startDate?.toISOString())).toEqual([
      start.toISOString(),
      start.toISOString(),
    ]);

    await bulkUpdateTasks({
      taskIds: tasks.map((task) => task.id),
      operation: "updateStartDate",
      value: null,
      userId: user.id,
    });
    const cleared = await db.query.taskTable.findMany();
    expect(cleared.every((task) => task.startDate === null)).toBe(true);
  });

  it("refuses a start date after a selected task's due date and changes nothing", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const tasks = await db
      .insert(schema.taskTable)
      .values([
        {
          projectId: project.id,
          title: "Due soon",
          dueDate: new Date("2026-03-01T00:00:00.000Z"),
          number: 1,
        },
        { projectId: project.id, title: "Open", number: 2 },
      ])
      .returning();

    await expect(
      bulkUpdateTasks({
        taskIds: tasks.map((task) => task.id),
        operation: "updateStartDate",
        value: "2026-04-01T00:00:00.000Z",
        userId: user.id,
      }),
    ).rejects.toMatchObject({ status: 400 });
    const stored = await db.query.taskTable.findMany();
    expect(stored.every((task) => task.startDate === null)).toBe(true);
    expect(publish).not.toHaveBeenCalled();
  });
});
