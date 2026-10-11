import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { getEstimateTotals } from "../../apps/api/src/estimate/totals";
import {
  type AnalyticsScene,
  analyticsScene,
  at,
  freeze,
} from "./helpers/analytics";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

// The cycles tab (B8 §2A.8); today is 2026-03-25 (UTC).

type CycleRowJson = {
  id: string;
  projectId: string;
  name: string;
  status: string;
  isFrozen: boolean;
  counts: Record<string, number>;
  committed: number;
  pending: number;
  progress: number;
  committedPoints: number | null;
  completedPoints: number | null;
};

type CyclesJson = {
  today: string;
  enabledProjectIds: string[];
  summary: Record<string, number>;
  rows: CycleRowJson[];
  velocity:
    | {
        cycleId: string;
        name: string;
        committed: number;
        completed: number;
        committedPoints: number | null;
        completedPoints: number | null;
      }[]
    | null;
  averageCompleted: number | null;
  averageCompletedPoints: number | null;
};

function cycles(s: AnalyticsScene, query: Record<string, string> = {}) {
  return s.ok<CyclesJson>(s.get("/cycles", query, s.owner));
}

async function cycle(
  projectId: string,
  name: string,
  dates: [string, string] | null,
  extra: Partial<typeof schema.cycleTable.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.cycleTable)
    .values({
      projectId,
      name,
      startDate: dates?.[0] ?? null,
      endDate: dates?.[1] ?? null,
      ...extra,
    })
    .returning();
  if (!row) throw new Error("Failed to create cycle");
  return row;
}

async function addToCycle(cycleId: string, taskIds: string[]) {
  await db
    .insert(schema.cycleTaskTable)
    .values(taskIds.map((taskId) => ({ taskId, cycleId })));
}

async function cyclesScene() {
  const s = await analyticsScene();
  const current = await cycle(s.p1.id, "Now", ["2026-03-20", "2026-03-30"]);
  const upcoming = await cycle(s.p1.id, "Next", ["2026-04-01", "2026-04-14"]);
  const draft = await cycle(s.p1.id, "Someday", null);
  const recent = await cycle(s.p1.id, "Early March", [
    "2026-03-01",
    "2026-03-14",
  ]);
  const old = await cycle(s.p1.id, "Last June", ["2025-06-01", "2025-06-14"]);
  const archived = await cycle(
    s.p1.id,
    "Archived",
    ["2026-02-01", "2026-02-14"],
    { archivedAt: at("2026-02-20T00:00:00Z") },
  );
  const frozen = await cycle(s.p1.id, "Frozen", ["2026-02-15", "2026-02-28"], {
    progressSnapshot: {
      frozenAt: "2026-03-01T00:00:00.000Z",
      counts: {
        total: 10,
        backlog: 0,
        unstarted: 2,
        started: 1,
        completed: 6,
        cancelled: 1,
      },
      pending: 3,
      progress: 67,
      chart: null,
      assignees: [],
      labels: [],
      priorities: [],
      estimates: {
        enabled: true,
        estimateId: s.estimate.id,
        type: "points",
        isNumeric: true,
        taskCount: 10,
        estimatedTaskCount: 8,
        completedTaskCount: 6,
        completedEstimatedTaskCount: 5,
        total: 20,
        completed: 12,
        byGroup: {
          backlog: { taskCount: 0, estimatedTaskCount: 0, total: 0 },
          unstarted: { taskCount: 2, estimatedTaskCount: 2, total: 3 },
          started: { taskCount: 1, estimatedTaskCount: 1, total: 1 },
          completed: { taskCount: 6, estimatedTaskCount: 5, total: 12 },
          cancelled: { taskCount: 1, estimatedTaskCount: 1, total: 4 },
        },
        distribution: [],
      },
    } as never,
  });

  // Now: To Do (3), Done (2), Won't do (8); archived and moved tasks never count.
  const todo = await s.createTask({ status: "to-do", points: 3 });
  const done = await s.createTask({ status: "done", points: 2 });
  const wont = await s.createTask({ status: "wont-do", points: 8 });
  const gone = await s.createTask({ archivedAt: at("2026-03-21T00:00:00Z") });
  const moved = await s.createTask({ projectId: s.p2.id });
  await addToCycle(current.id, [todo.id, done.id, wont.id, gone.id, moved.id]);
  // Early March: one started (5 points), one done without points.
  const started = await s.createTask({ status: "in-progress", points: 5 });
  const finished = await s.createTask({ status: "done" });
  await addToCycle(recent.id, [started.id, finished.id]);
  // Last June: one done task with a point.
  const june = await s.createTask({ status: "done", points: 1 });
  await addToCycle(old.id, [june.id]);

  return { s, current, upcoming, draft, recent, old, archived, frozen };
}

describe("API integration: analytics cycles", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    freeze();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists running, upcoming, draft and recently completed cycles", async () => {
    const c = await cyclesScene();
    const result = await cycles(c.s);
    expect(result.today).toBe("2026-03-25");
    expect(result.enabledProjectIds).toEqual([c.s.p1.id, c.s.p2.id]);
    // Current, upcoming, draft, then completed by end date (newest first).
    expect(result.rows.map((row) => row.name)).toEqual([
      "Now",
      "Next",
      "Someday",
      "Early March",
      "Frozen",
    ]);
    expect(result.summary).toEqual({
      current: 1,
      upcoming: 1,
      draft: 1,
      completedRecent: 2,
    });
    const now = result.rows[0];
    expect(now).toMatchObject({
      status: "current",
      isFrozen: false,
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
      committedPoints: 5,
      completedPoints: 2,
    });
    const frozen = result.rows.find((row) => row.name === "Frozen");
    expect(frozen).toMatchObject({
      isFrozen: true,
      counts: { total: 10, completed: 6, cancelled: 1 },
      committed: 9,
      pending: 3,
      progress: 67,
      committedPoints: 16,
      completedPoints: 12,
    });
    // Two projects have cycles on: no velocity.
    expect(result.velocity).toBeNull();
    expect(result.averageCompleted).toBeNull();
  });

  it("matches the cycle progress route and the estimate totals", async () => {
    const c = await cyclesScene();
    const result = await cycles(c.s);
    const { app } = c.s;
    for (const row of result.rows) {
      mockAuthenticatedSession(c.s.owner);
      const response = await app.request(`/api/cycle/${row.id}/progress`);
      expect(response.status).toBe(200);
      const progress = (await response.json()) as {
        counts: Record<string, number>;
        progress: number;
        pending: number;
      };
      expect(row.counts, row.name).toEqual(progress.counts);
      expect(row.progress, row.name).toBe(progress.progress);
      expect(row.pending, row.name).toBe(progress.pending);
      if (row.isFrozen) continue;
      const totals = await getEstimateTotals({
        projectId: row.projectId,
        taskScope: {
          kind: "subquery",
          sql: sql`select ${schema.cycleTaskTable.taskId} from ${schema.cycleTaskTable} where ${schema.cycleTaskTable.cycleId} = ${row.id}`,
        },
        db,
      });
      expect(row.committedPoints, row.name).toBe(
        (totals.total ?? 0) - (totals.byGroup.cancelled.total ?? 0),
      );
      expect(row.completedPoints, row.name).toBe(totals.completed ?? 0);
    }
  });

  it("shows velocity for a single project, archived cycles included", async () => {
    const c = await cyclesScene();
    await db
      .update(schema.projectTable)
      .set({ cyclesEnabled: false })
      .where(eq(schema.projectTable.id, c.s.p2.id));
    const result = await cycles(c.s);
    expect(result.enabledProjectIds).toEqual([c.s.p1.id]);
    expect(result.velocity?.map((point) => point.name)).toEqual([
      "Last June",
      "Archived",
      "Frozen",
      "Early March",
    ]);
    expect(result.velocity?.[0]).toMatchObject({
      committed: 1,
      completed: 1,
      committedPoints: 1,
      completedPoints: 1,
    });
    // Last three: Archived 0, Frozen 6, Early March 1.
    expect(result.averageCompleted).toBe(2.3);
    expect(result.averageCompletedPoints).toBe(4);

    // Only the last 12 completed cycles, oldest first.
    for (let month = 1; month <= 10; month++) {
      const start = `2024-${String(month).padStart(2, "0")}-01`;
      const end = `2024-${String(month).padStart(2, "0")}-10`;
      await cycle(c.s.p1.id, `Old ${month}`, [start, end]);
    }
    const capped = await cycles(c.s, { projectIds: c.s.p1.id });
    expect(capped.velocity).toHaveLength(12);
    expect(capped.velocity?.[0]?.name).toBe("Old 3");
    expect(capped.velocity?.at(-1)?.name).toBe("Early March");
  });

  it("reports null points without a points system and nothing with cycles off", async () => {
    const c = await cyclesScene();
    await db
      .update(schema.projectTable)
      .set({ estimatesEnabled: false })
      .where(eq(schema.projectTable.id, c.s.p1.id));
    const result = await cycles(c.s, { projectIds: c.s.p1.id });
    expect(result.rows[0]).toMatchObject({
      committedPoints: null,
      completedPoints: null,
    });
    expect(result.averageCompletedPoints).toBeNull();

    await db
      .update(schema.projectTable)
      .set({ cyclesEnabled: false })
      .where(eq(schema.projectTable.id, c.s.p1.id));
    const off = await cycles(c.s, { projectIds: c.s.p1.id });
    expect(off).toMatchObject({
      enabledProjectIds: [],
      rows: [],
      velocity: null,
      summary: { current: 0, upcoming: 0, draft: 0, completedRecent: 0 },
    });
  });
});
