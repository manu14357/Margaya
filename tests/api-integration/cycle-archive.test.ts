import { beforeEach, describe, expect, it } from "vitest";
import { type CycleJson, cycleContext, day, json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";

describe("API integration: cycle archive", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("archives completed cycles only", async () => {
    const { app, createCycle, insertCycle } = await cycleContext();
    const current = await createCycle({
      name: "Now",
      startDate: day(-1),
      endDate: day(1),
    });
    const upcoming = await createCycle({
      name: "Next",
      startDate: day(5),
      endDate: day(9),
    });
    const draft = await createCycle({ name: "Draft" });
    const archive = (id: string) =>
      app.request(`/api/cycle/${id}/archive`, { method: "POST" });

    for (const cycle of [current, upcoming, draft]) {
      const response = await archive(cycle.id);
      expect(response.status, cycle.name).toBe(409);
      expect(await response.text()).toBe(
        "Only completed cycles can be archived",
      );
    }

    const done = await insertCycle({
      name: "Done",
      startDate: day(-10),
      endDate: day(-2),
    });
    const archived = await archive(done.id);
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({
      id: done.id,
      status: "completed",
      archivedAt: expect.any(String),
    });

    const twice = await archive(done.id);
    expect(twice.status).toBe(409);
  });

  it("moves archived cycles between the default and archived views", async () => {
    const { app, list, insertCycle } = await cycleContext();
    const done = await insertCycle({
      name: "Done",
      startDate: day(-10),
      endDate: day(-2),
    });
    const ids = (cycles: CycleJson[]) => cycles.map((cycle) => cycle.id);

    const notArchived = await app.request(`/api/cycle/${done.id}/unarchive`, {
      method: "POST",
    });
    expect(notArchived.status).toBe(409);

    await app.request(`/api/cycle/${done.id}/archive`, { method: "POST" });
    expect(ids(await list())).toEqual([]);
    expect(ids(await list("?view=completed"))).toEqual([]);
    expect(ids(await list("?view=archived"))).toEqual([done.id]);

    const restored = await app.request(`/api/cycle/${done.id}/unarchive`, {
      method: "POST",
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ archivedAt: null });
    expect(ids(await list())).toEqual([done.id]);
    expect(ids(await list("?view=archived"))).toEqual([]);
  });

  it("hides favorites of archived cycles until they are restored", async () => {
    const { app, workspace, insertCycle } = await cycleContext();
    const done = await insertCycle({
      name: "Done",
      startDate: day(-10),
      endDate: day(-2),
    });
    const favorite = await app.request(
      "/api/favorite",
      json("POST", {
        workspaceId: workspace.id,
        entityType: "cycle",
        entityId: done.id,
      }),
    );
    expect(favorite.status).toBe(200);
    expect(await favorite.json()).toMatchObject({
      entityType: "cycle",
      entity: {
        type: "cycle",
        name: "Done",
        icon: "IterationCw",
        feature: "cycles",
        isArchived: false,
        details: { status: "completed" },
      },
    });

    const favorites = async () =>
      (
        (await (
          await app.request(`/api/favorite?workspaceId=${workspace.id}`)
        ).json()) as Array<{ entityId: string }>
      ).map((row) => row.entityId);

    await app.request(`/api/cycle/${done.id}/archive`, { method: "POST" });
    expect(await favorites()).toEqual([]);

    await app.request(`/api/cycle/${done.id}/unarchive`, { method: "POST" });
    expect(await favorites()).toEqual([done.id]);
  });
});
