import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import createComment from "../../apps/api/src/activity/controllers/create-comment";
import db, { schema } from "../../apps/api/src/database";
import { publishEvent } from "../../apps/api/src/events";
// Registers the notification subscribers on the real event bus.
import "../../apps/api/src/notification";
import { checkDueDateReminders } from "../../apps/api/src/scheduler/due-date-reminders";
import createTask from "../../apps/api/src/task/controllers/create-task";
import { updateTaskAssigneesController } from "../../apps/api/src/task/controllers/update-task-assignees";
import updateTaskStatus from "../../apps/api/src/task/controllers/update-task-status";
import createTimeEntry from "../../apps/api/src/time-entry/controllers/create-time-entry";
import { addPerson, removeFromWorkspace } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import {
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

vi.mock("../../apps/api/src/notification-preferences/delivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

let nextNumber = 1;

async function scene() {
  const owner = await createWorkspaceMember({ role: "owner", userName: "Ada" });
  const ben = await addPerson(owner.workspace.id, "Ben");
  const cid = await addPerson(owner.workspace.id, "Cid");
  const { project, columns } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const task = async (
    assignees: string[],
    overrides: Partial<typeof schema.taskTable.$inferInsert> = {},
  ) => {
    const [created] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        columnId: columns.todo.id,
        title: `Task ${nextNumber}`,
        number: nextNumber++,
        status: "to-do",
        ...overrides,
      })
      .returning();
    if (!created) throw new Error("Failed to create task");
    await assignTask(created.id, assignees);
    return created;
  };
  return {
    ada: owner.user,
    ben,
    cid,
    workspace: owner.workspace,
    project,
    task,
  };
}

function notificationsOf(taskId: string) {
  return db
    .select({
      userId: schema.notificationTable.userId,
      type: schema.notificationTable.type,
    })
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.resourceId, taskId));
}

/** Waits for the background subscribers to write `count` notifications. */
async function settled(taskId: string, count: number) {
  await vi.waitFor(
    async () => expect(await notificationsOf(taskId)).toHaveLength(count),
    { timeout: 5000, interval: 25 },
  );
  const rows = await notificationsOf(taskId);
  return rows.sort((a, b) =>
    `${a.userId}${a.type}`.localeCompare(`${b.userId}${b.type}`),
  );
}

function expectRecipients(
  rows: Array<{ userId: string; type: string | null }>,
  expected: Array<[string, string]>,
) {
  expect(rows.map((row) => [row.userId, row.type]).sort()).toEqual(
    [...expected].sort(),
  );
}

beforeEach(async () => {
  await resetTestDatabase();
  nextNumber = 1;
});

describe("assignee notifications", () => {
  it("tells every assignee but the actor about a status change", async () => {
    const { ada, ben, cid, task } = await scene();
    const target = await task([ada.id, ben.id, cid.id]);

    await updateTaskStatus({
      id: target.id,
      status: "in-progress",
      currentUserId: ada.id,
    });

    expectRecipients(await settled(target.id, 2), [
      [ben.id, "task_status_changed"],
      [cid.id, "task_status_changed"],
    ]);
  });

  it("tells everyone when an integration changes the status", async () => {
    const { ada, ben, project, task } = await scene();
    const target = await task([ada.id, ben.id]);

    await publishEvent("task.status_changed", {
      taskId: target.id,
      projectId: project.id,
      userId: null,
      oldStatus: "to-do",
      newStatus: "done",
      title: target.title,
      assigneeId: ada.id,
      type: "status_changed",
    });

    expectRecipients(await settled(target.id, 2), [
      [ada.id, "task_status_changed"],
      [ben.id, "task_status_changed"],
    ]);
  });

  it("tells every assignee about a comment, and a mentioned one only once", async () => {
    const { ada, ben, cid, task } = await scene();
    const target = await task([ada.id, ben.id, cid.id]);

    await createComment(
      target.id,
      ben.id,
      `Ping <margaya-mention id="${cid.id}">Cid</margaya-mention>`,
    );

    expectRecipients(await notificationsOf(target.id), [
      [cid.id, "task_mention"],
      [ada.id, "task_comment"],
    ]);
  });

  it("tells the other assignees about a new task", async () => {
    const { ada, ben, project } = await scene();

    const created = await createTask({
      projectId: project.id,
      currentUserId: ada.id,
      assigneeIds: [ada.id, ben.id],
      title: "Shared",
      status: "to-do",
    });

    expectRecipients(await settled(created.id, 1), [[ben.id, "task_created"]]);
  });

  it("tells the other assignees when someone logs time", async () => {
    const { ada, ben, task } = await scene();
    const target = await task([ada.id, ben.id]);

    await createTimeEntry({
      taskId: target.id,
      userId: ben.id,
      startTime: new Date(),
    });

    expectRecipients(await settled(target.id, 1), [
      [ada.id, "time_entry_created"],
    ]);
  });

  it("tells each added person, but nobody who adds themselves", async () => {
    const { ada, ben, task } = await scene();
    const target = await task([]);

    await updateTaskAssigneesController({
      id: target.id,
      add: [ada.id, ben.id],
      currentUserId: ada.id,
    });

    expectRecipients(await settled(target.id, 1), [
      [ben.id, "task_assignee_changed"],
    ]);
  });
});

describe("due-date reminders for several assignees", () => {
  const overdue = () => ({ dueDate: new Date(Date.now() - 60_000) });

  function remindersOf(taskId: string) {
    return db
      .select({ type: schema.taskReminderSentTable.reminderType })
      .from(schema.taskReminderSentTable)
      .where(eq(schema.taskReminderSentTable.taskId, taskId));
  }

  it("reminds every assignee once per task", async () => {
    const { ada, ben, task } = await scene();
    const target = await task([ada.id, ben.id], overdue());

    await checkDueDateReminders();
    expectRecipients(await notificationsOf(target.id), [
      [ada.id, "task_overdue"],
      [ben.id, "task_overdue"],
    ]);
    expect((await remindersOf(target.id)).map((r) => r.type).sort()).toEqual(
      [`overdue:user:${ada.id}`, `overdue:user:${ben.id}`].sort(),
    );

    await checkDueDateReminders();
    expect(await notificationsOf(target.id)).toHaveLength(2);
  });

  it("respects each person's switch and membership", async () => {
    const { ada, ben, cid, workspace, task } = await scene();
    await db
      .insert(schema.userNotificationPreferenceTable)
      .values({ userId: ben.id, dueDateReminderEnabled: false });
    await removeFromWorkspace(cid.id, workspace.id);
    const target = await task([ada.id, ben.id, cid.id], overdue());

    await checkDueDateReminders();

    expectRecipients(await notificationsOf(target.id), [
      [ada.id, "task_overdue"],
    ]);
    expect(await remindersOf(target.id)).toEqual([
      { type: `overdue:user:${ada.id}` },
    ]);
    expect(
      await db
        .select()
        .from(schema.workspaceUserTable)
        .where(
          and(
            eq(schema.workspaceUserTable.userId, cid.id),
            eq(schema.workspaceUserTable.workspaceId, workspace.id),
          ),
        ),
    ).toEqual([]);
  });
});
