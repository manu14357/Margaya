import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "./helpers/database";
import {
  ESTIMATES_OFF,
  type EstimateJson,
  estimateContext,
  estimateRowCounts,
  FIBONACCI,
  json,
  setEstimatesEnabled,
} from "./helpers/estimates";
import { createProjectFixture } from "./helpers/fixtures";

const values = (estimate: EstimateJson) =>
  estimate.points.map((point) => point.value);

describe("API integration: estimate systems", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("answers 403 on every route while the feature is off", async () => {
    const ctx = await estimateContext();
    const system = await ctx.createSystem({
      name: "Fibonacci",
      type: "points",
      values: FIBONACCI,
    });
    const [first, second] = system.points;
    const task = await ctx.createTask();
    await setEstimatesEnabled(ctx.project.id, false);

    const base = `/${ctx.project.id}/${system.id}`;
    const routes: Array<[string, string, RequestInit | undefined]> = [
      ["list", `/${ctx.project.id}`, undefined],
      [
        "totals",
        `/${ctx.project.id}/totals`,
        json("POST", { taskIds: [task.id] }),
      ],
      [
        "create",
        `/${ctx.project.id}`,
        json("POST", { name: "X", type: "points", values: ["1", "2"] }),
      ],
      ["rename", base, json("PUT", { name: "Y" })],
      ["delete", base, { method: "DELETE" }],
      ["activate", `${base}/activate`, json("POST", { mapping: [] })],
      ["addPoint", `${base}/points`, json("POST", { value: "21" })],
      ["editPoint", `${base}/points/${first?.id}`, json("PUT", { value: "4" })],
      ["deletePoint", `${base}/points/${second?.id}`, { method: "DELETE" }],
      [
        "reorder",
        `${base}/points/reorder`,
        json("PUT", { pointIds: system.points.map((point) => point.id) }),
      ],
    ];
    for (const [name, path, init] of routes) {
      const response = await ctx.request(path, init);
      expect(response.status, name).toBe(403);
      expect(await response.text(), name).toBe(ESTIMATES_OFF);
    }

    const setOnTask = await ctx.setTaskEstimate(task.id, first?.id ?? null);
    expect(setOnTask.status).toBe(403);
    expect(await setOnTask.text()).toBe(ESTIMATES_OFF);

    // Nothing was changed while the feature was off.
    await setEstimatesEnabled(ctx.project.id, true);
    const listed = await ctx.list();
    expect(listed.estimates).toHaveLength(1);
    expect(values(listed.estimates[0] as EstimateJson)).toEqual(FIBONACCI);
  });

  it("creates the first system active and later ones inactive", async () => {
    const ctx = await estimateContext();
    const fibonacci = await ctx.createSystem({
      name: "Fibonacci",
      type: "points",
      values: FIBONACCI,
    });
    expect(fibonacci).toMatchObject({
      projectId: ctx.project.id,
      name: "Fibonacci",
      type: "points",
      isActive: true,
    });
    expect(fibonacci.points).toEqual(
      FIBONACCI.map((value, index) => ({
        id: expect.any(String),
        estimateId: fibonacci.id,
        value,
        numericValue: Number(value),
        position: index + 1,
        taskCount: 0,
      })),
    );

    const sizes = await ctx.createSystem({
      name: "T-shirt sizes",
      type: "categories",
      values: ["XS", "S", "M", "L"],
    });
    expect(sizes.isActive).toBe(false);
    expect(sizes.points.map((point) => point.numericValue)).toEqual([
      null,
      null,
      null,
      null,
    ]);

    const listed = await ctx.list();
    expect(listed.activeEstimateId).toBe(fibonacci.id);
    // The active system first, then the others, newest first.
    expect(listed.estimates.map((estimate) => estimate.id)).toEqual([
      fibonacci.id,
      sizes.id,
    ]);
  });

  it("refuses a duplicate name, ignoring case and spaces around it", async () => {
    const ctx = await estimateContext();
    await ctx.createSystem({
      name: "Sizes",
      type: "points",
      values: ["1", "2"],
    });
    const response = await ctx.request(
      `/${ctx.project.id}`,
      json("POST", { name: "  sIZES ", type: "time", values: ["30", "60"] }),
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      "An estimate system with this name already exists",
    );

    // Another project may use the same name.
    const other = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      slug: "oth",
    });
    await setEstimatesEnabled(other.project.id, true);
    await ctx.createSystem(
      { name: "Sizes", type: "points", values: ["1", "2"] },
      other.project.id,
    );
  });

  it.each([
    ["points", ["1", "0"], [{ index: 1, code: "not_positive" }]],
    ["points", ["1", "-1"], [{ index: 1, code: "not_positive" }]],
    ["points", ["abc", "2"], [{ index: 0, code: "not_numeric" }]],
    ["points", ["1", "1000"], [{ index: 1, code: "too_large" }]],
    ["points", ["1.234", "2"], [{ index: 0, code: "too_precise" }]],
    ["points", ["5", "5.0"], [{ index: 1, code: "duplicate" }]],
    ["categories", ["S", "3"], [{ index: 1, code: "numeric_category" }]],
    ["categories", ["m", "M"], [{ index: 1, code: "duplicate" }]],
    ["time", ["0", "30"], [{ index: 0, code: "not_positive" }]],
    ["points", ["1"], [{ index: -1, code: "too_few" }]],
    [
      "points",
      Array.from({ length: 11 }, (_, i) => String(i + 1)),
      [{ index: -1, code: "too_many" }],
    ],
    ["categories", ["S", "x".repeat(21)], [{ index: 1, code: "too_long" }]],
    ["categories", ["S", "   "], [{ index: 1, code: "empty" }]],
  ])(
    "rejects %s %j with its codes and writes nothing",
    async (type, input, errors) => {
      const ctx = await estimateContext();
      const response = await ctx.request(
        `/${ctx.project.id}`,
        json("POST", { name: "Invalid", type, values: input }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        message: "Invalid estimate values",
        errors,
      });
      expect(await estimateRowCounts()).toEqual({ estimates: 0, points: 0 });
    },
  );

  it("stores canonical values, numeric systems in ascending order", async () => {
    const ctx = await estimateContext();
    const system = await ctx.createSystem({
      name: "Custom",
      type: "points",
      values: ["8", "05", "2.50", "13"],
    });
    expect(values(system)).toEqual(["2.5", "5", "8", "13"]);
    expect(system.points.map((point) => point.position)).toEqual([1, 2, 3, 4]);

    const time = await ctx.createSystem({
      name: "Hours",
      type: "time",
      values: ["480", "060", "120"],
    });
    expect(values(time)).toEqual(["60", "120", "480"]);

    const categories = await ctx.createSystem({
      name: "Sizes",
      type: "categories",
      values: ["L", "  extra   small ", "M"],
    });
    expect(values(categories)).toEqual(["L", "extra small", "M"]);
  });

  it("renames a system, keeping the name unique", async () => {
    const ctx = await estimateContext();
    const system = await ctx.createSystem({
      name: "Points",
      type: "points",
      values: ["1", "2"],
    });
    await ctx.createSystem({
      name: "Other",
      type: "points",
      values: ["1", "2"],
    });

    const renamed = await ctx.ok<EstimateJson>(
      `/${ctx.project.id}/${system.id}`,
      json("PUT", { name: " Story points " }),
    );
    expect(renamed.name).toBe("Story points");
    // Changing only the case of its own name is fine.
    await ctx.ok(
      `/${ctx.project.id}/${system.id}`,
      json("PUT", { name: "STORY POINTS" }),
    );

    const clash = await ctx.request(
      `/${ctx.project.id}/${system.id}`,
      json("PUT", { name: "other" }),
    );
    expect(clash.status).toBe(409);
    const empty = await ctx.request(
      `/${ctx.project.id}/${system.id}`,
      json("PUT", { name: "   " }),
    );
    expect(empty.status).toBe(400);
  });

  it("edits a value in place, so its tasks show the new text", async () => {
    const ctx = await estimateContext();
    const system = await ctx.createSystem({
      name: "Points",
      type: "points",
      values: ["1", "2", "3"],
    });
    const two = system.points[1];
    if (!two) throw new Error("missing point");
    const task = await ctx.createTask();
    expect((await ctx.setTaskEstimate(task.id, two.id)).status).toBe(200);

    // 2 → 20 re-sorts the numeric system.
    const edited = await ctx.ok<EstimateJson>(
      `/${ctx.project.id}/${system.id}/points/${two.id}`,
      json("PUT", { value: "20" }),
    );
    expect(values(edited)).toEqual(["1", "3", "20"]);
    expect(edited.points[2]).toMatchObject({
      id: two.id,
      position: 3,
      taskCount: 1,
    });
    expect(await ctx.pointOf(task.id)).toBe(two.id);

    // The same canonical value is a no-op; a duplicate is refused.
    const same = await ctx.ok<EstimateJson>(
      `/${ctx.project.id}/${system.id}/points/${two.id}`,
      json("PUT", { value: "20.0" }),
    );
    expect(values(same)).toEqual(["1", "3", "20"]);
    const duplicate = await ctx.request(
      `/${ctx.project.id}/${system.id}/points/${two.id}`,
      json("PUT", { value: "3" }),
    );
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toEqual({
      message: "Invalid estimate values",
      errors: [{ index: 0, code: "duplicate" }],
    });
  });

  it("adds values up to 10, placing categories by position", async () => {
    const ctx = await estimateContext();
    const points = await ctx.createSystem({
      name: "Points",
      type: "points",
      values: ["1", "2", "3", "5", "8", "13", "21", "34", "55"],
    });
    const tenth = await ctx.ok<EstimateJson>(
      `/${ctx.project.id}/${points.id}/points`,
      json("POST", { value: "4", position: 1 }),
    );
    // Numeric systems ignore the position and slot in by value.
    expect(values(tenth)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "8",
      "13",
      "21",
      "34",
      "55",
    ]);
    const eleventh = await ctx.request(
      `/${ctx.project.id}/${points.id}/points`,
      json("POST", { value: "89" }),
    );
    expect(eleventh.status).toBe(409);

    const sizes = await ctx.createSystem({
      name: "Sizes",
      type: "categories",
      values: ["S", "M", "L"],
    });
    const appended = await ctx.ok<EstimateJson>(
      `/${ctx.project.id}/${sizes.id}/points`,
      json("POST", { value: "XL" }),
    );
    expect(values(appended)).toEqual(["S", "M", "L", "XL"]);
    const inserted = await ctx.ok<EstimateJson>(
      `/${ctx.project.id}/${sizes.id}/points`,
      json("POST", { value: "XS", position: 1 }),
    );
    expect(values(inserted)).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(inserted.points.map((point) => point.position)).toEqual([
      1, 2, 3, 4, 5,
    ]);

    const invalid = await ctx.request(
      `/${ctx.project.id}/${sizes.id}/points`,
      json("POST", { value: "m" }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      message: "Invalid estimate values",
      errors: [{ index: 0, code: "duplicate" }],
    });
  });

  it("reorders categories only, with exactly the system's values", async () => {
    const ctx = await estimateContext();
    const sizes = await ctx.createSystem({
      name: "Sizes",
      type: "categories",
      values: ["S", "M", "L"],
    });
    const [s, m, l] = sizes.points.map((point) => point.id) as [
      string,
      string,
      string,
    ];

    const reordered = await ctx.ok<EstimateJson>(
      `/${ctx.project.id}/${sizes.id}/points/reorder`,
      json("PUT", { pointIds: [l, s, m] }),
    );
    expect(values(reordered)).toEqual(["L", "S", "M"]);
    expect(reordered.points.map((point) => point.position)).toEqual([1, 2, 3]);

    for (const pointIds of [
      [l, s],
      [l, s, s],
      [l, s, m, "unknown"],
    ]) {
      const response = await ctx.request(
        `/${ctx.project.id}/${sizes.id}/points/reorder`,
        json("PUT", { pointIds }),
      );
      expect(response.status, JSON.stringify(pointIds)).toBe(400);
    }

    const points = await ctx.createSystem({
      name: "Points",
      type: "points",
      values: ["1", "2"],
    });
    const numeric = await ctx.request(
      `/${ctx.project.id}/${points.id}/points/reorder`,
      json("PUT", {
        pointIds: [...points.points].reverse().map((point) => point.id),
      }),
    );
    expect(numeric.status).toBe(400);
  });

  it("answers 404 for systems and values outside the path", async () => {
    const ctx = await estimateContext();
    const own = await ctx.createSystem({
      name: "Own",
      type: "points",
      values: ["1", "2", "3"],
    });
    const other = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      slug: "oth",
    });
    await setEstimatesEnabled(other.project.id, true);
    const foreign = await ctx.createSystem(
      { name: "Foreign", type: "points", values: ["1", "2", "3"] },
      other.project.id,
    );
    const second = await ctx.createSystem({
      name: "Second",
      type: "points",
      values: ["1", "2", "3"],
    });
    const foreignPoint = second.points[0]?.id;

    // Another project's system under this project's path.
    const underWrongProject = await ctx.request(
      `/${ctx.project.id}/${foreign.id}`,
      json("PUT", { name: "Stolen" }),
    );
    expect(underWrongProject.status).toBe(404);
    expect(await underWrongProject.text()).toBe("Estimate not found");
    const activateForeign = await ctx.request(
      `/${ctx.project.id}/${foreign.id}/activate`,
      json("POST", { mapping: [] }),
    );
    expect(activateForeign.status).toBe(404);

    // A value of another system under this system's path.
    const wrongPoint = await ctx.request(
      `/${ctx.project.id}/${own.id}/points/${foreignPoint}`,
      json("PUT", { value: "9" }),
    );
    expect(wrongPoint.status).toBe(404);
    expect(await wrongPoint.text()).toBe("Estimate point not found");
    const deleteWrongPoint = await ctx.request(
      `/${ctx.project.id}/${own.id}/points/${foreignPoint}`,
      { method: "DELETE" },
    );
    expect(deleteWrongPoint.status).toBe(404);

    // Nothing changed on the foreign system.
    const foreignList = await ctx.list(other.project.id);
    expect(foreignList.estimates[0]?.name).toBe("Foreign");
  });
});
