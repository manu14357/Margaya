import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { projectMemberTable } from "../../apps/api/src/database/schema";
import {
  type AnalyticsScene,
  analyticsScene,
  at,
  freeze,
} from "./helpers/analytics";
import { addPerson } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";

// Per-person workload: estimates or task counts, restricted projects, and
// who gets the comparison with a person's usual.

type WorkloadJson = {
  unit: "tasks" | "points";
  usualDays: number;
  historyDays: number;
  members: Array<{
    userId: string | null;
    tasks: number;
    points: number;
    load: number;
    cells: Record<"backlog" | "unstarted" | "started", number>;
    check: {
      unit: "tasks" | "points";
      load: number;
      usual: number | null;
      status: "ok" | "over" | "unknown";
    } | null;
  }>;
  meta: { users: { id: string; name: string }[] };
};

function workload(
  s: AnalyticsScene,
  query: Record<string, string> = {},
  user = s.owner,
) {
  return s.ok<WorkloadJson>(s.get("/workload", query, user));
}

const memberOf = (result: WorkloadJson, userId: string | null) =>
  result.members.find((member) => member.userId === userId);

describe("API integration: analytics workload", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    freeze();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts open tasks per assignee when work is not sized", async () => {
    const s = await analyticsScene();
    await s.createTask({ assignees: [s.m1.id] });
    await s.createTask({ status: "in-progress", assignees: [s.m1.id] });
    await s.createTask({ assignees: [s.m1.id, s.m2.id] });
    await s.createTask({});
    await s.createTask({ status: "done", assignees: [s.m1.id] });
    await s.createTask({
      archivedAt: at("2026-03-20T00:00:00Z"),
      assignees: [s.m1.id],
    });

    const result = await workload(s);
    expect(result.unit).toBe("tasks");
    expect(result.usualDays).toBe(28);
    expect(result.historyDays).toBe(56);
    expect(result.members.map((member) => member.userId)).toEqual([
      s.m1.id,
      s.m2.id,
      null,
    ]);
    expect(memberOf(result, s.m1.id)).toMatchObject({
      tasks: 3,
      load: 3,
      cells: { unstarted: 2, started: 1, backlog: 0 },
    });
    expect(memberOf(result, null)).toMatchObject({ tasks: 1, check: null });
    expect(result.meta.users.map((user) => user.name).sort()).toEqual([
      "Ben",
      "Cara",
    ]);
  });

  it("uses estimate points when most open work is sized", async () => {
    const s = await analyticsScene();
    await s.createTask({ assignees: [s.m1.id], points: 8 });
    await s.createTask({ assignees: [s.m1.id], points: 5 });
    await s.createTask({ assignees: [s.m2.id], points: 3 });

    const result = await workload(s);
    expect(result.unit).toBe("points");
    expect(memberOf(result, s.m1.id)).toMatchObject({
      tasks: 2,
      points: 13,
      load: 13,
    });
  });

  it("falls back to task counts when estimates are off", async () => {
    const s = await analyticsScene();
    await s.createTask({ assignees: [s.m1.id], points: 8 });
    await db
      .update(schema.projectTable)
      .set({ estimatesEnabled: false })
      .where(eq(schema.projectTable.id, s.p1.id));

    const result = await workload(s);
    expect(result.unit).toBe("tasks");
    expect(memberOf(result, s.m1.id)).toMatchObject({ load: 1, points: 0 });
  });

  it("flags who is over what they usually finish, from recent history only", async () => {
    const s = await analyticsScene();
    const finished = (assignee: string, completedAt: string) =>
      s.createTask({
        status: "done",
        assignees: [assignee],
        completedAt: at(completedAt),
      });
    // Ben finished 4 in the last eight weeks: 2 in a usual four weeks.
    await finished(s.m1.id, "2026-03-20T00:00:00Z");
    await finished(s.m1.id, "2026-03-10T00:00:00Z");
    await finished(s.m1.id, "2026-02-10T00:00:00Z");
    await finished(s.m1.id, "2026-02-01T00:00:00Z");
    // Older than the history: not counted.
    await finished(s.m1.id, "2025-12-01T00:00:00Z");
    await s.createTask({ assignees: [s.m1.id] });
    await s.createTask({ assignees: [s.m1.id] });
    await s.createTask({ assignees: [s.m1.id] });
    // Cara has no history: unknown, never over.
    await s.createTask({ assignees: [s.m2.id] });

    const result = await workload(s);
    expect(memberOf(result, s.m1.id)?.check).toEqual({
      unit: "tasks",
      load: 3,
      usual: 2,
      status: "over",
    });
    expect(memberOf(result, s.m2.id)?.check).toEqual({
      unit: "tasks",
      load: 1,
      usual: null,
      status: "unknown",
    });
  });

  it("counts finished work that was archived later", async () => {
    const s = await analyticsScene();
    await s.createTask({
      status: "done",
      assignees: [s.m1.id],
      completedAt: at("2026-03-20T00:00:00Z"),
      archivedAt: at("2026-03-21T00:00:00Z"),
    });
    await s.createTask({
      status: "done",
      assignees: [s.m1.id],
      completedAt: at("2026-03-19T00:00:00Z"),
      archivedAt: at("2026-03-21T00:00:00Z"),
    });
    await s.createTask({ assignees: [s.m1.id] });
    const result = await workload(s);
    expect(memberOf(result, s.m1.id)?.check).toMatchObject({
      usual: 1,
      status: "ok",
    });
  });

  it("follows the scope and hides restricted projects from who can't see them", async () => {
    const s = await analyticsScene();
    await s.createTask({ assignees: [s.m1.id] });
    await s.createTask({ projectId: s.p2.id, assignees: [s.m1.id] });
    await s.createTask({ projectId: s.p2.id, assignees: [s.m2.id] });

    const scoped = await workload(s, { projectIds: s.p1.id });
    expect(memberOf(scoped, s.m1.id)?.tasks).toBe(1);
    expect(memberOf(scoped, s.m2.id)).toBeUndefined();

    // P2 restricted, with Cara the only member: Ben loses it, Cara keeps it.
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.p2.id));
    await db
      .insert(projectMemberTable)
      .values({ projectId: s.p2.id, userId: s.m2.id });

    const asBen = await workload(s, {}, s.m1);
    expect(memberOf(asBen, s.m1.id)?.tasks).toBe(1);
    expect(memberOf(asBen, s.m2.id)).toBeUndefined();
    expect(asBen.meta.users.map((user) => user.name)).toEqual(["Ben"]);

    const asCara = await workload(s, {}, s.m2);
    expect(memberOf(asCara, s.m1.id)?.tasks).toBe(2);
    expect(memberOf(asCara, s.m2.id)?.tasks).toBe(1);

    // Naming the hidden project answers like an unknown one.
    await s.fails(s.get("/workload", { projectIds: s.p2.id }, s.m1), 404);
  });

  it("gives the comparison to whoever may read analytics, from the projects they can see", async () => {
    const s = await analyticsScene();
    await s.createTask({ assignees: [s.m1.id] });
    // Ben finished one task in P1 and one in P2 within the history.
    for (const projectId of [s.p1.id, s.p2.id]) {
      await s.createTask({
        projectId,
        status: "done",
        assignees: [s.m1.id],
        completedAt: at("2026-03-20T00:00:00Z"),
      });
    }

    await s.fails(s.get("/workload", {}, s.viewer), 403);

    // A custom role that reads analytics but can't update cycles: the
    // comparison is an analytics read like the rest of the card.
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: s.workspaceId,
      role: "reporter",
      permission: JSON.stringify({
        workspace: ["read"],
        project: ["read"],
        task: ["read"],
        analytics: ["read"],
        cycle: ["read"],
      }),
    });
    const reporter = await addPerson(s.workspaceId, "Rita", "reporter");
    expect(memberOf(await workload(s, {}, reporter), s.m1.id)).toMatchObject({
      tasks: 1,
      check: { usual: 1 },
    });

    // P2 restricted to Cara: Rita's comparison no longer counts what Ben
    // finished there, Cara's still does.
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.p2.id));
    await db
      .insert(projectMemberTable)
      .values({ projectId: s.p2.id, userId: s.m2.id });
    expect(
      memberOf(await workload(s, {}, reporter), s.m1.id)?.check,
    ).toMatchObject({ usual: 0.5 });
    expect(memberOf(await workload(s, {}, s.m2), s.m1.id)?.check).toMatchObject(
      { usual: 1 },
    );
  });
});
