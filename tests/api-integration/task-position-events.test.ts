import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import updateTaskPosition from "../../apps/api/src/task/controllers/update-task-position";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const publish = vi.hoisted(() =>
  vi.fn(async (_name: string, _payload: unknown) => undefined),
);
vi.mock("../../apps/api/src/events", () => ({ publishEvent: publish }));

async function createTask() {
  const { user, workspace } = await createWorkspaceMember();
  const { project, columns } = await createProjectFixture({
    workspaceId: workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Stored title",
      status: "to-do",
      columnId: columns.todo.id,
      number: 1,
      position: 1,
    })
    .returning();
  if (!task) throw new Error("no task");
  return { task, user };
}

function eventNames() {
  return publish.mock.calls.map(([name]) => name);
}

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
});

describe("task position events", () => {
  it("a column change tells other clients and the activity feed", async () => {
    const { task, user } = await createTask();

    await updateTaskPosition({
      id: task.id,
      position: 0,
      status: "done",
      currentUserId: user.id,
    });

    expect(eventNames()).toEqual([
      "task.status_changed",
      "task-relation.refresh",
      "task.updated",
    ]);
    expect(publish).toHaveBeenCalledWith(
      "task.status_changed",
      expect.objectContaining({
        taskId: task.id,
        oldStatus: "to-do",
        newStatus: "done",
        title: "Stored title",
      }),
    );
  });

  it("a reorder publishes only the update that refreshes other boards", async () => {
    const { task, user } = await createTask();

    await updateTaskPosition({
      id: task.id,
      position: 0,
      status: undefined,
      currentUserId: user.id,
    });

    expect(eventNames()).toEqual(["task.updated"]);
  });
});
