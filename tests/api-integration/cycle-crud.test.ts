import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { mockAuthenticatedSession } from "./helpers/auth";
import { type CycleJson, cycleContext, day, json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import { addWorkspaceMember, createWorkspaceMember } from "./helpers/fixtures";

const events: Array<{ type: string; data: Record<string, unknown> }> = [];
for (const type of [
  "cycle.created",
  "cycle.updated",
  "cycle.deleted",
  "task.cycle_changed",
]) {
  await subscribeToEvent<Record<string, unknown>>(type, async (data) => {
    events.push({ type, data });
  });
}

describe("API integration: cycle CRUD", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    events.length = 0;
  });

  it("creates dated cycles and drafts owned by the caller", async () => {
    const { createCycle, user, project } = await cycleContext();

    const dated = await createCycle({
      name: "  Sprint 1  ",
      description: "Ship it",
      startDate: day(-1),
      endDate: day(12),
    });
    expect(dated).toMatchObject({
      projectId: project.id,
      name: "Sprint 1",
      description: "Ship it",
      startDate: day(-1),
      endDate: day(12),
      ownerId: user.id,
      owner: { id: user.id, name: user.name },
      status: "current",
      today: day(0),
      archivedAt: null,
      isFrozen: false,
      counts: { total: 0, completed: 0, cancelled: 0 },
      pending: 0,
      progress: 0,
    });

    const draft = await createCycle({ name: "Later" });
    expect(draft).toMatchObject({
      status: "draft",
      startDate: null,
      endDate: null,
      description: "",
    });

    expect(events).toContainEqual({
      type: "cycle.created",
      data: expect.objectContaining({
        cycleId: dated.id,
        projectId: project.id,
        userId: user.id,
        name: "Sprint 1",
      }),
    });
  });

  it.each([
    [{ name: "" }, "name"],
    [{ name: "   " }, "name"],
    [{ name: "x".repeat(256) }, "name"],
    [{ name: "A", description: "x".repeat(10_001) }, "description"],
    [
      { name: "A", startDate: "2026-02-30", endDate: "2026-03-02" },
      "startDate",
    ],
    [{ name: "A", startDate: "2026-3-01", endDate: "2026-03-02" }, "startDate"],
  ])("rejects invalid input %#", async (body, field) => {
    const { app, project } = await cycleContext();
    const response = await app.request(
      `/api/cycle/project/${project.id}`,
      json("POST", body),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain(field);
  });

  it("enforces the date rules", async () => {
    const { app, project, createCycle } = await cycleContext();
    const post = (body: Record<string, unknown>) =>
      app.request(`/api/cycle/project/${project.id}`, json("POST", body));

    const oneDate = await post({ name: "A", startDate: day(1) });
    expect(oneDate.status).toBe(400);
    expect(await oneDate.text()).toBe("Send startDate and endDate together");

    const oneNull = await post({ name: "A", startDate: day(1), endDate: null });
    expect(oneNull.status).toBe(400);

    const reversed = await post({
      name: "A",
      startDate: day(5),
      endDate: day(4),
    });
    expect(reversed.status).toBe(400);
    expect(await reversed.text()).toBe(
      "Start date can't be after the end date",
    );

    const tooLong = await post({
      name: "A",
      startDate: day(100),
      endDate: day(466),
    });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.text()).toBe("A cycle can span at most 366 days");

    // 366 inclusive days is the longest allowed range.
    const longest = await createCycle({
      name: "Year",
      startDate: day(100),
      endDate: day(465),
    });
    expect(longest.status).toBe("upcoming");
  });

  it("refuses overlapping dated cycles, archived ones included", async () => {
    const { app, project, createCycle, insertCycle } = await cycleContext();
    await createCycle({ name: "A", startDate: day(10), endDate: day(20) });
    await insertCycle({
      name: "Old",
      startDate: day(-30),
      endDate: day(-20),
      archivedAt: new Date(),
    });
    const post = (startDate: string, endDate: string) =>
      app.request(
        `/api/cycle/project/${project.id}`,
        json("POST", { name: "B", startDate, endDate }),
      );

    for (const [start, end] of [
      [day(20), day(25)], // shares the boundary day
      [day(5), day(10)], // shares the first day
      [day(12), day(14)], // contained
      [day(0), day(40)], // contains
      [day(-25), day(-22)], // overlaps the archived cycle
    ] as const) {
      const response = await post(start, end);
      expect(response.status, `${start}..${end}`).toBe(409);
      expect(await response.text()).toBe(
        "Another cycle already covers some of these dates",
      );
    }

    // The day after the end, and drafts, never overlap.
    expect((await post(day(21), day(25))).status).toBe(200);
    expect(
      (
        await app.request(
          `/api/cycle/project/${project.id}`,
          json("POST", { name: "Draft" }),
        )
      ).status,
    ).toBe(200);
  });

  it("only accepts workspace members as owner", async () => {
    const { app, project, workspace, createCycle } = await cycleContext();
    const outsider = await createWorkspaceMember();
    const response = await app.request(
      `/api/cycle/project/${project.id}`,
      json("POST", { name: "A", ownerId: outsider.user.id }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "Owner must be a member of this workspace",
    );

    const colleague = await addWorkspaceMember(workspace.id);
    const owned = await createCycle({ name: "B", ownerId: colleague.id });
    expect(owned.ownerId).toBe(colleague.id);
  });

  it("puts newer cycles first in sort order", async () => {
    const { createCycle } = await cycleContext();
    const first = await createCycle({ name: "First" });
    const second = await createCycle({ name: "Second" });
    expect(first.sortOrder).toBe(65535);
    expect(second.sortOrder).toBe(55535);
  });

  it("derives status and filters, orders and searches the list", async () => {
    const { list, insertCycle } = await cycleContext();
    const completedOld = await insertCycle({
      name: "Old",
      startDate: day(-40),
      endDate: day(-30),
    });
    const completedRecent = await insertCycle({
      name: "Recent",
      startDate: day(-20),
      endDate: day(-1),
    });
    const current = await insertCycle({
      name: "Now",
      startDate: day(0),
      endDate: day(6),
    });
    const upcomingLate = await insertCycle({
      name: "Late 100%",
      startDate: day(30),
      endDate: day(40),
    });
    const upcomingSoon = await insertCycle({
      name: "Soon",
      startDate: day(7),
      endDate: day(20),
    });
    const draftA = await insertCycle({ name: "Draft A", sortOrder: 10 });
    const draftB = await insertCycle({ name: "Draft B", sortOrder: 5 });
    await insertCycle({
      name: "Archived",
      startDate: day(-60),
      endDate: day(-50),
      archivedAt: new Date(),
    });

    const all = await list();
    expect(all.map((cycle) => cycle.id)).toEqual([
      current.id,
      upcomingSoon.id,
      upcomingLate.id,
      draftB.id,
      draftA.id,
      completedRecent.id,
      completedOld.id,
    ]);
    expect(all.map((cycle) => cycle.status)).toEqual([
      "current",
      "upcoming",
      "upcoming",
      "draft",
      "draft",
      "completed",
      "completed",
    ]);

    const ids = (cycles: CycleJson[]) => cycles.map((cycle) => cycle.id);
    expect(ids(await list("?view=current"))).toEqual([current.id]);
    expect(ids(await list("?view=upcoming"))).toEqual([
      upcomingSoon.id,
      upcomingLate.id,
    ]);
    expect(ids(await list("?view=draft"))).toEqual([draftB.id, draftA.id]);
    expect(ids(await list("?view=completed"))).toEqual([
      completedRecent.id,
      completedOld.id,
    ]);
    expect(ids(await list("?view=incomplete"))).toHaveLength(5);
    expect((await list("?view=archived")).map((c) => c.name)).toEqual([
      "Archived",
    ]);

    expect(ids(await list("?search=DRAFT"))).toEqual([draftB.id, draftA.id]);
    // LIKE wildcards in the search are literal.
    expect(ids(await list(`?search=${encodeURIComponent("100%")}`))).toEqual([
      upcomingLate.id,
    ]);
    expect(await list("?search=nothing-matches")).toEqual([]);
  });

  it("gets a single cycle, archived ones included", async () => {
    const { app, insertCycle } = await cycleContext();
    const archived = await insertCycle({
      name: "Archived",
      startDate: day(-10),
      endDate: day(-5),
      archivedAt: new Date(),
    });
    const response = await app.request(`/api/cycle/${archived.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: archived.id,
      status: "completed",
    });

    const missing = await app.request("/api/cycle/unknown-cycle");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Cycle not found");
  });

  describe("updates", () => {
    it("edits upcoming cycles and clears them to drafts", async () => {
      const { app, createCycle, workspace, user } = await cycleContext();
      const cycle = await createCycle({
        name: "Upcoming",
        startDate: day(3),
        endDate: day(10),
      });
      const colleague = await addWorkspaceMember(workspace.id);

      const renamed = await app.request(
        `/api/cycle/${cycle.id}`,
        json("PUT", {
          name: "Renamed",
          description: "New",
          ownerId: colleague.id,
          startDate: day(4),
          endDate: day(11),
        }),
      );
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toMatchObject({
        name: "Renamed",
        description: "New",
        ownerId: colleague.id,
        startDate: day(4),
        endDate: day(11),
      });
      expect(events).toContainEqual({
        type: "cycle.updated",
        data: expect.objectContaining({
          cycleId: cycle.id,
          userId: user.id,
          changes: expect.arrayContaining([
            "name",
            "description",
            "ownerId",
            "startDate",
            "endDate",
          ]),
        }),
      });

      const cleared = await app.request(
        `/api/cycle/${cycle.id}`,
        json("PUT", { startDate: null, endDate: null, ownerId: null }),
      );
      expect(cleared.status).toBe(200);
      expect(await cleared.json()).toMatchObject({
        status: "draft",
        startDate: null,
        endDate: null,
        ownerId: null,
        owner: null,
      });

      const half = await app.request(
        `/api/cycle/${cycle.id}`,
        json("PUT", { startDate: day(3) }),
      );
      expect(half.status).toBe(400);
      expect(await half.text()).toBe("Send startDate and endDate together");
    });

    it("checks overlap on update, excluding the cycle itself", async () => {
      const { app, createCycle } = await cycleContext();
      const first = await createCycle({
        name: "First",
        startDate: day(1),
        endDate: day(5),
      });
      const second = await createCycle({
        name: "Second",
        startDate: day(6),
        endDate: day(9),
      });

      const self = await app.request(
        `/api/cycle/${first.id}`,
        json("PUT", { startDate: day(1), endDate: day(4) }),
      );
      expect(self.status).toBe(200);

      const clash = await app.request(
        `/api/cycle/${second.id}`,
        json("PUT", { startDate: day(4), endDate: day(9) }),
      );
      expect(clash.status).toBe(409);
    });

    it("locks a running cycle's start and keeps its end in the future", async () => {
      const { app, createCycle } = await cycleContext();
      const cycle = await createCycle({
        name: "Now",
        startDate: day(-3),
        endDate: day(3),
      });
      const put = (body: Record<string, unknown>) =>
        app.request(`/api/cycle/${cycle.id}`, json("PUT", body));

      const moveStart = await put({ startDate: day(-2), endDate: day(3) });
      expect(moveStart.status).toBe(409);
      expect(await moveStart.text()).toBe(
        "A running cycle's start date can't change",
      );

      const endInPast = await put({ startDate: day(-3), endDate: day(-1) });
      expect(endInPast.status).toBe(400);
      expect(await endInPast.text()).toBe(
        "A running cycle can't end in the past",
      );

      const clear = await put({ startDate: null, endDate: null });
      expect(clear.status).toBe(409);
      expect(await clear.text()).toBe("A running cycle needs dates");

      const extend = await put({ startDate: day(-3), endDate: day(0) });
      expect(extend.status).toBe(200);
      expect(await extend.json()).toMatchObject({
        endDate: day(0),
        status: "current",
      });
    });

    it("only lets completed cycles change their sort order", async () => {
      const { app, insertCycle } = await cycleContext();
      const cycle = await insertCycle({
        name: "Done",
        startDate: day(-10),
        endDate: day(-1),
      });

      const rename = await app.request(
        `/api/cycle/${cycle.id}`,
        json("PUT", { name: "New name", sortOrder: 1 }),
      );
      expect(rename.status).toBe(409);
      expect(await rename.text()).toBe("Completed cycles can't be edited");

      const reorder = await app.request(
        `/api/cycle/${cycle.id}`,
        json("PUT", { sortOrder: 1 }),
      );
      expect(reorder.status).toBe(200);
      expect(((await reorder.json()) as CycleJson).sortOrder).toBe(1);
    });

    it("refuses edits to archived cycles", async () => {
      const { app, insertCycle } = await cycleContext();
      const cycle = await insertCycle({
        startDate: day(-10),
        endDate: day(-1),
        archivedAt: new Date(),
      });
      const response = await app.request(
        `/api/cycle/${cycle.id}`,
        json("PUT", { sortOrder: 3 }),
      );
      expect(response.status).toBe(409);
      expect(await response.text()).toBe("Restore the cycle before editing it");
    });
  });

  describe("delete", () => {
    it("lets admins and owners delete, but not other members", async () => {
      const { app, workspace, user, createCycle } = await cycleContext();
      const own = await createCycle({ name: "Mine" });

      const other = await addWorkspaceMember(workspace.id, "member");
      mockAuthenticatedSession(other);
      const denied = await app.request(`/api/cycle/${own.id}`, {
        method: "DELETE",
      });
      expect(denied.status).toBe(403);
      expect(await denied.text()).toBe(
        "Only admins or the cycle's owner can delete it",
      );

      mockAuthenticatedSession(user);
      const allowed = await app.request(`/api/cycle/${own.id}`, {
        method: "DELETE",
      });
      expect(allowed.status).toBe(200);

      const theirs = await createCycle({ name: "Theirs", ownerId: other.id });
      const admin = await addWorkspaceMember(workspace.id, "admin");
      mockAuthenticatedSession(admin);
      const byAdmin = await app.request(`/api/cycle/${theirs.id}`, {
        method: "DELETE",
      });
      expect(byAdmin.status).toBe(200);
    });

    it("keeps the tasks, drops memberships, favorites and recents", async () => {
      const {
        app,
        user,
        workspace,
        project,
        createCycle,
        createTask,
        membership,
      } = await cycleContext();
      const cycle = await createCycle({ name: "Doomed" });
      const task = await createTask();
      await app.request(
        `/api/cycle/${cycle.id}/tasks`,
        json("POST", { taskIds: [task.id] }),
      );
      const favorite = await app.request(
        "/api/favorite",
        json("POST", {
          workspaceId: workspace.id,
          entityType: "cycle",
          entityId: cycle.id,
        }),
      );
      expect(favorite.status).toBe(200);
      const visit = await app.request(
        "/api/recent-visit",
        json("POST", {
          workspaceId: workspace.id,
          entityType: "cycle",
          entityId: cycle.id,
        }),
      );
      expect(visit.status).toBe(200);
      events.length = 0;

      const response = await app.request(`/api/cycle/${cycle.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: cycle.id,
        projectId: project.id,
        removedTaskIds: [task.id],
      });

      expect(
        await db.query.taskTable.findFirst({
          where: eq(schema.taskTable.id, task.id),
        }),
      ).toBeDefined();
      expect(await membership(task.id)).toBeNull();
      expect(
        await db
          .select()
          .from(schema.favoriteTable)
          .where(eq(schema.favoriteTable.entityId, cycle.id)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(schema.recentVisitTable)
          .where(eq(schema.recentVisitTable.entityId, cycle.id)),
      ).toEqual([]);

      const activity = await db
        .select()
        .from(schema.activityTable)
        .where(
          and(
            eq(schema.activityTable.taskId, task.id),
            eq(schema.activityTable.type, "cycle_changed"),
          ),
        )
        .orderBy(schema.activityTable.createdAt);
      expect(activity.map((row) => row.eventData)).toEqual([
        expect.objectContaining({ newCycleId: cycle.id }),
        {
          oldCycleId: cycle.id,
          oldCycleName: "Doomed",
          newCycleId: null,
          newCycleName: null,
          reason: "cycle_deleted",
        },
      ]);

      expect(events).toEqual(
        expect.arrayContaining([
          {
            type: "cycle.deleted",
            data: expect.objectContaining({
              cycleId: cycle.id,
              projectId: project.id,
              userId: user.id,
              name: "Doomed",
              taskIds: [task.id],
            }),
          },
          {
            type: "task.cycle_changed",
            data: expect.objectContaining({
              taskId: task.id,
              oldCycleId: cycle.id,
              newCycleId: null,
              reason: "cycle_deleted",
            }),
          },
        ]),
      );

      const missing = await app.request(`/api/cycle/${cycle.id}`);
      expect(missing.status).toBe(404);
    });
  });
});
