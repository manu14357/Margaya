import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  queryAnalyticsChart,
  queryAnalyticsTrend,
} from "../../apps/api/src/analytics";
import { getAnalyticsOverview } from "../../apps/api/src/analytics/controllers/get-overview";
import db, { getDatabase, schema } from "../../apps/api/src/database";
import {
  type AnalyticsScene,
  analyticsScene,
  freeze,
  json,
} from "./helpers/analytics";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

// A fixed number of statements per request, whatever the task count, all in
// one bounded read (B8 K17, §3.6).

/** BEGIN, the statement timeout and COMMIT around every bounded read. */
const TRANSACTION_STATEMENTS = 3;

async function seedTasks(s: AnalyticsScene, count: number, offset: number) {
  const people = [s.owner.id, s.m1.id, s.m2.id];
  const tasks = await db
    .insert(schema.taskTable)
    .values(
      Array.from({ length: count }, (_, index) => ({
        projectId: s.p1.id,
        title: `Bulk ${offset + index}`,
        number: 1000 + offset + index,
        position: index,
        status: index % 2 === 0 ? "to-do" : "done",
        priority: "medium",
        createdBy: s.owner.id,
        estimatePointId: s.points.get(3),
        createdAt: new Date(Date.UTC(2026, 2, 1 + (index % 28), 9)),
        completedAt:
          index % 2 === 0
            ? null
            : new Date(Date.UTC(2026, 2, 2 + (index % 20))),
      })),
    )
    .returning({ id: schema.taskTable.id });
  await db.insert(schema.taskAssigneeTable).values(
    tasks.flatMap((task, index) => [
      { taskId: task.id, userId: people[index % 3] as string, position: 0 },
      {
        taskId: task.id,
        userId: people[(index + 1) % 3] as string,
        position: 1,
      },
    ]),
  );
  await db.insert(schema.labelTable).values(
    tasks.flatMap((task, index) => [
      {
        taskId: task.id,
        name: `Label ${index % 12}`,
        color: "#123456",
        workspaceId: s.workspaceId,
      },
      {
        taskId: task.id,
        name: "Shared",
        color: "#654321",
        workspaceId: s.workspaceId,
      },
    ]),
  );
}

describe("API integration: analytics bounds", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    freeze();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the same few statements for 10 or 500 tasks", async () => {
    const s = await analyticsScene();
    const caller = { workspaceId: s.workspaceId, userId: s.owner.id };
    const spy = vi.spyOn(pg.Client.prototype, "query");
    const count = async (run: () => Promise<unknown>) => {
      spy.mockClear();
      await run();
      return spy.mock.calls.length - TRANSACTION_STATEMENTS;
    };
    const chart = () =>
      queryAnalyticsChart(
        {
          workspaceId: s.workspaceId,
          xAxis: "assignee",
          segment: "label",
          metric: "estimatePoints",
          filters: { key: "priority", operator: "in", values: ["medium"] },
        },
        caller,
      );
    const trend = () =>
      queryAnalyticsTrend(
        {
          workspaceId: s.workspaceId,
          from: "2026-03-01",
          to: "2026-03-31",
          bucket: "week",
          metric: "estimatePoints",
        },
        caller,
      );
    const overview = () =>
      getAnalyticsOverview(caller, {
        sections: { cycles: true, modules: true, intake: true },
      });

    await seedTasks(s, 10, 0);
    const small = {
      chart: await count(chart),
      trend: await count(trend),
      overview: await count(overview),
    };
    await seedTasks(s, 490, 10);
    const large = {
      chart: await count(chart),
      trend: await count(trend),
      overview: await count(overview),
    };
    const result = await chart();
    expect(result.totalCount).toBe(500);
    expect(result.buckets).toHaveLength(3);
    expect(result.totalValue).toBe(1500);

    expect(large).toEqual(small);
    expect(small.chart).toBeGreaterThanOrEqual(3);
    expect(small.chart).toBeLessThanOrEqual(8);
    expect(small.trend).toBeLessThanOrEqual(4);
    expect(small.overview).toBeLessThanOrEqual(6);
  });

  it("maps the statement timeout to 503", async () => {
    const s = await analyticsScene();
    const timeout = Object.assign(
      new Error("canceling statement due to statement timeout"),
      { code: "57014" },
    );
    // db is a lazy proxy; stub the instance behind it.
    vi.spyOn(getDatabase(), "transaction").mockRejectedValueOnce(timeout);
    await s.fails(
      s.post("/chart", { xAxis: "group" }, s.owner),
      503,
      "Analytics took too long; narrow the filters and try again",
    );
  });

  it("refuses bodies above 32 KB", async () => {
    const s = await analyticsScene();
    mockAuthenticatedSession(s.owner);
    const response = await s.app.request(
      "/api/analytics/chart",
      json("POST", {
        workspaceId: s.workspaceId,
        xAxis: "group",
        padding: "x".repeat(40_000),
      }),
    );
    expect(response.status).toBe(413);
  });
});
