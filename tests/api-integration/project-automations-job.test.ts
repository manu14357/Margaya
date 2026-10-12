import { and, asc, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  PROJECT_AUTOMATIONS_LEASE,
  runProjectAutomations,
} from "../../apps/api/src/project-automation/job";
import {
  automationRow,
  automationScene,
  monthsAgo,
  taskRow,
} from "./helpers/automations";
import { resetTestDatabase } from "./helpers/database";
import { day } from "./helpers/drafts";
import { createProjectFixture } from "./helpers/fixtures";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
} from "./helpers/intake";

recordEvents("task.automation_applied", "task.archived", "task.status_changed");

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
});

async function setFlags(
  projectId: string,
  flags: Partial<typeof schema.projectTable.$inferInsert>,
) {
  await db
    .update(schema.projectTable)
    .set(flags)
    .where(eq(schema.projectTable.id, projectId));
}

async function activities(taskIds: string[]) {
  return db
    .select({
      taskId: schema.activityTable.taskId,
      type: schema.activityTable.type,
      userId: schema.activityTable.userId,
      eventData: schema.activityTable.eventData,
    })
    .from(schema.activityTable)
    .where(inArray(schema.activityTable.taskId, taskIds));
}

describe("auto-archive", () => {
  it("archives closed tasks untouched for the chosen months, and nothing else", async () => {
    const s = await automationScene();
    const now = new Date();
    const web = s.web.project.id;
    const api = s.api.project.id;
    // api: cycles and modules off, so memberships are ignored there.
    await setFlags(api, { cyclesEnabled: false, modulesEnabled: false });
    const { project: ops } = await createProjectFixture({
      workspaceId: s.workspaceId,
      slug: "ops",
    });
    await setFlags(ops.id, { archivedAt: new Date() });

    const current = await s.insertCycle({ name: "Current" });
    const completed = await s.insertCycle({
      name: "Done",
      startDate: day(-30),
      endDate: day(-2),
    });
    const draftCycle = await s.insertCycle({
      name: "Draft",
      startDate: null,
      endDate: null,
    });
    const apiCycle = await s.insertCycle({
      projectId: api,
      name: "API current",
    });
    const running = await s.insertModule({ name: "Running" });
    const late = await s.insertModule({ name: "Late", targetDate: day(-1) });
    const cancelledModule = await s.insertModule({
      name: "Dropped",
      status: "cancelled",
    });
    const apiModule = await s.insertModule({
      projectId: api,
      name: "API running",
    });
    const [triage] = await db
      .insert(schema.columnTable)
      .values({
        projectId: web,
        name: "Triage",
        slug: "triage",
        group: "triage",
        position: 99,
      })
      .returning();

    const t = {
      oldDone: await s.createTask({ status: "done" }),
      recentDone: await s.createTask({
        status: "done",
        updatedAt: monthsAgo(now, 2),
      }),
      cancelled: await s.createTask({ status: "wont-do" }),
      todo: await s.createTask({ status: "to-do" }),
      alreadyArchived: await s.createTask({
        status: "done",
        archivedAt: new Date("2025-01-01T00:00:00Z"),
      }),
      inCurrentCycle: await s.createTask({ status: "done" }),
      inCompletedCycle: await s.createTask({ status: "done" }),
      inDraftCycle: await s.createTask({ status: "done" }),
      inRunningModule: await s.createTask({ status: "done" }),
      inLateModule: await s.createTask({ status: "done" }),
      inCancelledModule: await s.createTask({ status: "done" }),
      triage: await s.createTask({ status: triage?.slug ?? "triage" }),
      apiInCycle: await s.createTask({ projectId: api, status: "done" }),
      apiInModule: await s.createTask({ projectId: api, status: "done" }),
      archivedProject: await s.createTask({
        projectId: ops.id,
        status: "done",
      }),
    };
    await db.insert(schema.cycleTaskTable).values([
      { taskId: t.inCurrentCycle.id, cycleId: current.id },
      { taskId: t.inCompletedCycle.id, cycleId: completed.id },
      { taskId: t.inDraftCycle.id, cycleId: draftCycle.id },
      { taskId: t.apiInCycle.id, cycleId: apiCycle.id },
    ]);
    await db.insert(schema.moduleTaskTable).values([
      { taskId: t.inRunningModule.id, moduleId: running.id },
      { taskId: t.inLateModule.id, moduleId: late.id },
      { taskId: t.inCancelledModule.id, moduleId: cancelledModule.id },
      { taskId: t.apiInModule.id, moduleId: apiModule.id },
    ]);
    for (const projectId of [web, api, ops.id]) {
      await s.configure({
        projectId,
        autoArchiveEnabled: true,
        autoArchiveMonths: 3,
      });
    }

    const outcome = await s.run(now);
    const expected = [
      t.oldDone,
      t.cancelled,
      t.inCompletedCycle,
      t.inLateModule,
      t.inCancelledModule,
      t.apiInCycle,
      t.apiInModule,
    ].map((task) => task.id);
    expect(outcome).toMatchObject({
      degraded: false,
      archived: expected.length,
      closed: 0,
      projects: 2,
    });

    for (const [name, task] of Object.entries(t)) {
      const row = await taskRow(task.id);
      if (expected.includes(task.id)) {
        expect(row.archivedAt?.getTime(), name).toBe(now.getTime());
        expect(row.status, name).toBe(task.status);
      } else if (name === "alreadyArchived") {
        expect(row.archivedAt?.toISOString(), name).toBe(
          "2025-01-01T00:00:00.000Z",
        );
      } else {
        expect(row.archivedAt, name).toBeNull();
      }
    }

    const history = await activities(expected);
    expect(history).toHaveLength(expected.length);
    for (const row of history) {
      expect(row).toMatchObject({
        type: "archived",
        userId: null,
        eventData: { automation: { rule: "auto_archive", months: 3 } },
      });
    }

    const applied = publishedEvents("task.automation_applied").map(
      (e) => e.data,
    );
    expect(applied).toHaveLength(2);
    expect(applied.find((e) => e.projectId === web)).toMatchObject({
      workspaceId: s.workspaceId,
      rule: "auto_archive",
      count: 5,
      months: 3,
    });
    expect(
      [
        ...((applied.find((e) => e.projectId === api)?.taskIds as string[]) ??
          []),
      ].sort(),
    ).toEqual([t.apiInCycle.id, t.apiInModule.id].sort());
    expect(publishedEvents("task.archived")).toEqual([]);

    expect(await automationRow(web)).toMatchObject({
      lastCheckedAt: now,
      lastArchivedAt: now,
      lastArchivedCount: 5,
    });
    // The archived project is never visited.
    expect((await automationRow(ops.id))?.lastCheckedAt).toBeNull();

    // A second pass right away finds nothing more.
    clearPublishedEvents();
    expect(await s.run(now)).toMatchObject({ archived: 0, closed: 0 });
    expect(publishedEvents()).toEqual([]);
  });

  it("drains large backlogs in batches and honors the caps", async () => {
    const s = await automationScene();
    const now = new Date();
    const web = s.web.project.id;
    const old = monthsAgo(now, 4);
    await db.insert(schema.taskTable).values(
      Array.from({ length: 600 }, (_, index) => ({
        projectId: web,
        title: `Bulk ${index}`,
        number: index + 1,
        status: "done",
        columnId: s.web.columns.done.id,
        updatedAt: old,
      })),
    );
    await s.configure({ autoArchiveEnabled: true });
    expect(await s.run(now)).toMatchObject({ archived: 500 });
    expect(await automationRow(web)).toMatchObject({ lastArchivedCount: 500 });
    expect(await s.run(now)).toMatchObject({ archived: 100 });
    expect(await s.run(now)).toMatchObject({ archived: 0 });
    // Nothing matched on the last visit, yet it was recorded.
    expect(await automationRow(web)).toMatchObject({
      lastCheckedAt: now,
      lastArchivedCount: 100,
    });
  });

  it("caps work per tick and visits the least recently checked project first", async () => {
    const s = await automationScene();
    const now = new Date();
    const web = s.web.project.id;
    const api = s.api.project.id;
    for (let i = 0; i < 4; i += 1) {
      await s.createTask({ status: "done" });
      await s.createTask({ projectId: api, status: "done" });
    }
    await s.configure({
      projectId: web,
      autoArchiveEnabled: true,
      lastCheckedAt: new Date("2026-01-02T00:00:00Z"),
    });
    await s.configure({
      projectId: api,
      autoArchiveEnabled: true,
      lastCheckedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(await s.run(now, { projects: 1 })).toMatchObject({
      projects: 1,
      archived: 4,
    });
    expect((await automationRow(api))?.lastArchivedCount).toBe(4);
    expect((await automationRow(web))?.lastArchivedAt).toBeNull();

    expect(await s.run(now, { overall: 3 })).toMatchObject({ archived: 3 });
    expect((await automationRow(web))?.lastArchivedCount).toBe(3);
  });

  it("skips a task another transaction holds and takes it on the next run", async () => {
    const s = await automationScene();
    const now = new Date();
    const busy = await s.createTask({ status: "done" });
    const free = await s.createTask({ status: "done" });
    await s.configure({ autoArchiveEnabled: true });

    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = () => {};
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await tx
        .select({ id: schema.taskTable.id })
        .from(schema.taskTable)
        .where(eq(schema.taskTable.id, busy.id))
        .for("update");
      locked();
      await released;
    });
    await isLocked;

    expect(await s.run(now)).toMatchObject({ archived: 1 });
    expect((await taskRow(free.id)).archivedAt).not.toBeNull();
    expect((await taskRow(busy.id)).archivedAt).toBeNull();
    release();
    await holder;

    expect(await s.run(now)).toMatchObject({ archived: 1 });
    expect((await taskRow(busy.id)).archivedAt).not.toBeNull();
  });

  it("does nothing while another instance holds the lease", async () => {
    const s = await automationScene();
    const task = await s.createTask({ status: "done" });
    await s.configure({ autoArchiveEnabled: true });
    await db.insert(schema.jobLeaseTable).values({
      name: PROJECT_AUTOMATIONS_LEASE,
      owner: "another-instance",
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    });
    expect(await runProjectAutomations()).toEqual({
      degraded: false,
      projects: 0,
      archived: 0,
      closed: 0,
    });
    expect((await taskRow(task.id)).archivedAt).toBeNull();
  });
});

describe("auto-close", () => {
  it("moves stale open work to the chosen Cancelled column, at the bottom", async () => {
    const s = await automationScene();
    const now = new Date();
    const web = s.web.project.id;
    await s.createTask({
      status: "wont-do",
      position: 7,
      updatedAt: monthsAgo(now, 1),
    });
    const t = {
      todo: await s.createTask({
        status: "to-do",
        updatedAt: monthsAgo(now, 6),
      }),
      started: await s.createTask({
        status: "in-progress",
        updatedAt: monthsAgo(now, 5),
      }),
      planned: await s.createTask({
        status: "planned",
        updatedAt: monthsAgo(now, 4),
      }),
      pastDue: await s.createTask({
        status: "to-do",
        dueDate: new Date(`${day(-30)}T00:00:00Z`),
        updatedAt: monthsAgo(now, 3),
      }),
      done: await s.createTask({ status: "done" }),
      dueNextWeek: await s.createTask({
        status: "to-do",
        dueDate: new Date(`${day(7)}T00:00:00Z`),
      }),
      startsTomorrow: await s.createTask({
        status: "to-do",
        startDate: new Date(`${day(1)}T00:00:00Z`),
      }),
    };
    await s.configure({
      autoCloseEnabled: true,
      autoCloseMonths: 3,
      autoCloseColumnId: s.wontDo.id,
    });

    const outcome = await s.run(now);
    expect(outcome).toMatchObject({ closed: 4, archived: 0, degraded: false });
    const moved = [t.todo, t.started, t.planned, t.pastDue];
    for (const [index, task] of moved.entries()) {
      expect(await taskRow(task.id)).toMatchObject({
        status: "wont-do",
        columnId: s.wontDo.id,
        completedAt: null,
        archivedAt: null,
        position: 8 + index,
      });
    }
    for (const task of [t.done, t.dueNextWeek, t.startsTomorrow]) {
      expect((await taskRow(task.id)).status).toBe(task.status);
    }

    const history = await activities(moved.map((task) => task.id));
    expect(history).toHaveLength(4);
    expect(history.find((row) => row.taskId === t.started.id)).toMatchObject({
      type: "status_changed",
      userId: null,
      eventData: {
        oldStatus: "in-progress",
        newStatus: "wont-do",
        automation: { rule: "auto_close", months: 3 },
      },
    });
    expect(
      publishedEvents("task.automation_applied").map((e) => e.data),
    ).toEqual([
      expect.objectContaining({
        projectId: web,
        rule: "auto_close",
        count: 4,
        months: 3,
        columnId: s.wontDo.id,
        taskIds: moved.map((task) => task.id),
      }),
    ]);
    expect(publishedEvents("task.status_changed")).toEqual([]);
    expect(await automationRow(web)).toMatchObject({
      lastClosedAt: now,
      lastClosedCount: 4,
    });

    // Closed work is archived only after the archive months pass again:
    // only the old done task goes.
    await s.configure({ autoArchiveEnabled: true });
    expect(await s.run(now)).toMatchObject({ archived: 1, closed: 0 });
    expect((await taskRow(t.done.id)).archivedAt).not.toBeNull();
    for (const task of moved) {
      expect((await taskRow(task.id)).archivedAt).toBeNull();
    }
  });

  it("changes nothing while paused", async () => {
    const s = await automationScene();
    const task = await s.createTask({ status: "to-do" });
    await s.configure({ autoCloseEnabled: true, autoCloseColumnId: null });
    await s.run();
    await s.configure({ autoCloseColumnId: s.web.columns.done.id });
    await s.run();
    expect((await taskRow(task.id)).status).toBe("to-do");
    const rows = await db
      .select({ id: schema.taskTable.id })
      .from(schema.taskTable)
      .where(
        and(
          eq(schema.taskTable.projectId, s.web.project.id),
          eq(schema.taskTable.status, "wont-do"),
        ),
      )
      .orderBy(asc(schema.taskTable.id));
    expect(rows).toEqual([]);
    expect(
      (await automationRow(s.web.project.id))?.lastCheckedAt,
    ).not.toBeNull();
  });
});
