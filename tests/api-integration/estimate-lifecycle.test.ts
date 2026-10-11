import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  type EstimateJson,
  estimateActivities,
  estimateContext,
  expectEstimateInvariant,
  json,
} from "./helpers/estimates";

type ActivateJson = {
  estimate: EstimateJson;
  previousEstimateId: string | null;
  remappedTaskCount: number;
  clearedTaskCount: number;
};

type PointDeleteJson = {
  estimate: EstimateJson;
  movedTaskCount: number;
  clearedTaskCount: number;
};

function pointIdOf(estimate: EstimateJson, value: string) {
  const point = estimate.points.find((candidate) => candidate.value === value);
  if (!point) throw new Error(`no value ${value}`);
  return point.id;
}

async function sizesAndPoints() {
  const ctx = await estimateContext();
  const sizes = await ctx.createSystem({
    name: "T-shirt sizes",
    type: "categories",
    values: ["S", "M", "L", "XL"],
  });
  const points = await ctx.createSystem({
    name: "Fibonacci",
    type: "points",
    values: ["1", "2", "3", "5", "8"],
  });
  return { ...ctx, sizes, points };
}

async function activeSystems(projectId: string) {
  const rows = await db
    .select({
      id: schema.estimateTable.id,
      isActive: schema.estimateTable.isActive,
    })
    .from(schema.estimateTable)
    .where(eq(schema.estimateTable.projectId, projectId));
  return rows.filter((row) => row.isActive);
}

describe("API integration: estimate lifecycle", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("refuses to delete a value in use without a choice, changing nothing", async () => {
    const ctx = await sizesAndPoints();
    const m = pointIdOf(ctx.sizes, "M");
    const a = await ctx.createTask();
    const b = await ctx.createTask({ archivedAt: new Date() });
    await ctx.assignPoint([a.id, b.id], m);

    const response = await ctx.request(
      `/${ctx.project.id}/${ctx.sizes.id}/points/${m}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message:
        "Tasks use this estimate value; choose a replacement or clear their estimate",
      taskCount: 2,
    });
    const [listed] = (await ctx.list()).estimates;
    expect(listed?.points).toHaveLength(4);
    expect(await ctx.pointOf(a.id)).toBe(m);
    expect(await estimateActivities(a.id)).toEqual([]);
  });

  it("moves the tasks of a deleted value to its replacement", async () => {
    const ctx = await sizesAndPoints();
    const [s, m, l, xl] = ["S", "M", "L", "XL"].map((value) =>
      pointIdOf(ctx.sizes, value),
    ) as [string, string, string, string];
    const a = await ctx.createTask();
    const b = await ctx.createTask({ status: "done" });
    const untouched = await ctx.createTask();
    await ctx.assignPoint([a.id, b.id], m);
    await ctx.assignPoint([untouched.id], s);

    const result = await ctx.ok<PointDeleteJson>(
      `/${ctx.project.id}/${ctx.sizes.id}/points/${m}?replacementPointId=${xl}`,
      { method: "DELETE" },
    );
    expect(result).toMatchObject({ movedTaskCount: 2, clearedTaskCount: 0 });
    expect(
      result.estimate.points.map((point) => [point.id, point.position]),
    ).toEqual([
      [s, 1],
      [l, 2],
      [xl, 3],
    ]);
    expect(
      result.estimate.points.find((point) => point.id === xl)?.taskCount,
    ).toBe(2);

    for (const task of [a, b]) {
      expect(await ctx.pointOf(task.id)).toBe(xl);
      expect(await estimateActivities(task.id)).toEqual([
        {
          type: "estimate_changed",
          userId: ctx.user.id,
          content: null,
          eventData: {
            oldPointId: m,
            newPointId: xl,
            oldValue: "M",
            newValue: "XL",
            oldType: "categories",
            newType: "categories",
            reason: "point_deleted",
          },
        },
      ]);
    }
    expect(await ctx.pointOf(untouched.id)).toBe(s);
    expect(await estimateActivities(untouched.id)).toEqual([]);
    await expectEstimateInvariant();
  });

  it("clears the tasks of a deleted value on request", async () => {
    const ctx = await sizesAndPoints();
    const l = pointIdOf(ctx.sizes, "L");
    const task = await ctx.createTask();
    await ctx.assignPoint([task.id], l);

    const result = await ctx.ok<PointDeleteJson>(
      `/${ctx.project.id}/${ctx.sizes.id}/points/${l}?clear=true`,
      { method: "DELETE" },
    );
    expect(result).toMatchObject({ movedTaskCount: 0, clearedTaskCount: 1 });
    expect(await ctx.pointOf(task.id)).toBeNull();
    expect((await estimateActivities(task.id))[0]?.eventData).toMatchObject({
      oldValue: "L",
      newValue: null,
      reason: "point_deleted",
    });

    // A value nobody uses goes without a choice.
    const s = pointIdOf(ctx.sizes, "S");
    const unused = await ctx.ok<PointDeleteJson>(
      `/${ctx.project.id}/${ctx.sizes.id}/points/${s}`,
      { method: "DELETE" },
    );
    expect(unused.estimate.points.map((point) => point.value)).toEqual([
      "M",
      "XL",
    ]);
    await expectEstimateInvariant();
  });

  it("validates the replacement before writing anything", async () => {
    const ctx = await sizesAndPoints();
    const m = pointIdOf(ctx.sizes, "M");
    const task = await ctx.createTask();
    await ctx.assignPoint([task.id], m);
    const base = `/${ctx.project.id}/${ctx.sizes.id}/points/${m}`;

    for (const query of [
      `?replacementPointId=${pointIdOf(ctx.points, "5")}`,
      `?replacementPointId=${m}`,
      `?replacementPointId=${pointIdOf(ctx.sizes, "L")}&clear=true`,
    ]) {
      const response = await ctx.request(`${base}${query}`, {
        method: "DELETE",
      });
      expect(response.status, query).toBe(400);
    }
    const [listed] = (await ctx.list()).estimates;
    expect(listed?.points).toHaveLength(4);
    expect(await ctx.pointOf(task.id)).toBe(m);
    expect(await estimateActivities(task.id)).toEqual([]);
  });

  it("keeps at least 2 values", async () => {
    const ctx = await estimateContext();
    const system = await ctx.createSystem({
      name: "Pair",
      type: "points",
      values: ["1", "2"],
    });
    const response = await ctx.request(
      `/${ctx.project.id}/${system.id}/points/${system.points[0]?.id}?clear=true`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      "An estimate system needs at least 2 values",
    );
  });

  it("switches systems, moving tasks as mapped and clearing the rest", async () => {
    const ctx = await sizesAndPoints();
    const [s, m, l] = ["S", "M", "L"].map((value) =>
      pointIdOf(ctx.sizes, value),
    ) as [string, string, string];
    const [one, five] = ["1", "5"].map((value) =>
      pointIdOf(ctx.points, value),
    ) as [string, string];
    const small = await ctx.createTask();
    const medium = await ctx.createTask();
    const large = await ctx.createTask({ archivedAt: new Date() });
    const none = await ctx.createTask();
    await ctx.assignPoint([small.id], s);
    await ctx.assignPoint([medium.id], m);
    await ctx.assignPoint([large.id], l);

    const result = await ctx.ok<ActivateJson>(
      `/${ctx.project.id}/${ctx.points.id}/activate`,
      json("POST", {
        mapping: [
          { fromPointId: s, toPointId: one },
          { fromPointId: m, toPointId: five },
          // Mapping a value with no tasks is accepted and changes nothing.
          { fromPointId: pointIdOf(ctx.sizes, "XL"), toPointId: five },
        ],
      }),
    );
    expect(result).toMatchObject({
      estimate: { id: ctx.points.id, isActive: true },
      previousEstimateId: ctx.sizes.id,
      remappedTaskCount: 2,
      clearedTaskCount: 1,
    });
    expect(await ctx.pointOf(small.id)).toBe(one);
    expect(await ctx.pointOf(medium.id)).toBe(five);
    expect(await ctx.pointOf(large.id)).toBeNull();
    expect(await ctx.pointOf(none.id)).toBeNull();

    expect((await estimateActivities(medium.id))[0]?.eventData).toEqual({
      oldPointId: m,
      newPointId: five,
      oldValue: "M",
      newValue: "5",
      oldType: "categories",
      newType: "points",
      reason: "system_switched",
    });
    expect((await estimateActivities(large.id))[0]?.eventData).toEqual({
      oldPointId: l,
      newPointId: null,
      oldValue: "L",
      newValue: null,
      oldType: "categories",
      newType: null,
      reason: "system_switched",
    });
    expect(await estimateActivities(none.id)).toEqual([]);

    const listed = await ctx.list();
    expect(listed.activeEstimateId).toBe(ctx.points.id);
    expect(
      listed.estimates.find((estimate) => estimate.id === ctx.sizes.id)
        ?.isActive,
    ).toBe(false);
    await expectEstimateInvariant();

    // Switching back is possible; the old system kept its values.
    const back = await ctx.ok<ActivateJson>(
      `/${ctx.project.id}/${ctx.sizes.id}/activate`,
      json("POST", { mapping: [] }),
    );
    expect(back).toMatchObject({
      previousEstimateId: ctx.points.id,
      remappedTaskCount: 0,
      clearedTaskCount: 2,
    });
    await expectEstimateInvariant();
  });

  it("refuses a bad mapping without changing anything, and ignores a no-op", async () => {
    const ctx = await sizesAndPoints();
    const s = pointIdOf(ctx.sizes, "S");
    const one = pointIdOf(ctx.points, "1");
    const task = await ctx.createTask();
    await ctx.assignPoint([task.id], s);
    const path = `/${ctx.project.id}/${ctx.points.id}/activate`;

    for (const mapping of [
      [{ fromPointId: one, toPointId: one }],
      [{ fromPointId: s, toPointId: s }],
      [{ fromPointId: s, toPointId: "unknown" }],
      [
        { fromPointId: s, toPointId: one },
        { fromPointId: s, toPointId: null },
      ],
    ]) {
      const response = await ctx.request(path, json("POST", { mapping }));
      expect(response.status, JSON.stringify(mapping)).toBe(400);
    }
    expect((await ctx.list()).activeEstimateId).toBe(ctx.sizes.id);
    expect(await ctx.pointOf(task.id)).toBe(s);
    expect(await estimateActivities(task.id)).toEqual([]);

    const noop = await ctx.ok<ActivateJson>(
      `/${ctx.project.id}/${ctx.sizes.id}/activate`,
      json("POST", { mapping: [{ fromPointId: s, toPointId: null }] }),
    );
    expect(noop).toMatchObject({
      previousEstimateId: ctx.sizes.id,
      remappedTaskCount: 0,
      clearedTaskCount: 0,
    });
    expect(await ctx.pointOf(task.id)).toBe(s);
  });

  it("serializes concurrent switches, never leaving two active systems", async () => {
    const ctx = await sizesAndPoints();
    const time = await ctx.createSystem({
      name: "Hours",
      type: "time",
      values: ["60", "120"],
    });
    const task = await ctx.createTask();
    await ctx.assignPoint([task.id], pointIdOf(ctx.sizes, "S"));

    const responses = await Promise.all(
      [ctx.points.id, time.id].map((estimateId) =>
        ctx.request(
          `/${ctx.project.id}/${estimateId}/activate`,
          json("POST", { mapping: [] }),
        ),
      ),
    );
    for (const response of responses) {
      expect([200, 409]).toContain(response.status);
    }
    expect(responses.some((response) => response.status === 200)).toBe(true);
    expect(await activeSystems(ctx.project.id)).toHaveLength(1);
    expect(await ctx.pointOf(task.id)).toBeNull();
    // The task was cleared exactly once, by whichever switch ran first.
    expect(await estimateActivities(task.id)).toHaveLength(1);
    await expectEstimateInvariant();
  });

  it("activates without a mapping when no system is active", async () => {
    const ctx = await sizesAndPoints();
    await ctx.ok(`/${ctx.project.id}/${ctx.sizes.id}`, { method: "DELETE" });
    expect((await ctx.list()).activeEstimateId).toBeNull();

    const refused = await ctx.request(
      `/${ctx.project.id}/${ctx.points.id}/activate`,
      json("POST", {
        mapping: [{ fromPointId: "anything", toPointId: null }],
      }),
    );
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe("Nothing to map");

    const activated = await ctx.ok<ActivateJson>(
      `/${ctx.project.id}/${ctx.points.id}/activate`,
      json("POST", { mapping: [] }),
    );
    expect(activated).toMatchObject({
      previousEstimateId: null,
      estimate: { isActive: true },
    });
  });

  it("deletes the active system, clearing its tasks and promoting nothing", async () => {
    const ctx = await sizesAndPoints();
    const m = pointIdOf(ctx.sizes, "M");
    const a = await ctx.createTask();
    const b = await ctx.createTask({ status: "planned" });
    await ctx.assignPoint([a.id, b.id], m);

    const result = await ctx.ok<{
      deletedEstimateId: string;
      clearedTaskCount: number;
    }>(`/${ctx.project.id}/${ctx.sizes.id}`, { method: "DELETE" });
    expect(result).toEqual({
      deletedEstimateId: ctx.sizes.id,
      clearedTaskCount: 2,
    });
    expect(await ctx.pointOf(a.id)).toBeNull();
    expect((await estimateActivities(b.id))[0]?.eventData).toEqual({
      oldPointId: m,
      newPointId: null,
      oldValue: "M",
      newValue: null,
      oldType: "categories",
      newType: null,
      reason: "system_deleted",
    });

    const points = await db
      .select()
      .from(schema.estimatePointTable)
      .where(eq(schema.estimatePointTable.estimateId, ctx.sizes.id));
    expect(points).toEqual([]);
    const listed = await ctx.list();
    expect(listed.activeEstimateId).toBeNull();
    expect(listed.estimates.map((estimate) => estimate.id)).toEqual([
      ctx.points.id,
    ]);

    // Deleting an inactive system touches no task.
    const other = await ctx.createSystem({
      name: "Spare",
      type: "points",
      values: ["1", "2"],
    });
    const task = await ctx.createTask();
    await ctx.ok(
      `/${ctx.project.id}/${ctx.points.id}/activate`,
      json("POST", { mapping: [] }),
    );
    await ctx.assignPoint([task.id], pointIdOf(ctx.points, "3"));
    const spare = await ctx.ok<{ clearedTaskCount: number }>(
      `/${ctx.project.id}/${other.id}`,
      { method: "DELETE" },
    );
    expect(spare.clearedTaskCount).toBe(0);
    expect(await ctx.pointOf(task.id)).toBe(pointIdOf(ctx.points, "3"));
    await expectEstimateInvariant();
  });

  it("removes estimates with their project", async () => {
    const ctx = await sizesAndPoints();
    await db
      .delete(schema.projectTable)
      .where(eq(schema.projectTable.id, ctx.project.id));
    expect(await db.select().from(schema.estimateTable)).toEqual([]);
    expect(await db.select().from(schema.estimatePointTable)).toEqual([]);
  });
});
