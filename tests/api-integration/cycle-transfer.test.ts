import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { type CycleJson, cycleContext, day, json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";

type TransferJson = {
  sourceCycleId: string;
  targetCycleId: string;
  movedTaskIds: string[];
  isFrozen: boolean;
};

async function transferFixture() {
  const ctx = await cycleContext();
  await db.insert(schema.columnTable).values({
    projectId: ctx.project.id,
    name: "Cancelled",
    slug: "cancelled",
    group: "cancelled",
    isFinal: true,
    position: 4,
  });
  const source = await ctx.insertCycle({
    name: "Sprint 1",
    startDate: day(-10),
    endDate: day(-1),
  });
  const target = await ctx.insertCycle({
    name: "Sprint 2",
    startDate: day(1),
    endDate: day(10),
  });
  const tasks = {
    planned: await ctx.createTask({ status: "planned" }),
    todo: await ctx.createTask({ status: "to-do" }),
    started: await ctx.createTask({ status: "in-progress" }),
    done: await ctx.createTask({
      status: "done",
      completedAt: new Date(`${day(-3)}T12:00:00Z`),
    }),
    cancelled: await ctx.createTask({ status: "cancelled" }),
    archived: await ctx.createTask({ archivedAt: new Date() }),
  };
  await ctx.addToCycle(
    source.id,
    Object.values(tasks).map((task) => task.id),
  );

  const transfer = (cycleId: string, targetCycleId: string) =>
    ctx.app.request(
      `/api/cycle/${cycleId}/transfer`,
      json("POST", { targetCycleId }),
    );
  const getCycle = async (id: string) =>
    (await (await ctx.app.request(`/api/cycle/${id}`)).json()) as CycleJson;

  return { ...ctx, source, target, tasks, transfer, getCycle };
}

describe("API integration: cycle transfer", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("validates the source and the target", async () => {
    const ctx = await transferFixture();
    const { transfer, source, target, insertCycle } = ctx;

    const notCompleted = await transfer(target.id, source.id);
    expect(notCompleted.status).toBe(409);
    expect(await notCompleted.text()).toBe(
      "Only completed cycles can transfer tasks",
    );

    const itself = await transfer(source.id, source.id);
    expect(itself.status).toBe(400);

    const completedTarget = await insertCycle({
      startDate: day(-30),
      endDate: day(-20),
    });
    const toCompleted = await transfer(source.id, completedTarget.id);
    expect(toCompleted.status).toBe(409);
    expect(await toCompleted.text()).toBe(
      "Tasks can only move to an active, upcoming or draft cycle",
    );

    const archivedTarget = await insertCycle({ archivedAt: new Date() });
    expect((await transfer(source.id, archivedTarget.id)).status).toBe(409);

    const unknown = await transfer(source.id, "unknown-cycle");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe("Target cycle not found");

    const other = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      slug: "other",
    });
    const [otherCycle] = await db
      .insert(schema.cycleTable)
      .values({ projectId: other.project.id, name: "Elsewhere" })
      .returning();
    const crossProject = await transfer(source.id, otherCycle?.id ?? "");
    expect(crossProject.status).toBe(404);

    const archivedSource = await insertCycle({
      startDate: day(-50),
      endDate: day(-40),
      archivedAt: new Date(),
    });
    expect((await transfer(archivedSource.id, target.id)).status).toBe(409);

    // Nothing moved and nothing froze.
    expect((await ctx.getCycle(source.id)).isFrozen).toBe(false);
  });

  it("moves unfinished tasks and freezes the source report first", async () => {
    const ctx = await transferFixture();
    const { transfer, source, target, tasks, getCycle, membership } = ctx;

    const before = await getCycle(source.id);
    expect(before.counts).toEqual({
      total: 5,
      backlog: 1,
      unstarted: 1,
      started: 1,
      completed: 1,
      cancelled: 1,
    });
    expect(before.progress).toBe(25);

    const response = await transfer(source.id, target.id);
    expect(response.status).toBe(200);
    const result = (await response.json()) as TransferJson;
    expect(result).toMatchObject({
      sourceCycleId: source.id,
      targetCycleId: target.id,
      isFrozen: true,
    });
    expect([...result.movedTaskIds].sort()).toEqual(
      [tasks.planned.id, tasks.todo.id, tasks.started.id].sort(),
    );

    for (const moved of [tasks.planned, tasks.todo, tasks.started]) {
      expect(await membership(moved.id)).toBe(target.id);
    }
    for (const kept of [tasks.done, tasks.cancelled, tasks.archived]) {
      expect(await membership(kept.id)).toBe(source.id);
    }

    // The source keeps its pre-transfer numbers everywhere.
    const after = await getCycle(source.id);
    expect(after).toMatchObject({
      isFrozen: true,
      counts: before.counts,
      pending: 3,
      progress: 25,
    });
    const listed = (
      (await (
        await ctx.app.request(
          `/api/cycle/project/${ctx.project.id}?view=completed`,
        )
      ).json()) as CycleJson[]
    ).find((cycle) => cycle.id === source.id);
    expect(listed?.counts).toEqual(before.counts);

    const progress = await (
      await ctx.app.request(`/api/cycle/${source.id}/progress`)
    ).json();
    expect(progress).toMatchObject({
      cycleId: source.id,
      isFrozen: true,
      frozenAt: expect.any(String),
      counts: before.counts,
      pending: 3,
      progress: 25,
    });

    expect((await getCycle(target.id)).counts).toMatchObject({
      total: 3,
      backlog: 1,
      unstarted: 1,
      started: 1,
    });
  });

  it("keeps the first snapshot on a later transfer", async () => {
    const ctx = await transferFixture();
    const { transfer, source, target } = ctx;
    await transfer(source.id, target.id);
    const first = await (
      await ctx.app.request(`/api/cycle/${source.id}/progress`)
    ).json();

    // Work that sneaks back into the finished cycle moves out again.
    const straggler = await ctx.createTask();
    await ctx.addToCycle(source.id, [straggler.id]);
    const again = (await (
      await transfer(source.id, target.id)
    ).json()) as TransferJson;
    expect(again.movedTaskIds).toEqual([straggler.id]);

    const second = await (
      await ctx.app.request(`/api/cycle/${source.id}/progress`)
    ).json();
    expect(second).toEqual(first);
  });

  it("freezes even when nothing is pending", async () => {
    const ctx = await cycleContext();
    const finished = await ctx.insertCycle({
      startDate: day(-10),
      endDate: day(-1),
    });
    const next = await ctx.insertCycle({ name: "Draft" });
    const done = await ctx.createTask({ status: "done" });
    await ctx.addToCycle(finished.id, [done.id]);

    const response = await ctx.app.request(
      `/api/cycle/${finished.id}/transfer`,
      json("POST", { targetCycleId: next.id }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      movedTaskIds: [],
      isFrozen: true,
    });
    const cycle = (await (
      await ctx.app.request(`/api/cycle/${finished.id}`)
    ).json()) as CycleJson;
    expect(cycle).toMatchObject({ isFrozen: true, progress: 100 });
  });
});
