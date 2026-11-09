import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { projectMemberTable } from "../../apps/api/src/database/schema";
import {
  type AnalyticsScene,
  analyticsScene,
  at,
  freeze,
  json,
  keys,
  values,
} from "./helpers/analytics";
import { createApiKey } from "./helpers/api-keys";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

// Custom fields in analytics: a dropdown is a dimension (x-axis or segment),
// a number can be summed, and both stay inside the projects the caller may
// read, like every other dimension.

type Field = typeof schema.customFieldDefinitionTable.$inferSelect;

async function field(
  projectId: string,
  name: string,
  type: string,
  options?: string[],
): Promise<Field> {
  const [row] = await db
    .insert(schema.customFieldDefinitionTable)
    .values({ projectId, name, type, options: options ?? null })
    .returning();
  if (!row) throw new Error("Failed to create custom field");
  return row;
}

async function setValue(taskId: string, fieldId: string, value: string) {
  await db.insert(schema.customFieldValueTable).values({
    taskId,
    fieldId,
    value,
  });
}

const dimension = (target: Field) => `customField:${target.id}`;

/**
 * P1 tasks with a Tier dropdown (Gold, Silver, Bronze, then Legacy, an
 * option removed later) and a Budget number.
 */
async function seedTiers(s: AnalyticsScene) {
  const tier = await field(s.p1.id, "Tier", "dropdown", [
    "Gold",
    "Silver",
    "Bronze",
    "Legacy",
  ]);
  const budget = await field(s.p1.id, "Budget", "number");
  const tasks = [
    { status: "to-do", tier: "Silver", budget: "100" },
    { status: "in-progress", tier: "Gold", budget: "250.5" },
    { status: "done", tier: "Gold", budget: "50", done: "2026-03-10" },
    { status: "done", tier: "Legacy", done: "2026-03-20" },
    { status: "wont-do", tier: "Silver", budget: "10" },
    { status: "to-do", budget: "" },
  ];
  const created = [];
  for (const [index, entry] of tasks.entries()) {
    const task = await s.createTask({
      status: entry.status,
      createdAt: at(`2026-03-0${index + 2}T09:00:00Z`),
      completedAt: entry.done ? at(`${entry.done}T10:00:00Z`) : null,
    });
    if (entry.tier) await setValue(task.id, tier.id, entry.tier);
    if (entry.budget !== undefined) {
      await setValue(task.id, budget.id, entry.budget);
    }
    created.push(task);
  }
  // Legacy is removed: tasks keep it, it orders after the current options.
  await db
    .update(schema.customFieldDefinitionTable)
    .set({ options: ["Gold", "Silver", "Bronze"] })
    .where(eq(schema.customFieldDefinitionTable.id, tier.id));
  return { tier, budget, tasks: created };
}

describe("API integration: analytics custom fields", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    freeze();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("charts a dropdown by option order, removed options after, no value last", async () => {
    const s = await analyticsScene();
    const { tier } = await seedTiers(s);
    const chart = await s.chart({
      xAxis: dimension(tier),
      segment: "group",
      scope: { projectIds: [s.p1.id] },
    });
    expect(chart.xAxis).toBe(dimension(tier));
    expect(keys(chart)).toEqual([
      "value:Gold",
      "value:Silver",
      "value:Legacy",
      "none",
    ]);
    expect(values(chart)).toEqual({
      "value:Gold": 2,
      "value:Silver": 2,
      "value:Legacy": 1,
      none: 1,
    });
    // Open and completed per value, from the group segment.
    const cells = Object.fromEntries(
      chart.buckets.map((bucket) => [bucket.key, bucket.cells]),
    );
    expect(cells["value:Gold"]).toEqual({ started: 1, completed: 1 });
    expect(cells["value:Silver"]).toEqual({ unstarted: 1, cancelled: 1 });
    expect(chart.totalCount).toBe(6);
    expect(chart.multiValued).toEqual({ x: false, segment: false });
    expect(
      (chart.meta as unknown as { customFields: unknown[] }).customFields,
    ).toEqual([{ id: tier.id, name: "Tier", type: "dropdown" }]);
  });

  it("segments created and completed counts by a dropdown", async () => {
    const s = await analyticsScene();
    const { tier } = await seedTiers(s);
    const created = await s.chart({
      xAxis: "createdAt",
      dateBucket: "month",
      segment: dimension(tier),
      scope: { projectIds: [s.p1.id] },
    });
    expect(created.buckets).toHaveLength(1);
    expect(created.buckets[0]?.cells).toEqual({
      "value:Gold": 2,
      "value:Silver": 2,
      "value:Legacy": 1,
      none: 1,
    });
    expect(created.segments.map((entry) => entry.key)).toEqual([
      "value:Gold",
      "value:Silver",
      "value:Legacy",
      "none",
    ]);

    const completed = await s.chart({
      xAxis: "completedAt",
      dateBucket: "month",
      segment: dimension(tier),
      includeNone: false,
      scope: { projectIds: [s.p1.id] },
    });
    expect(completed.buckets.map((bucket) => bucket.cells)).toEqual([
      { "value:Gold": 1, "value:Legacy": 1 },
    ]);
  });

  it("sums a number field; tasks without a number add nothing", async () => {
    const s = await analyticsScene();
    const { tier, budget } = await seedTiers(s);
    const chart = await s.chart({
      xAxis: dimension(tier),
      metric: dimension(budget),
      scope: { projectIds: [s.p1.id] },
    });
    expect(chart.metric).toBe(dimension(budget));
    expect(values(chart)).toEqual({
      "value:Gold": 300.5,
      "value:Silver": 110,
      "value:Legacy": 0,
      none: 0,
    });
    expect(chart.buckets.map((bucket) => bucket.taskCount)).toEqual([
      2, 2, 1, 1,
    ]);
    expect(chart.totalValue).toBe(410.5);
    expect(chart.totalCount).toBe(6);
    const names = (
      chart.meta as unknown as { customFields: { name: string }[] }
    ).customFields.map((entry) => entry.name);
    expect(names.sort()).toEqual(["Budget", "Tier"]);

    const byGroup = await s.chart({
      xAxis: "group",
      metric: dimension(budget),
      scope: { projectIds: [s.p1.id] },
    });
    expect(values(byGroup)).toMatchObject({
      unstarted: 100,
      started: 250.5,
      completed: 50,
      cancelled: 10,
    });
  });

  it("refuses unknown fields and fields of the wrong type", async () => {
    const s = await analyticsScene();
    const { tier, budget } = await seedTiers(s);
    const notes = await field(s.p1.id, "Notes", "text");
    const other = await field(s.p2.id, "Area", "dropdown", ["North"]);
    const scope = { projectIds: [s.p1.id] };
    const chart = (body: Record<string, unknown>) =>
      s.post("/chart", { scope, ...body }, s.owner);

    await s.fails(
      chart({ xAxis: "customField:missing" }),
      400,
      "Unknown custom field",
    );
    // A field of a project outside the scope reads as unknown.
    await s.fails(
      chart({ xAxis: dimension(other) }),
      400,
      "Unknown custom field",
    );
    await s.fails(
      chart({ xAxis: dimension(notes) }),
      400,
      "Only dropdown custom fields can be a dimension",
    );
    await s.fails(
      chart({ xAxis: "priority", segment: dimension(budget) }),
      400,
      "Only dropdown custom fields can be a dimension",
    );
    await s.fails(
      chart({ xAxis: "priority", metric: dimension(tier) }),
      400,
      "Only number custom fields can be summed",
    );
    await s.fails(
      chart({ xAxis: dimension(tier), segment: dimension(tier) }),
      400,
      "The segment must differ from the x-axis",
    );
    await s.fails(chart({ xAxis: "customField:" }), 400);
    // The trend counts tasks or points only.
    await s.fails(
      s.post(
        "/trend",
        {
          scope,
          from: "2026-03-01",
          to: "2026-03-31",
          bucket: "week",
          metric: dimension(budget),
        },
        s.owner,
      ),
      400,
    );
  });

  it("keeps a restricted project's fields from people who can't see it", async () => {
    const s = await analyticsScene();
    const area = await field(s.p2.id, "Area", "dropdown", ["North", "South"]);
    const task = await s.createTask({ projectId: s.p2.id });
    await setValue(task.id, area.id, "North");
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.p2.id));
    await db
      .insert(projectMemberTable)
      .values({ projectId: s.p2.id, userId: s.m2.id });

    // Ben isn't a member: the field answers like an unknown one, and naming
    // its project like an unknown project.
    await s.fails(
      s.post("/chart", { xAxis: dimension(area) }, s.m1),
      400,
      "Unknown custom field",
    );
    await s.fails(
      s.post(
        "/chart",
        { xAxis: dimension(area), scope: { projectIds: [s.p2.id] } },
        s.m1,
      ),
      404,
      "Project not found",
    );

    // Cara is a member and the owner sees every project.
    for (const user of [s.m2, s.owner]) {
      const chart = await s.chart({ xAxis: dimension(area) }, user);
      expect(values(chart)).toMatchObject({ "value:North": 1 });
    }
  });

  it("follows API key scopes like every analytics chart", async () => {
    const s = await analyticsScene();
    const { tier } = await seedTiers(s);
    mockAnonymousSession();
    const call = (headers: Record<string, string>) =>
      s.app.request("/api/analytics/chart", {
        ...json("POST", {
          workspaceId: s.workspaceId,
          xAxis: dimension(tier),
          scope: { projectIds: [s.p1.id] },
        }),
        headers: { ...headers, "content-type": "application/json" },
      });

    const reader = await createApiKey(s.owner, {
      task: ["read"],
      analytics: ["read"],
    });
    const read = await call(reader.headers);
    expect(read.status, await read.clone().text()).toBe(200);
    expect(values((await read.json()) as { buckets: [] })).toMatchObject({
      "value:Gold": 2,
    });

    const noAnalytics = await createApiKey(s.owner, { task: ["read"] });
    const refused = await call(noAnalytics.headers);
    expect(refused.status).toBe(403);
    expect(await refused.text()).toBe("Insufficient API key scope");

    const limited = await createApiKey(s.owner, {
      "margaya:access": ["full"],
      "margaya:projects": [s.p1.id],
    });
    const fenced = await call(limited.headers);
    expect(fenced.status).toBe(403);
    expect(await fenced.text()).toBe(
      "This API key is limited to specific projects",
    );
  });

  it("saves a report that charts a custom field", async () => {
    const s = await analyticsScene();
    const { tier, budget } = await seedTiers(s);
    mockAuthenticatedSession(s.owner);
    const response = await s.app.request(
      "/api/analytics-report",
      json("POST", {
        workspaceId: s.workspaceId,
        name: "Budget by tier",
        config: {
          scope: { projectIds: [s.p1.id] },
          xAxis: dimension(tier),
          metric: dimension(budget),
        },
      }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const saved = (await response.json()) as {
      config: { xAxis: string; metric: string };
    };
    expect(saved.config).toMatchObject({
      xAxis: dimension(tier),
      metric: dimension(budget),
    });
  });
});
