import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  type AnalyticsScene,
  analyticsScene,
  at,
  freeze,
  seedCanonical,
} from "./helpers/analytics";
import { addPerson } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";

// Headline numbers (B8 §2A.7).

type OverviewJson = {
  today: string;
  members: { total: number; byRole: { role: string; count: number }[] };
  projects: {
    total: number;
    withFeature: Record<"cycles" | "modules" | "intake" | "estimates", number>;
  };
  tasks: Record<string, number>;
  projectRows: Array<Record<string, number | string>>;
  cycles: Record<string, number> | null;
  modules: { total: number; byStatus: Record<string, number> } | null;
  intake: Record<string, number> | null;
  meta: { projects: { id: string; slug: string }[] };
};

function overview(
  s: AnalyticsScene,
  query: Record<string, string> = {},
  user = s.owner,
) {
  return s.ok<OverviewJson>(s.get("/overview", query, user));
}

async function setFlags(
  projectId: string,
  flags: Partial<typeof schema.projectTable.$inferInsert>,
) {
  await db
    .update(schema.projectTable)
    .set(flags)
    .where(eq(schema.projectTable.id, projectId));
}

async function intakeItem(
  s: AnalyticsScene,
  status: string,
  extra: Partial<typeof schema.intakeItemTable.$inferInsert> = {},
) {
  const task = await s.createTask({ status: "triage" });
  await db.insert(schema.intakeItemTable).values({
    projectId: s.p1.id,
    taskId: task.id,
    status,
    ...extra,
  });
}

describe("API integration: analytics overview", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    freeze();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports members, projects, tasks and one row per project (§6.1)", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const result = await overview(s);
    expect(result.today).toBe("2026-03-25");
    expect(result.members).toEqual({
      total: 5,
      byRole: [
        { role: "owner", count: 1 },
        { role: "admin", count: 1 },
        { role: "member", count: 2 },
        { role: "viewer", count: 1 },
      ],
    });
    expect(result.projects).toEqual({
      total: 2,
      withFeature: { cycles: 2, modules: 2, intake: 0, estimates: 1 },
    });
    expect(result.tasks).toEqual({
      total: 8,
      backlog: 1,
      unstarted: 2,
      started: 1,
      completed: 3,
      cancelled: 1,
      progress: 43,
      overdue: 1,
    });
    expect(result.projectRows).toEqual([
      {
        projectId: s.p1.id,
        total: 6,
        backlog: 1,
        unstarted: 1,
        started: 1,
        completed: 2,
        cancelled: 1,
        progress: 40,
        overdue: 0,
      },
      {
        projectId: s.p2.id,
        total: 2,
        backlog: 0,
        unstarted: 1,
        started: 0,
        completed: 1,
        cancelled: 0,
        progress: 50,
        overdue: 1,
      },
    ]);
    // Cycles and modules are on by default, with nothing in them yet.
    expect(result.cycles).toEqual({
      draft: 0,
      upcoming: 0,
      current: 0,
      completed: 0,
    });
    expect(result.modules?.total).toBe(0);
    expect(result.intake).toBeNull();
    expect(result.meta.projects.map((project) => project.slug)).toEqual([
      "web",
      "api",
    ]);
  });

  it("lists custom roles after the built-in ones", async () => {
    const s = await analyticsScene();
    await addPerson(s.workspaceId, "Zed", "auditor");
    await addPerson(s.workspaceId, "Abe", "accountant");
    const result = await overview(s);
    expect(result.members.byRole.map((row) => row.role)).toEqual([
      "owner",
      "admin",
      "member",
      "viewer",
      "accountant",
      "auditor",
    ]);
    expect(result.members.total).toBe(7);
  });

  it("narrows tasks and rows to the selected projects, not members", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const result = await overview(s, { projectIds: s.p2.id });
    expect(result.tasks.total).toBe(2);
    expect(result.projectRows.map((row) => row.projectId)).toEqual([s.p2.id]);
    expect(result.members.total).toBe(5);
    expect(result.projects.total).toBe(1);
  });

  it("leaves archived projects out unless listed", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    await setFlags(s.p2.id, { archivedAt: new Date() });
    const all = await overview(s);
    expect(all.projectRows.map((row) => row.projectId)).toEqual([s.p1.id]);
    expect(all.tasks.total).toBe(6);
    const listed = await overview(s, { projectIds: `${s.p1.id},${s.p2.id}` });
    expect(listed.tasks.total).toBe(8);
  });

  it("counts cycles, modules and intake when the features are on", async () => {
    const s = await analyticsScene();
    await setFlags(s.p1.id, { intakeEnabled: true });
    await db.insert(schema.cycleTable).values([
      {
        projectId: s.p1.id,
        name: "Now",
        startDate: "2026-03-20",
        endDate: "2026-03-30",
      },
      {
        projectId: s.p1.id,
        name: "Next",
        startDate: "2026-04-01",
        endDate: "2026-04-14",
      },
      { projectId: s.p2.id, name: "Draft" },
      {
        projectId: s.p1.id,
        name: "Done",
        startDate: "2026-03-01",
        endDate: "2026-03-14",
      },
      {
        projectId: s.p1.id,
        name: "Archived",
        startDate: "2026-02-01",
        endDate: "2026-02-14",
        archivedAt: new Date(),
      },
    ]);
    await db.insert(schema.moduleTable).values([
      { projectId: s.p1.id, name: "A", status: "in-progress" },
      { projectId: s.p2.id, name: "B", status: "in-progress" },
      { projectId: s.p1.id, name: "C", status: "backlog" },
      {
        projectId: s.p1.id,
        name: "D",
        status: "completed",
        archivedAt: new Date(),
      },
    ]);
    await intakeItem(s, "pending");
    // An expired snooze reads as pending.
    await intakeItem(s, "snoozed", {
      snoozedUntil: at("2020-01-01T00:00:00Z"),
    });
    await intakeItem(s, "accepted");
    await intakeItem(s, "declined");
    await intakeItem(s, "duplicate");

    const result = await overview(s);
    expect(result.cycles).toEqual({
      draft: 1,
      upcoming: 1,
      current: 1,
      completed: 1,
    });
    expect(result.modules).toEqual({
      total: 3,
      byStatus: {
        backlog: 1,
        planned: 0,
        "in-progress": 2,
        paused: 0,
        completed: 0,
        cancelled: 0,
      },
    });
    expect(result.intake).toEqual({
      open: 2,
      accepted: 1,
      declined: 1,
      duplicate: 1,
    });
    // Intake tasks sit in triage and never count as tasks.
    expect(result.tasks.total).toBe(0);

    // Features off: the sections disappear.
    await setFlags(s.p1.id, {
      intakeEnabled: false,
      cyclesEnabled: false,
      modulesEnabled: false,
    });
    await setFlags(s.p2.id, { cyclesEnabled: false, modulesEnabled: false });
    const off = await overview(s);
    expect(off.cycles).toBeNull();
    expect(off.modules).toBeNull();
    expect(off.intake).toBeNull();
  });

  it("hides sections the caller's role cannot read", async () => {
    const s = await analyticsScene();
    await setFlags(s.p1.id, { intakeEnabled: true });
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: s.workspaceId,
      role: "analyst",
      permission: JSON.stringify({
        workspace: ["read"],
        task: ["read"],
        analytics: ["read"],
      }),
    });
    const analyst = await addPerson(s.workspaceId, "Ana", "analyst");
    const result = await overview(s, {}, analyst);
    expect(result.cycles).toBeNull();
    expect(result.modules).toBeNull();
    expect(result.intake).toBeNull();
    expect(result.tasks.total).toBe(0);
  });
});
