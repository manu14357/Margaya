import { beforeEach, describe, expect, it } from "vitest";
import { cycleContext, day, json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";

const FEATURE_OFF = "The Cycles feature is turned off for this project.";

async function gatedFixture() {
  const ctx = await cycleContext("owner");
  const cycle = await ctx.createCycle({ name: "Sprint" });
  const done = await ctx.insertCycle({
    name: "Done",
    startDate: day(-10),
    endDate: day(-1),
  });
  const task = await ctx.createTask();
  await ctx.addToCycle(cycle.id, [task.id]);

  const setFeature = async (cyclesEnabled: boolean) => {
    const response = await ctx.app.request(
      `/api/project/${ctx.project.id}/features`,
      json("PATCH", { cyclesEnabled }),
    );
    expect(response.status).toBe(200);
  };

  const routes: Array<[string, string, RequestInit | undefined]> = [
    ["listCycles", `/api/cycle/project/${ctx.project.id}`, undefined],
    [
      "createCycle",
      `/api/cycle/project/${ctx.project.id}`,
      json("POST", { name: "New" }),
    ],
    ["getCycle", `/api/cycle/${cycle.id}`, undefined],
    ["updateCycle", `/api/cycle/${cycle.id}`, json("PUT", { name: "X" })],
    ["deleteCycle", `/api/cycle/${cycle.id}`, { method: "DELETE" }],
    ["archiveCycle", `/api/cycle/${done.id}/archive`, { method: "POST" }],
    ["unarchiveCycle", `/api/cycle/${done.id}/unarchive`, { method: "POST" }],
    [
      "addCycleTasks",
      `/api/cycle/${cycle.id}/tasks`,
      json("POST", { taskIds: [task.id] }),
    ],
    [
      "removeCycleTasks",
      `/api/cycle/${cycle.id}/tasks`,
      json("DELETE", { taskIds: [task.id] }),
    ],
    [
      "setTaskCycle",
      `/api/cycle/task/${task.id}`,
      json("PUT", { cycleId: null }),
    ],
    [
      "transferCycleTasks",
      `/api/cycle/${done.id}/transfer`,
      json("POST", { targetCycleId: cycle.id }),
    ],
    ["getCycleProgress", `/api/cycle/${cycle.id}/progress`, undefined],
  ];

  return { ...ctx, cycle, task, setFeature, routes };
}

describe("API integration: cycles feature gate", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("answers 403 on every route, reads included, while the feature is off", async () => {
    const { app, routes, setFeature } = await gatedFixture();
    await setFeature(false);

    expect(routes).toHaveLength(12);
    for (const [name, path, init] of routes) {
      const response = await app.request(path, init);
      expect(response.status, name).toBe(403);
      expect(await response.text(), name).toBe(FEATURE_OFF);
    }
  });

  it("keeps the data and restores access when turned back on", async () => {
    const { app, cycle, task, setFeature, membership } = await gatedFixture();
    await setFeature(false);
    await setFeature(true);

    const response = await app.request(`/api/cycle/${cycle.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: cycle.id,
      counts: { total: 1 },
    });
    expect(await membership(task.id)).toBe(cycle.id);
  });

  it("turns cycles on for new projects", async () => {
    const { app, workspace } = await cycleContext("owner");
    const created = await app.request(
      "/api/project",
      json("POST", {
        name: "Fresh",
        workspaceId: workspace.id,
        icon: "Layout",
        slug: "fresh",
      }),
    );
    const project = (await created.json()) as {
      id: string;
      cyclesEnabled: boolean;
    };
    expect(project.cyclesEnabled).toBe(true);
    const list = await app.request(`/api/cycle/project/${project.id}`);
    expect(list.status).toBe(200);
  });
});
