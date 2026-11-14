import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  type AnalyticsScene,
  analyticsScene,
  at,
  freeze,
} from "./helpers/analytics";
import { resetTestDatabase } from "./helpers/database";

// The intake tab (B8 §2A.10).

type IntakeJson = {
  today: string;
  enabledProjectIds: string[];
  counts: Record<string, number>;
  series: {
    start: string;
    rangeStart: string;
    rangeEnd: string;
    submitted: number;
    accepted: number;
    declined: number;
    duplicate: number;
  }[];
  medianHoursToTriage: number | null;
  bySource: Record<string, number>;
  byProject:
    | ({ projectId: string; medianHoursToTriage: number | null } & Record<
        string,
        number | string | null
      >)[]
    | null;
};

const MARCH = {
  from: "2026-03-01",
  to: "2026-03-31",
  bucket: "week",
  weekStartsOn: "1",
};

function intake(s: AnalyticsScene, query: Record<string, string> = {}) {
  return s.ok<IntakeJson>(s.get("/intake", { ...MARCH, ...query }, s.owner));
}

async function item(
  s: AnalyticsScene,
  status: string,
  createdAt: string,
  extra: Partial<typeof schema.intakeItemTable.$inferInsert> = {},
) {
  const projectId = extra.projectId ?? s.p1.id;
  const task = await s.createTask({
    projectId,
    status: projectId === s.p1.id ? "triage" : "to-do",
  });
  await db.insert(schema.intakeItemTable).values({
    projectId,
    taskId: task.id,
    status,
    createdAt: at(createdAt),
    ...extra,
  });
}

async function intakeScene() {
  const s = await analyticsScene();
  for (const project of [s.p1, s.p2]) {
    await db
      .update(schema.projectTable)
      .set({ intakeEnabled: true })
      .where(eq(schema.projectTable.id, project.id));
  }
  // Snoozes are compared with the database clock, which is not frozen.
  const later = new Date(Date.now() + 400 * 86_400_000);
  await item(s, "pending", "2026-03-02T09:00:00Z");
  await item(s, "snoozed", "2026-03-02T10:00:00Z", { snoozedUntil: later });
  await item(s, "snoozed", "2026-03-02T11:00:00Z", {
    snoozedUntil: at("2020-01-01T00:00:00Z"),
  });
  await item(s, "accepted", "2026-03-03T09:00:00Z", {
    triagedAt: at("2026-03-03T13:00:00Z"),
  });
  await item(s, "declined", "2026-03-04T09:00:00Z", {
    triagedAt: at("2026-03-05T09:00:00Z"),
  });
  await item(s, "duplicate", "2026-03-10T09:00:00Z", {
    triagedAt: at("2026-03-10T11:00:00Z"),
  });
  // Declined, reopened, then accepted: one decision, the latest.
  await item(s, "accepted", "2026-03-11T09:00:00Z", {
    triagedAt: at("2026-03-20T09:00:00Z"),
  });
  await item(s, "accepted", "2026-03-12T09:00:00Z", {
    projectId: s.p2.id,
    source: "api",
    triagedAt: at("2026-03-12T10:00:00Z"),
  });
  // Before the range: counted in the totals, not in the series.
  await item(s, "declined", "2026-02-01T09:00:00Z", {
    triagedAt: at("2026-02-02T09:00:00Z"),
  });
  return s;
}

describe("API integration: analytics intake", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    freeze();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts by effective status and decisions by their latest time", async () => {
    const s = await intakeScene();
    const result = await intake(s);
    expect(result.enabledProjectIds).toEqual([s.p1.id, s.p2.id]);
    expect(result.counts).toEqual({
      pending: 2,
      snoozed: 1,
      accepted: 3,
      declined: 2,
      duplicate: 1,
    });
    expect(
      result.series.map((point) => [
        point.start,
        point.submitted,
        point.accepted,
        point.declined,
        point.duplicate,
      ]),
    ).toEqual([
      ["2026-02-23", 0, 0, 0, 0],
      ["2026-03-02", 5, 1, 1, 0],
      ["2026-03-09", 3, 1, 0, 1],
      ["2026-03-16", 0, 1, 0, 0],
      ["2026-03-23", 0, 0, 0, 0],
      ["2026-03-30", 0, 0, 0, 0],
    ]);
    expect(result.series[0]).toMatchObject({
      rangeStart: "2026-03-01",
      rangeEnd: "2026-03-01",
    });
    // 1, 2, 4, 24 and 216 hours: the middle one.
    expect(result.medianHoursToTriage).toBe(4);
    expect(result.bySource).toEqual({
      in_app: 7,
      api: 1,
      public_board: 0,
      email: 0,
      form: 0,
    });
    expect(result.byProject).toEqual([
      {
        projectId: s.p1.id,
        pending: 2,
        snoozed: 1,
        accepted: 2,
        declined: 2,
        duplicate: 1,
        // 2, 4, 24 and 216 hours: the mean of the middle two.
        medianHoursToTriage: 14,
      },
      {
        projectId: s.p2.id,
        pending: 0,
        snoozed: 0,
        accepted: 1,
        declined: 0,
        duplicate: 0,
        medianHoursToTriage: 1,
      },
    ]);
  });

  it("drops byProject for one project and projects with intake off", async () => {
    const s = await intakeScene();
    const single = await intake(s, { projectIds: s.p2.id });
    expect(single.byProject).toBeNull();
    expect(single.counts.accepted).toBe(1);
    expect(single.medianHoursToTriage).toBe(1);

    await db
      .update(schema.projectTable)
      .set({ intakeEnabled: false })
      .where(eq(schema.projectTable.id, s.p2.id));
    const result = await intake(s);
    expect(result.enabledProjectIds).toEqual([s.p1.id]);
    expect(result.counts.accepted).toBe(2);
    expect(result.bySource.api).toBe(0);
  });

  it("answers empty with intake off and validates the range", async () => {
    const s = await analyticsScene();
    const result = await intake(s, { bucket: "month" });
    expect(result).toMatchObject({
      enabledProjectIds: [],
      counts: {
        pending: 0,
        snoozed: 0,
        accepted: 0,
        declined: 0,
        duplicate: 0,
      },
      medianHoursToTriage: null,
      byProject: [],
    });
    expect(result.series).toHaveLength(1);
    await s.fails(
      s.get("/intake", { ...MARCH, from: "2026-04-01" }, s.owner),
      400,
      "Invalid date range",
    );
    await s.fails(
      s.get("/intake", { ...MARCH, projectIds: "" }, s.owner),
      400,
      "Provide between 1 and 100 project ids",
    );
    await s.fails(
      s.get("/intake", { ...MARCH, weekStartsOn: "3" }, s.owner),
      400,
    );
  });
});
