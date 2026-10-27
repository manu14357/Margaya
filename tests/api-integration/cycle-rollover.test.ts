import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { runCycleRollover } from "../../apps/api/src/project-automation/cycle-rollover";
import { shiftDate } from "../../apps/api/src/utils/calendar-date";
import { todayInTimezone } from "../../apps/api/src/utils/zoned-date";
import { mockAuthenticatedSession } from "./helpers/auth";
import { cycleContext, day, json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import { addWorkspaceMember } from "./helpers/fixtures";

async function rolloverScene({ enabled = true } = {}) {
  const ctx = await cycleContext("admin");
  const lead = await addWorkspaceMember(ctx.workspace.id, "member");
  await db
    .update(schema.projectTable)
    .set({ leadUserId: lead.id })
    .where(eq(schema.projectTable.id, ctx.project.id));
  await db.insert(schema.columnTable).values({
    projectId: ctx.project.id,
    name: "Cancelled",
    slug: "cancelled",
    group: "cancelled",
    isFinal: true,
    position: 4,
  });
  if (enabled) {
    await db.insert(schema.projectAutomationTable).values({
      projectId: ctx.project.id,
      cycleRolloverEnabled: true,
      cycleRolloverSince: day(-30),
    });
  }
  const ended = await ctx.insertCycle({
    name: "Sprint 1",
    startDate: day(-10),
    endDate: day(-1),
  });
  const next = await ctx.insertCycle({
    name: "Sprint 2",
    startDate: day(1),
    endDate: day(10),
  });
  const later = await ctx.insertCycle({
    name: "Sprint 3",
    startDate: day(11),
    endDate: day(20),
  });
  const tasks = {
    todo: await ctx.createTask({ status: "to-do" }),
    started: await ctx.createTask({ status: "in-progress" }),
    done: await ctx.createTask({
      status: "done",
      completedAt: new Date(`${day(-3)}T12:00:00Z`),
    }),
    cancelled: await ctx.createTask({ status: "cancelled" }),
  };
  await ctx.addToCycle(
    ended.id,
    Object.values(tasks).map((task) => task.id),
  );

  const cycleRow = async (id: string) => {
    const [row] = await db
      .select()
      .from(schema.cycleTable)
      .where(eq(schema.cycleTable.id, id));
    return row;
  };
  const rolloverActivity = () =>
    db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.type, "cycle_changed"),
          isNull(schema.activityTable.userId),
        ),
      );
  const leadNotifications = () =>
    db
      .select()
      .from(schema.notificationTable)
      .where(
        and(
          eq(schema.notificationTable.userId, lead.id),
          eq(schema.notificationTable.type, "cycle_rollover"),
        ),
      );
  return {
    ...ctx,
    lead,
    ended,
    next,
    later,
    tasks,
    cycleRow,
    rolloverActivity,
    leadNotifications,
  };
}

describe("API integration: cycle auto-rollover", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("moves unfinished tasks to the next cycle once, with history and one summary", async () => {
    const s = await rolloverScene();

    const first = await runCycleRollover();
    expect(first).toMatchObject({ degraded: false, cycles: 1, moved: 2 });

    expect(await s.membership(s.tasks.todo.id)).toBe(s.next.id);
    expect(await s.membership(s.tasks.started.id)).toBe(s.next.id);
    expect(await s.membership(s.tasks.done.id)).toBe(s.ended.id);
    expect(await s.membership(s.tasks.cancelled.id)).toBe(s.ended.id);

    const ended = await s.cycleRow(s.ended.id);
    expect(ended?.rolledOverAt).not.toBeNull();
    expect(ended?.progressSnapshot).not.toBeNull();
    expect(ended?.rolloverResult).toEqual({
      outcome: "moved",
      movedCount: 2,
      targetCycleId: s.next.id,
      targetCycleName: "Sprint 2",
    });

    const history = await s.rolloverActivity();
    expect(history.map((row) => row.taskId).sort()).toEqual(
      [s.tasks.todo.id, s.tasks.started.id].sort(),
    );
    expect(history[0]?.eventData).toMatchObject({
      oldCycleId: s.ended.id,
      newCycleId: s.next.id,
      automation: { rule: "cycle_rollover" },
    });

    const notifications = await s.leadNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.eventData).toMatchObject({
      cycleId: s.ended.id,
      targetCycleId: s.next.id,
      outcome: "moved",
      count: 2,
    });

    // The cycle API shows what happened.
    const response = await s.app.request(`/api/cycle/${s.ended.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      isFrozen: true,
      rollover: { outcome: "moved", movedCount: 2, targetCycleId: s.next.id },
    });
  });

  it("is idempotent across repeated and concurrent runs", async () => {
    const s = await rolloverScene();

    const [a, b] = await Promise.all([runCycleRollover(), runCycleRollover()]);
    expect(a.cycles + b.cycles).toBe(1);
    const again = await runCycleRollover();
    expect(again).toMatchObject({ cycles: 0, moved: 0 });

    // A task added to the ended cycle afterwards stays: the cycle was handled.
    const late = await s.createTask({ status: "to-do" });
    await s.addToCycle(s.ended.id, [late.id]);
    expect(await runCycleRollover()).toMatchObject({ cycles: 0, moved: 0 });
    expect(await s.membership(late.id)).toBe(s.ended.id);

    expect(await s.rolloverActivity()).toHaveLength(2);
    expect(await s.leadNotifications()).toHaveLength(1);
  });

  it("is off by default and skips cycles that ended before it was turned on", async () => {
    const off = await rolloverScene({ enabled: false });
    expect(await runCycleRollover()).toMatchObject({ cycles: 0, moved: 0 });
    expect(await off.membership(off.tasks.todo.id)).toBe(off.ended.id);
    expect((await off.cycleRow(off.ended.id))?.rolledOverAt).toBeNull();

    await resetTestDatabase();
    const s = await rolloverScene();
    await db
      .update(schema.projectAutomationTable)
      .set({ cycleRolloverSince: day(0) })
      .where(eq(schema.projectAutomationTable.projectId, s.project.id));
    expect(await runCycleRollover()).toMatchObject({ cycles: 0 });
    expect(await s.membership(s.tasks.todo.id)).toBe(s.ended.id);
  });

  it("records a cycle without a next one once and tells the lead", async () => {
    const s = await rolloverScene();
    await db
      .update(schema.cycleTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.cycleTable.projectId, s.project.id));
    await db
      .update(schema.cycleTable)
      .set({ archivedAt: null })
      .where(eq(schema.cycleTable.id, s.ended.id));

    expect(await runCycleRollover()).toMatchObject({ cycles: 1, moved: 0 });
    expect(await s.membership(s.tasks.todo.id)).toBe(s.ended.id);
    expect((await s.cycleRow(s.ended.id))?.rolloverResult).toEqual({
      outcome: "no_next_cycle",
      movedCount: 0,
      targetCycleId: null,
      targetCycleName: null,
    });
    const notifications = await s.leadNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.eventData).toMatchObject({
      outcome: "no_next_cycle",
      count: 2,
    });

    // Creating a next cycle later does not reopen the handled one.
    await s.insertCycle({ name: "Late", startDate: day(2), endDate: day(5) });
    expect(await runCycleRollover()).toMatchObject({ cycles: 0 });
    expect(await s.leadNotifications()).toHaveLength(1);
  });

  it("waits for the end of the day in the workspace's time zone", async () => {
    const s = await rolloverScene();
    // UTC-11: on most of the UTC day, the local date is one day behind.
    const zone = "Pacific/Pago_Pago";
    await db
      .update(schema.workspaceTable)
      .set({ timezone: zone })
      .where(eq(schema.workspaceTable.id, s.workspace.id));
    const now = new Date();
    const localToday = todayInTimezone(zone, now);
    await db
      .update(schema.cycleTable)
      .set({ startDate: shiftDate(localToday, -5), endDate: localToday })
      .where(eq(schema.cycleTable.id, s.ended.id));

    expect(await runCycleRollover(now)).toMatchObject({ cycles: 0 });
    expect(await s.membership(s.tasks.todo.id)).toBe(s.ended.id);

    // A day later (local time) it has ended.
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(await runCycleRollover(tomorrow)).toMatchObject({ cycles: 1 });
    expect(await s.membership(s.tasks.todo.id)).not.toBe(s.ended.id);
  });

  it("guards the setting with project:update and dates it from yesterday", async () => {
    const s = await rolloverScene({ enabled: false });
    const path = `/api/project-automation/${s.project.id}`;

    mockAuthenticatedSession(s.lead);
    const denied = await s.app.request(
      path,
      json("PATCH", { cycleRollover: { enabled: true } }),
    );
    expect(denied.status).toBe(403);

    mockAuthenticatedSession(s.user);
    const on = await s.app.request(
      path,
      json("PATCH", { cycleRollover: { enabled: true } }),
    );
    expect(on.status, await on.clone().text()).toBe(200);
    expect(await on.json()).toMatchObject({
      cycleRollover: { enabled: true, since: day(-1), lastRolledOverCount: 0 },
    });

    expect(await runCycleRollover()).toMatchObject({ cycles: 1, moved: 2 });
    const read = await s.app.request(path);
    expect(await read.json()).toMatchObject({
      cycleRollover: { enabled: true, lastRolledOverCount: 2 },
    });
  });
});
