import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
// Registers the activity subscribers on the real event bus.
import "../../apps/api/src/activity";
import db, { schema } from "../../apps/api/src/database";
import globalSearch from "../../apps/api/src/search/controllers/global-search";
import {
  setTaskAssigneesController,
  updateTaskAssigneesController,
} from "../../apps/api/src/task/controllers/update-task-assignees";
import { addPerson } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import {
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function scene(title = "Assigned work") {
  const owner = await createWorkspaceMember({ role: "owner", userName: "Ada" });
  const ana = await addPerson(owner.workspace.id, "Ana");
  const ben = await addPerson(owner.workspace.id, "Ben");
  const { project, columns } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      columnId: columns.todo.id,
      title,
      number: 1,
      status: "to-do",
    })
    .returning();
  if (!task) throw new Error("Failed to create task");
  return { ada: owner.user, ana, ben, task };
}

function activitiesOf(taskId: string) {
  return db
    .select({
      type: schema.activityTable.type,
      userId: schema.activityTable.userId,
      eventData: schema.activityTable.eventData,
    })
    .from(schema.activityTable)
    .where(eq(schema.activityTable.taskId, taskId))
    .orderBy(asc(schema.activityTable.createdAt));
}

/** Waits for the background subscriber to write `count` rows. */
async function settled(taskId: string, count: number) {
  await vi.waitFor(
    async () => expect(await activitiesOf(taskId)).toHaveLength(count),
    { timeout: 5000, interval: 25 },
  );
  return activitiesOf(taskId);
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("assignee activity", () => {
  it("records a replace as the removal, then the addition", async () => {
    const { ada, ana, ben, task } = await scene();
    await assignTask(task.id, [ana.id]);

    await setTaskAssigneesController({
      id: task.id,
      assigneeIds: [ben.id],
      currentUserId: ada.id,
    });

    expect(await settled(task.id, 2)).toEqual([
      {
        type: "unassigned",
        userId: ada.id,
        eventData: {
          oldAssigneeId: ana.id,
          oldAssignee: "Ana",
          isSelfUnassigned: false,
        },
      },
      {
        type: "assignee_changed",
        userId: ada.id,
        eventData: {
          newAssigneeId: ben.id,
          newAssignee: "Ben",
          isSelfAssigned: false,
        },
      },
    ]);
  });

  it("keeps the order for many people changed at once", async () => {
    const { ada, ana, ben, task } = await scene();
    await assignTask(task.id, [ana.id, ben.id]);

    await setTaskAssigneesController({
      id: task.id,
      assigneeIds: [ada.id],
      currentUserId: ada.id,
    });

    const rows = await settled(task.id, 3);
    expect(
      rows.map((row) => {
        const data = row.eventData as Record<string, unknown>;
        return [row.type, data.oldAssigneeId ?? data.newAssigneeId];
      }),
    ).toEqual([
      ["unassigned", ana.id],
      ["unassigned", ben.id],
      ["assignee_changed", ada.id],
    ]);
    expect(rows[2]?.eventData).toMatchObject({ isSelfAssigned: true });
  });

  it("marks a self-removal", async () => {
    const { ada, ana, task } = await scene();
    await assignTask(task.id, [ada.id, ana.id]);

    await updateTaskAssigneesController({
      id: task.id,
      remove: [ada.id],
      currentUserId: ada.id,
    });

    expect(await settled(task.id, 1)).toEqual([
      {
        type: "unassigned",
        userId: ada.id,
        eventData: {
          oldAssigneeId: ada.id,
          oldAssignee: "Ada",
          isSelfUnassigned: true,
        },
      },
    ]);
  });

  it("summarizes per-person and legacy rows in search", async () => {
    const { ada, ana, task } = await scene("Quarterly report");
    await assignTask(task.id, [ana.id]);
    await setTaskAssigneesController({
      id: task.id,
      assigneeIds: [],
      currentUserId: ada.id,
    });
    await settled(task.id, 1);
    // A row written before per-person assignees: no event data.
    await db.insert(schema.activityTable).values({
      taskId: task.id,
      type: "unassigned",
      userId: ada.id,
      eventData: {},
    });

    const { results } = await globalSearch({
      query: "Quarterly",
      userId: ada.id,
      type: "activities",
    });
    expect(results.map((result) => result.content).sort()).toEqual([
      "unassigned Ana",
      "unassigned the task",
    ]);
  });
});
