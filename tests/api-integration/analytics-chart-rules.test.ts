import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  analyticsScene,
  bucket,
  freeze,
  keys,
  seedCanonical,
  values,
} from "./helpers/analytics";
import { addPerson } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";

// Validation, the none rule, truncation and folding (B8 §2A.5, §3.5), and
// the task query filters applied unchanged (K2).

describe("API integration: analytics chart rules", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    freeze();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses invalid combinations with the documented messages", async () => {
    const s = await analyticsScene();
    const chart = (body: Record<string, unknown>) =>
      s.post("/chart", body, s.owner);
    await s.fails(
      chart({ xAxis: "status" }),
      400,
      "Status needs a single project; use Group instead",
    );
    await s.fails(
      chart({ xAxis: "group", segment: "status" }),
      400,
      "Status needs a single project; use Group instead",
    );
    await s.fails(
      chart({ xAxis: "label", segment: "label" }),
      400,
      "The segment must differ from the x-axis",
    );
    await s.fails(
      chart({ xAxis: "group", segment: "dueDate" }),
      400,
      "Dates can only be used on the x-axis",
    );
    await s.fails(chart({ xAxis: "size" }), 400);
    await s.fails(chart({ xAxis: "group", metric: "hours" }), 400);
    await s.fails(
      chart({
        xAxis: "group",
        filters: { key: "nope", operator: "in", values: ["x"] },
      }),
      400,
      "Unsupported filter: nope",
    );
    await s.fails(
      chart({ xAxis: "group", context: { timeZone: "Mars/Olympus" } }),
      400,
      "Unknown time zone",
    );
    await s.fails(chart({ xAxis: "group", scope: { projectIds: [] } }), 400);
    await s.fails(
      chart({ xAxis: "group", scope: { projectIds: ["missing"] } }),
      404,
      "Project not found",
    );
  });

  it("hides the none bucket and segment on request but keeps totals", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const chart = await s.chart({ xAxis: "label", includeNone: false });
    expect(keys(chart)).toEqual(["name:Bug", "name:Feature"]);
    expect(chart.noneCount).toBe(5);
    expect(chart.totalCount).toBe(8);

    const segmented = await s.chart({
      xAxis: "priority",
      segment: "assignee",
      includeNone: false,
    });
    expect(segmented.segments.map((segment) => segment.key)).toEqual([
      s.m1.id,
      s.m2.id,
    ]);
    expect(bucket(segmented, "high").cells).toEqual({
      [s.m1.id]: 2,
      [s.m2.id]: 1,
    });
    // Priority has no none bucket, so there is nothing to report.
    expect(segmented.noneCount).toBeNull();

    const shown = await s.chart({ xAxis: "label" });
    expect(shown.noneCount).toBeNull();
  });

  it("keeps the top 50 of many categories with exact totals", async () => {
    await analyticsScene();
    // A second workspace with 60 assignees.
    const s = await analyticsScene();
    const people = [];
    for (let index = 0; index < 60; index++) {
      people.push(
        await addPerson(
          s.workspaceId,
          `User ${String(index).padStart(2, "0")}`,
        ),
      );
    }
    for (const [index, person] of people.entries()) {
      await s.createTask({ assignees: [person.id] });
      // The last ten have two tasks, so they rank first by value.
      if (index >= 50) await s.createTask({ assignees: [person.id] });
    }
    const chart = await s.chart({ xAxis: "assignee" });
    expect(chart.buckets).toHaveLength(50);
    expect(chart.truncated).toMatchObject({ x: true, hiddenXCount: 10 });
    expect(chart.totalCount).toBe(70);
    // Kept in natural (name) order: users 00–39 by the tie-break, then 50–59.
    expect(keys(chart)).toEqual([
      ...people.slice(0, 40).map((person) => person.id),
      ...people.slice(50).map((person) => person.id),
    ]);
    expect(chart.meta.users).toHaveLength(50);
  });

  it("folds segments beyond the top five into other, never none", async () => {
    const s = await analyticsScene();
    const people = [];
    for (let index = 0; index < 7; index++) {
      people.push(await addPerson(s.workspaceId, `Person ${index}`));
    }
    // Person 0 has 7 tasks, person 6 has 1.
    for (const [index, person] of people.entries()) {
      for (let n = 0; n < 7 - index; n++) {
        await s.createTask({ assignees: [person.id] });
      }
    }
    await s.createTask();
    const chart = await s.chart({ xAxis: "group", segment: "assignee" });
    expect(chart.segments.map((segment) => segment.key)).toEqual([
      ...people.slice(0, 5).map((person) => person.id),
      "other",
      "none",
    ]);
    expect(chart.segments.find((segment) => segment.key === "other")).toEqual({
      key: "other",
      value: 3,
      taskCount: 3,
    });
    expect(bucket(chart, "unstarted").cells).toMatchObject({
      other: 3,
      none: 1,
    });
    expect(chart.truncated).toMatchObject({
      segment: true,
      hiddenSegmentCount: 2,
    });
  });

  it("keeps eight label segments and never folds groups", async () => {
    const s = await analyticsScene();
    const task = await s.createTask({ priority: "high" });
    const names = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    for (const name of names) {
      await db.insert(schema.labelTable).values({
        name,
        color: "#111111",
        taskId: task.id,
        workspaceId: s.workspaceId,
      });
    }
    const chart = await s.chart({ xAxis: "priority", segment: "label" });
    expect(chart.segments.map((segment) => segment.key)).toEqual([
      ...names.slice(0, 8).map((name) => `name:${name}`),
      "other",
    ]);
    expect(bucket(chart, "high").cells?.other).toBe(2);
    expect(bucket(chart, "high").value).toBe(1);

    await seedCanonical(s);
    const grouped = await s.chart({ xAxis: "priority", segment: "group" });
    expect(grouped.truncated.segment).toBe(false);
    expect(grouped.segments.map((segment) => segment.key)).toEqual([
      "backlog",
      "unstarted",
      "started",
      "completed",
      "cancelled",
    ]);
  });

  it("applies the task query filters unchanged", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const high = await s.chart({
      xAxis: "group",
      filters: { key: "priority", operator: "in", values: ["high"] },
    });
    expect(values(high)).toEqual({
      backlog: 1,
      unstarted: 1,
      completed: 1,
      cancelled: 1,
    });
    const mine = await s.chart(
      {
        xAxis: "project",
        filters: { key: "assignee", operator: "in", values: ["me"] },
      },
      s.m1,
    );
    expect(mine.totalCount).toBe(4);
    const notBug = await s.chart({
      xAxis: "label",
      filters: { key: "label", operator: "notIn", values: ["name:Bug"] },
    });
    expect(notBug.totalCount).toBe(6);
    expect(values(notBug)).toEqual({ "name:Feature": 1, none: 5 });
  });

  it("leaves sub-tasks out when asked", async () => {
    const s = await analyticsScene();
    const parent = await s.createTask();
    const child = await s.createTask();
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: parent.id,
      targetTaskId: child.id,
      relationType: "subtask",
    });
    expect((await s.chart({ xAxis: "group" })).totalCount).toBe(2);
    expect(
      (await s.chart({ xAxis: "group", showSubTasks: false })).totalCount,
    ).toBe(1);
  });

  it("returns an empty chart for an empty task set", async () => {
    const s = await analyticsScene();
    const chart = await s.chart({ xAxis: "assignee", segment: "group" });
    expect(chart).toMatchObject({
      totalCount: 0,
      totalValue: 0,
      buckets: [],
      segments: [],
      progress: 0,
    });
  });
});
