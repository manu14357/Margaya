import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  type AnalyticsScene,
  analyticsScene,
  freeze,
} from "./helpers/analytics";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

// The modules tab (B8 §2A.9); today is 2026-03-25 (UTC).

type ModulesJson = {
  today: string;
  enabledProjectIds: string[];
  summary: { byStatus: Record<string, number>; overdue: number };
  rows: {
    id: string;
    name: string;
    status: string;
    leadId: string | null;
    targetDate: string | null;
    isOverdue: boolean;
    counts: Record<string, number>;
    committed: number;
    pending: number;
    progress: number;
    committedPoints: number | null;
    completedPoints: number | null;
  }[];
  meta: {
    projects: { id: string }[];
    users: { id: string; name: string }[];
  };
};

function modules(s: AnalyticsScene, query: Record<string, string> = {}) {
  return s.ok<ModulesJson>(s.get("/modules", query, s.owner));
}

async function module(
  s: AnalyticsScene,
  name: string,
  status: string,
  extra: Partial<typeof schema.moduleTable.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.moduleTable)
    .values({
      projectId: s.p1.id,
      name,
      status: status as "backlog",
      ...extra,
    })
    .returning();
  if (!row) throw new Error("Failed to create module");
  return row;
}

describe("API integration: analytics modules", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    freeze();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists active modules by status and target date with overdue flags", async () => {
    const s = await analyticsScene();
    const late = await module(s, "Late", "planned", {
      targetDate: "2026-03-01",
      leadId: s.m1.id,
    });
    await module(s, "Later", "planned", {
      targetDate: "2026-04-01",
    });
    const done = await module(s, "Done", "completed", {
      targetDate: "2026-03-01",
    });
    const backlog = await module(s, "Ideas", "backlog");
    await module(s, "Old", "completed", { archivedAt: new Date() });

    const todo = await s.createTask({ status: "to-do", points: 3 });
    const finished = await s.createTask({ status: "done", points: 5 });
    const dropped = await s.createTask({ status: "wont-do", points: 8 });
    const elsewhere = await s.createTask({ projectId: s.p2.id });
    await db.insert(schema.moduleTaskTable).values([
      { moduleId: late.id, taskId: todo.id },
      { moduleId: late.id, taskId: finished.id },
      { moduleId: late.id, taskId: dropped.id },
      // A stale link to a task of another project never counts.
      { moduleId: late.id, taskId: elsewhere.id },
      { moduleId: done.id, taskId: finished.id },
    ]);

    const result = await modules(s);
    expect(result.enabledProjectIds).toEqual([s.p1.id, s.p2.id]);
    expect(result.rows.map((row) => row.name)).toEqual([
      "Ideas",
      "Late",
      "Later",
      "Done",
    ]);
    expect(result.rows.map((row) => row.isOverdue)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(result.rows[1]).toMatchObject({
      id: late.id,
      leadId: s.m1.id,
      counts: {
        total: 3,
        backlog: 0,
        unstarted: 1,
        started: 0,
        completed: 1,
        cancelled: 1,
      },
      committed: 2,
      pending: 1,
      progress: 50,
      committedPoints: 8,
      completedPoints: 5,
    });
    expect(result.summary).toEqual({
      byStatus: {
        backlog: 1,
        planned: 2,
        "in-progress": 0,
        paused: 0,
        completed: 1,
        cancelled: 0,
      },
      overdue: 1,
    });
    expect(result.meta.users.map((user) => user.name)).toEqual(["Ben"]);
    expect(result.meta.projects.map((project) => project.id)).toEqual([
      s.p1.id,
    ]);

    // Contract: the same numbers as the module progress route.
    for (const row of result.rows) {
      mockAuthenticatedSession(s.owner);
      const response = await s.app.request(`/api/module/${row.id}/progress`);
      expect(response.status).toBe(200);
      const progress = (await response.json()) as {
        counts: Record<string, number>;
        progress: number;
        pending: number;
      };
      expect(row.counts, row.name).toEqual(progress.counts);
      expect(row.progress, row.name).toBe(progress.progress);
      expect(row.pending, row.name).toBe(progress.pending);
    }
    expect(backlog.id).toBe(result.rows[0]?.id);
  });

  it("answers empty when no scope project has modules on", async () => {
    const s = await analyticsScene();
    await module(s, "Hidden", "planned");
    await db
      .update(schema.projectTable)
      .set({ modulesEnabled: false })
      .where(eq(schema.projectTable.id, s.p1.id));
    const result = await modules(s, { projectIds: s.p1.id });
    expect(result).toMatchObject({
      enabledProjectIds: [],
      rows: [],
      summary: { overdue: 0 },
    });
  });
});
