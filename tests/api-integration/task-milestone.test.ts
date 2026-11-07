import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPublishedEvents,
  json,
  publishedEvents,
  recordEvents,
  taskDetailScene,
} from "./helpers/task-detail";

recordEvents("task.updated");

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
});

async function stored(taskId: string) {
  const [row] = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  return row;
}

describe("task milestones", () => {
  it("a task starts as a regular one", async () => {
    const s = await taskDetailScene();
    const task = await s.createTask();
    expect((await stored(task.id))?.isMilestone).toBe(false);
  });

  it("marks and unmarks a task, keeping its dates and telling other clients", async () => {
    const s = await taskDetailScene();
    const startDate = new Date("2026-03-02T00:00:00.000Z");
    const dueDate = new Date("2026-03-09T00:00:00.000Z");
    const task = await s.createTask({ startDate, dueDate });
    const asMember = s.as(s.member);

    const marked = await asMember(
      `/task/milestone/${task.id}`,
      json("PUT", { isMilestone: true }),
    );
    expect(marked.status).toBe(200);
    expect(await marked.json()).toMatchObject({
      id: task.id,
      isMilestone: true,
    });

    const row = await stored(task.id);
    expect(row?.isMilestone).toBe(true);
    expect(row?.startDate).toEqual(startDate);
    expect(row?.dueDate).toEqual(dueDate);
    expect(publishedEvents("task.updated")).toHaveLength(1);

    // Asking for what is already there changes nothing.
    const again = await asMember(
      `/task/milestone/${task.id}`,
      json("PUT", { isMilestone: true }),
    );
    expect(again.status).toBe(200);
    expect(publishedEvents("task.updated")).toHaveLength(1);

    const unmarked = await asMember(
      `/task/milestone/${task.id}`,
      json("PUT", { isMilestone: false }),
    );
    expect(unmarked.status).toBe(200);
    expect((await stored(task.id))?.isMilestone).toBe(false);
    expect(publishedEvents("task.updated")).toHaveLength(2);
  });

  it("creates a milestone directly, and shows it on the board and the task", async () => {
    const s = await taskDetailScene();
    const asMember = s.as(s.member);
    const dueDate = "2026-03-09T00:00:00.000Z";
    const plain = await s.createTask();

    const created = await asMember(
      `/task/${s.project.id}`,
      json("POST", {
        title: "Beta ships",
        description: "",
        priority: "no-priority",
        status: "to-do",
        assigneeIds: [],
        startDate: dueDate,
        dueDate,
        isMilestone: true,
      }),
    );
    expect(created.status).toBe(200);
    const task = (await created.json()) as {
      id: string;
      isMilestone: boolean;
    };
    expect(task.isMilestone).toBe(true);

    const detail = await asMember(`/task/${task.id}`, { method: "GET" });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ isMilestone: true });

    const board = await asMember(`/task/tasks/${s.project.id}`, {
      method: "GET",
    });
    expect(board.status).toBe(200);
    const body = (await board.json()) as {
      data: {
        columns: { tasks: { id: string; isMilestone?: boolean }[] }[];
      };
    };
    const tasks = body.data.columns.flatMap((column) => column.tasks);
    expect(tasks.find((row) => row.id === task.id)?.isMilestone).toBe(true);
    expect(tasks.find((row) => row.id === plain.id)?.isMilestone).toBe(false);
  });

  it("a copy of a milestone is a milestone", async () => {
    const s = await taskDetailScene();
    const task = await s.createTask({ isMilestone: true });
    const copied = await s.as(s.member)(
      `/task-copy/${task.id}`,
      json("POST", {}),
    );
    expect(copied.status).toBe(200);
    const body = (await copied.json()) as { task: { id: string } };
    expect((await stored(body.task.id))?.isMilestone).toBe(true);
  });

  it("needs task:update, workspace access and a live task", async () => {
    const s = await taskDetailScene();
    const task = await s.createTask();
    const body = json("PUT", { isMilestone: true });

    const asViewer = await s.as(s.viewer)(`/task/milestone/${task.id}`, body);
    expect(asViewer.status).toBe(403);
    const asOutsider = await s.as(s.outsider)(
      `/task/milestone/${task.id}`,
      body,
    );
    expect(asOutsider.status).toBe(403);
    expect((await stored(task.id))?.isMilestone).toBe(false);

    const trashed = await s.createTask({ deletedAt: new Date() });
    const onTrashed = await s.as(s.member)(
      `/task/milestone/${trashed.id}`,
      body,
    );
    expect(onTrashed.status).toBe(404);
  });
});
