import { beforeEach, describe, expect, it, vi } from "vitest";
import createComment from "../../apps/api/src/activity/controllers/create-comment";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import { publishEvent } from "../../apps/api/src/events";
// Registers the notification subscribers on the real event bus.
import "../../apps/api/src/notification";
import { notifyTaskEvent } from "../../apps/api/src/notification/recipients";
import { checkDueDateReminders } from "../../apps/api/src/scheduler/due-date-reminders";
import {
  muteUser,
  subscribeUsers,
} from "../../apps/api/src/subscription/service";
import createTask from "../../apps/api/src/task/controllers/create-task";
import updateTaskDueDate from "../../apps/api/src/task/controllers/update-task-due-date";
import updateTaskPriority from "../../apps/api/src/task/controllers/update-task-priority";
import updateTaskStatus from "../../apps/api/src/task/controllers/update-task-status";
import updateTaskTitle from "../../apps/api/src/task/controllers/update-task-title";
import createTimeEntry from "../../apps/api/src/time-entry/controllers/create-time-entry";
import { removeFromWorkspace } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import {
  inboxScene,
  mentionOf,
  notificationsOf,
  recipientsOf,
  settledNotifications,
  sortedPairs,
} from "./helpers/inbox";

vi.mock("../../apps/api/src/notification-preferences/delivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

beforeEach(async () => {
  await resetTestDatabase();
});

/** Ada, Ben and Cid plus Dee; a task assigned to Ada and Ben, watched by Cid. */
async function watched() {
  const scene = await inboxScene();
  const dee = await scene.person("Dee");
  const target = await scene.task([scene.ada.id, scene.ben.id]);
  await subscribeUsers(target.id, [scene.cid.id], "manual");
  return { ...scene, dee, target };
}

describe("recipients per event", () => {
  it("tells assignees and subscribers about a status change, not the actor", async () => {
    const { ada, ben, cid, target } = await watched();
    await updateTaskStatus({
      id: target.id,
      status: "in-progress",
      currentUserId: ada.id,
    });
    expect(await settledNotifications(target.id, 2)).toEqual(
      sortedPairs([
        [ben.id, "task_status_changed"],
        [cid.id, "task_status_changed"],
      ]),
    );
    const [row] = await notificationsOf(target.id);
    expect(row).toMatchObject({ actorId: ada.id });
    expect(row?.eventData).toMatchObject({
      taskKey: "INB-1000",
      actorName: "Ada",
      oldStatus: "to-do",
      newStatus: "in-progress",
    });
  });

  it("tells everyone when an integration changes the status", async () => {
    const { ada, ben, cid, project, target } = await watched();
    await publishEvent("task.status_changed", {
      taskId: target.id,
      projectId: project.id,
      userId: null,
      oldStatus: "to-do",
      newStatus: "done",
      title: target.title,
      type: "status_changed",
    });
    expect(await settledNotifications(target.id, 3)).toEqual(
      sortedPairs([
        [ada.id, "task_status_changed"],
        [ben.id, "task_status_changed"],
        [cid.id, "task_status_changed"],
      ]),
    );
    expect((await notificationsOf(target.id))[0]?.actorId).toBeNull();
  });

  it("silences a muted assignee except for mentions and assignments", async () => {
    const { ada, ben, dee, project, task } = await watched();
    const target = await task([ada.id, dee.id]);
    await muteUser(target.id, dee.id);

    await updateTaskStatus({
      id: target.id,
      status: "in-progress",
      currentUserId: ada.id,
    });
    await createComment(target.id, ben.id, "status?");
    await updateTaskPriority({
      id: target.id,
      priority: "urgent",
      currentUserId: ada.id,
    });
    await createTimeEntry({
      taskId: target.id,
      userId: ada.id,
      startTime: new Date(),
    });
    // Ben's comment reaches Ada (assignee); Ben watches as commenter now.
    await vi.waitFor(async () => {
      const pairs = await recipientsOf(target.id);
      expect(pairs.some(([, type]) => type === "task_updated")).toBe(true);
    });
    expect(
      (await recipientsOf(target.id)).filter(([userId]) => userId === dee.id),
    ).toEqual([]);

    await createComment(target.id, ada.id, `Hey ${mentionOf(dee)}`);
    await publishEvent("task.assignee_changed", {
      taskId: target.id,
      projectId: project.id,
      userId: ada.id,
      newAssigneeId: dee.id,
      title: target.title,
    });
    await vi.waitFor(async () =>
      expect(
        (await recipientsOf(target.id))
          .filter(([userId]) => userId === dee.id)
          .map(([, type]) => type)
          .sort(),
      ).toEqual(["task_assignee_changed", "task_mention"]),
    );
  });

  it("tells watchers about a comment and a mentioned watcher only once", async () => {
    const { ada, ben, cid, target } = await watched();
    await createComment(target.id, ben.id, `Ping ${mentionOf(cid)}`);
    expect(await recipientsOf(target.id)).toEqual(
      sortedPairs([
        [ada.id, "task_comment"],
        [cid.id, "task_mention"],
      ]),
    );
    const rows = await notificationsOf(target.id);
    const comment = rows.find((row) => row.type === "task_comment");
    expect(comment?.eventData).toMatchObject({
      commenterName: "Ben",
      commentPreview: "Ping @Cid",
    });
    const mention = rows.find((row) => row.type === "task_mention");
    expect(mention?.eventData).toMatchObject({
      mentionerName: "Ben",
      source: "comment",
      commentPreview: "Ping @Cid",
    });
  });

  it("tells watchers about priority, due date and title changes", async () => {
    const { ada, ben, cid, target } = await watched();
    await updateTaskPriority({
      id: target.id,
      priority: "urgent",
      currentUserId: ada.id,
    });
    await settledNotifications(target.id, 2);
    await updateTaskDueDate({
      id: target.id,
      dueDate: new Date("2026-10-01T00:00:00.000Z"),
      currentUserId: ada.id,
    });
    await settledNotifications(target.id, 4);
    await updateTaskDueDate({
      id: target.id,
      dueDate: null,
      currentUserId: ada.id,
    });
    await settledNotifications(target.id, 6);
    await updateTaskTitle({
      id: target.id,
      title: "Renamed",
      currentUserId: ada.id,
    });
    const pairs = await settledNotifications(target.id, 8);
    expect(new Set(pairs.map(([userId]) => userId))).toEqual(
      new Set([ben.id, cid.id]),
    );
    expect(new Set(pairs.map(([, type]) => type))).toEqual(
      new Set(["task_updated"]),
    );
    const data = (await notificationsOf(target.id))
      .filter((row) => row.userId === ben.id)
      .map((row) => row.eventData as Record<string, unknown>)
      .map(({ field, oldValue, newValue }) => ({ field, oldValue, newValue }));
    expect(data).toEqual(
      expect.arrayContaining([
        { field: "priority", oldValue: "low", newValue: "urgent" },
        {
          field: "dueDate",
          oldValue: null,
          newValue: "2026-10-01T00:00:00.000Z",
        },
        {
          field: "dueDate",
          oldValue: "2026-10-01T00:00:00.000Z",
          newValue: null,
        },
        { field: "title", oldValue: target.title, newValue: "Renamed" },
      ]),
    );
  });

  it("tells only assignees about time entries and new tasks", async () => {
    const { ada, ben, cid, project, target } = await watched();
    await createTimeEntry({
      taskId: target.id,
      userId: ben.id,
      startTime: new Date(),
    });
    expect(await settledNotifications(target.id, 1)).toEqual([
      [ada.id, "time_entry_created"],
    ]);

    const created = await createTask({
      projectId: project.id,
      currentUserId: ada.id,
      assigneeIds: [ada.id, cid.id],
      title: "New",
      status: "to-do",
    });
    expect(await settledNotifications(created.id, 1)).toEqual([
      [cid.id, "task_created"],
    ]);
  });

  it("leaves out former members and people who switched the type off", async () => {
    const { ada, ben, cid, dee, workspace, task } = await watched();
    const target = await task([ada.id, ben.id]);
    await subscribeUsers(target.id, [cid.id, dee.id], "manual");
    await removeFromWorkspace(dee.id, workspace.id);
    await db.insert(schema.userNotificationPreferenceTable).values([
      { userId: ben.id, taskUpdateEnabled: false },
      { userId: cid.id, taskStatusChangeEnabled: false },
    ]);

    await notifyTaskEvent({
      taskId: target.id,
      kind: "updated",
      actorId: ada.id,
      eventData: { field: "title", oldValue: "a", newValue: "b" },
    });
    await notifyTaskEvent({
      taskId: target.id,
      kind: "statusChanged",
      actorId: ada.id,
      eventData: { oldStatus: "to-do", newStatus: "done" },
    });
    expect(await recipientsOf(target.id)).toEqual(
      sortedPairs([
        [cid.id, "task_updated"],
        [ben.id, "task_status_changed"],
      ]),
    );
  });
});

describe("due-date reminders", () => {
  it("skip an assignee who unsubscribed, and only them", async () => {
    const { ada, ben, dee, task } = await watched();
    const target = await task([ada.id, ben.id, dee.id], {
      dueDate: new Date(Date.now() - 60_000),
    });
    await muteUser(target.id, dee.id);
    // A manual subscription of a non-assignee does not add a reminder.
    await checkDueDateReminders();
    expect(await recipientsOf(target.id)).toEqual(
      sortedPairs([
        [ada.id, "task_overdue"],
        [ben.id, "task_overdue"],
      ]),
    );
    const [row] = await notificationsOf(target.id);
    expect(row?.workspaceId).toBeTruthy();
    expect(row?.actorId).toBeNull();
  });
});

describe("statement budget", () => {
  async function statementsFor(recipientCount: number) {
    const scene = await inboxScene();
    const people = await Promise.all(
      Array.from({ length: recipientCount }, (_, i) =>
        scene.person(`Watcher ${i}`),
      ),
    );
    const target = await scene.task([scene.ada.id]);
    await subscribeUsers(
      target.id,
      people.map((person) => person.id),
      "manual",
    );

    const pool = getDatabasePool();
    const spy = vi.spyOn(pool, "query");
    const rows = await notifyTaskEvent({
      taskId: target.id,
      kind: "comment",
      actorId: scene.ada.id,
      eventData: { commentPreview: "x" },
    });
    const texts = spy.mock.calls.map(([query]) =>
      typeof query === "string"
        ? query
        : ((query as { text?: string }).text ?? ""),
    );
    spy.mockRestore();
    expect(rows).toHaveLength(recipientCount);
    return {
      total: texts.length,
      inserts: texts.filter((text) => /^\s*insert/i.test(text)).length,
    };
  }

  it("runs the same statements for 2 and for 30 recipients, with one insert", async () => {
    const small = await statementsFor(2);
    await resetTestDatabase();
    const large = await statementsFor(30);
    expect(large).toEqual(small);
    expect(small.inserts).toBe(1);
  });
});
