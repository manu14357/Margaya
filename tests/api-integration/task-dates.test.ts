import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  activityRows,
  json,
  settledActivity,
  taskDetailScene,
} from "./helpers/task-detail";

const START = "2026-11-02T00:00:00.000Z";
const DUE = "2026-11-04T00:00:00.000Z";

beforeEach(async () => {
  await resetTestDatabase();
});

async function scene() {
  const s = await taskDetailScene();
  const task = await s.createTask({
    title: "Loaded title",
    description: "Loaded description",
    priority: "low",
    startDate: new Date(START),
    dueDate: new Date(DUE),
  });
  const setDates = (user: typeof s.member, body: unknown, id = task.id) =>
    s.as(user)(`/task/dates/${id}`, json("PUT", body));
  return { ...s, task, setDates };
}

function storedTask(id: string) {
  return db.query.taskTable.findFirst({ where: eq(schema.taskTable.id, id) });
}

async function storedDates(id: string) {
  const task = await storedTask(id);
  return {
    startDate: task?.startDate?.toISOString() ?? null,
    dueDate: task?.dueDate?.toISOString() ?? null,
  };
}

/** Lets background subscribers finish before asserting nothing arrived. */
function quiet() {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

describe("API integration: task dates", () => {
  it("a schedule drag cannot undo a newer edit made after the board loaded", async () => {
    const { as, member, task, columns, setDates } = await scene();
    const asMember = as(member);

    // A colleague edits the task after this client loaded its board.
    for (const [field, body] of [
      ["title", { title: "Newer title" }],
      ["description", { description: "Newer description" }],
      ["priority", { priority: "high" }],
      ["status", { status: "done" }],
    ] as const) {
      const edited = await asMember(
        `/task/${field}/${task.id}`,
        json("PUT", body),
      );
      expect(edited.status).toBe(200);
    }

    const response = await setDates(member, {
      startDate: "2026-11-09T00:00:00.000Z",
      dueDate: "2026-11-11T00:00:00.000Z",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: task.id,
      title: "Newer title",
      status: "done",
      startDate: "2026-11-09T00:00:00.000Z",
      dueDate: "2026-11-11T00:00:00.000Z",
    });

    expect(await storedTask(task.id)).toMatchObject({
      title: "Newer title",
      description: "Newer description",
      priority: "high",
      status: "done",
      columnId: columns.done.id,
    });
    expect(await storedDates(task.id)).toEqual({
      startDate: "2026-11-09T00:00:00.000Z",
      dueDate: "2026-11-11T00:00:00.000Z",
    });
  });

  it("moves both dates in one write, even past the old due date", async () => {
    const { member, task, setDates } = await scene();

    // The new start is after the stored due date: one date at a time, in
    // either order, would pass through an invalid range.
    const response = await setDates(member, {
      startDate: "2026-11-09T00:00:00.000Z",
      dueDate: "2026-11-11T00:00:00.000Z",
    });
    expect(response.status).toBe(200);

    const [start] = await settledActivity(task.id, "start_date_changed");
    expect(start).toMatchObject({
      userId: member.id,
      eventData: {
        oldStartDate: START,
        newStartDate: "2026-11-09T00:00:00.000Z",
      },
    });
    const [due] = await settledActivity(task.id, "due_date_changed");
    expect(due?.eventData).toEqual({
      oldDueDate: DUE,
      newDueDate: "2026-11-11T00:00:00.000Z",
    });
  });

  it("keeps a date left out, clears one sent as null, and records only what changed", async () => {
    const { member, task, setDates } = await scene();

    expect(
      (await setDates(member, { dueDate: "2026-11-06T00:00:00.000Z" })).status,
    ).toBe(200);
    expect(await storedDates(task.id)).toEqual({
      startDate: START,
      dueDate: "2026-11-06T00:00:00.000Z",
    });

    expect((await setDates(member, { startDate: null })).status).toBe(200);
    expect(await storedDates(task.id)).toEqual({
      startDate: null,
      dueDate: "2026-11-06T00:00:00.000Z",
    });

    await settledActivity(task.id, "due_date_changed");
    await settledActivity(task.id, "start_date_changed");
    const before = await storedTask(task.id);

    // The dates it already has: nothing is written or recorded.
    expect(
      (
        await setDates(member, {
          startDate: null,
          dueDate: "2026-11-06T00:00:00.000Z",
        })
      ).status,
    ).toBe(200);
    await quiet();
    expect(await activityRows(task.id, "due_date_changed")).toHaveLength(1);
    expect(await activityRows(task.id, "start_date_changed")).toHaveLength(1);
    expect((await storedTask(task.id))?.updatedAt).toEqual(before?.updatedAt);
  });

  it("refuses a start after the due date, also against the stored one, and writes nothing", async () => {
    const { member, task, setDates } = await scene();

    for (const body of [
      // Only a start is sent: it is checked against the stored due date.
      { startDate: "2026-11-05T00:00:00.000Z" },
      { dueDate: "2026-11-01T00:00:00.000Z" },
      {
        startDate: "2026-11-10T00:00:00.000Z",
        dueDate: "2026-11-09T00:00:00.000Z",
      },
      {},
      { dueDate: "" },
      { startDate: "not a date" },
      { dueDate: 7 },
    ]) {
      const response = await setDates(member, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(await storedDates(task.id)).toEqual({
      startDate: START,
      dueDate: DUE,
    });
  });

  it("resets sent reminders only when the due date moves", async () => {
    const { member, task, setDates } = await scene();
    await db
      .insert(schema.taskReminderSentTable)
      .values({ taskId: task.id, reminderType: "due_soon" });
    const reminders = () =>
      db
        .select()
        .from(schema.taskReminderSentTable)
        .where(eq(schema.taskReminderSentTable.taskId, task.id));

    await setDates(member, { startDate: "2026-11-03T00:00:00.000Z" });
    expect(await reminders()).toHaveLength(1);

    await setDates(member, { dueDate: "2026-11-08T00:00:00.000Z" });
    expect(await reminders()).toEqual([]);
  });

  it("requires task:update and stays inside the task's workspace", async () => {
    const { viewer, outsider, task, setDates } = await scene();
    const body = { dueDate: "2026-11-20T00:00:00.000Z" };

    expect((await setDates(viewer, body)).status).toBe(403);
    expect([403, 404]).toContain((await setDates(outsider, body)).status);
    expect(await storedDates(task.id)).toEqual({
      startDate: START,
      dueDate: DUE,
    });
  });

  it("an instance admin outside the workspace moves both dates", async () => {
    const { task, setDates } = await scene();
    const id = `user-${randomUUID()}`;
    const [instanceAdmin] = await db
      .insert(schema.userTable)
      .values({
        id,
        email: `${id}@example.com`,
        emailVerified: true,
        name: "Instance admin",
        role: "admin",
      })
      .returning();
    if (!instanceAdmin) throw new Error("no user");

    const response = await setDates(instanceAdmin, {
      startDate: "2026-11-09T00:00:00.000Z",
      dueDate: "2026-11-11T00:00:00.000Z",
    });
    expect(response.status).toBe(200);
    expect(await storedDates(task.id)).toEqual({
      startDate: "2026-11-09T00:00:00.000Z",
      dueDate: "2026-11-11T00:00:00.000Z",
    });
  });

  it("treats a trashed task as gone", async () => {
    const { member, task, setDates } = await scene();
    await db
      .update(schema.taskTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.taskTable.id, task.id));

    expect(
      (await setDates(member, { dueDate: "2026-11-20T00:00:00.000Z" })).status,
    ).toBe(404);
    expect((await storedTask(task.id))?.dueDate?.toISOString()).toBe(DUE);
  });
});
