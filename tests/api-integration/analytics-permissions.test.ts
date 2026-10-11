import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { backfillRolePermissions } from "../../apps/api/src/utils/backfill-role-permissions";
import {
  type AnalyticsScene,
  analyticsScene,
  freeze,
  json,
  seedCanonical,
} from "./helpers/analytics";
import { addPerson } from "./helpers/assignees";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Who may read analytics (B8 §1.9, K11, D12).

type User = typeof schema.userTable.$inferSelect;

const RANGE = { from: "2026-03-01", to: "2026-03-31", bucket: "week" };

/** A request per route, as `user`. */
function routes(s: AnalyticsScene) {
  return {
    overview: (user: User) => s.get("/overview", {}, user),
    chart: (user: User) => s.post("/chart", { xAxis: "group" }, user),
    trend: (user: User) => s.post("/trend", RANGE, user),
    cycles: (user: User) => s.get("/cycles", {}, user),
    modules: (user: User) => s.get("/modules", {}, user),
    intake: (user: User) => s.get("/intake", RANGE, user),
  };
}

async function customRole(
  s: AnalyticsScene,
  role: string,
  permission: Record<string, string[]>,
) {
  await db.insert(schema.workspaceRoleTable).values({
    workspaceId: s.workspaceId,
    role,
    permission: JSON.stringify(permission),
  });
  return addPerson(s.workspaceId, role, role);
}

describe("API integration: analytics permissions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    freeze();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets members, admins and owners in and keeps viewers out", async () => {
    const s = await analyticsScene();
    for (const [name, call] of Object.entries(routes(s))) {
      for (const user of [s.m1, s.admin, s.owner]) {
        expect((await call(user)).status, `${name} as ${user.name}`).toBe(200);
      }
      const denied = await call(s.viewer);
      expect(denied.status, name).toBe(403);
      expect(await denied.text()).toBe("Insufficient permissions");
    }
  });

  it("needs the tab's own read permission on top of analytics", async () => {
    const s = await analyticsScene();
    const analyst = await customRole(s, "analyst", {
      workspace: ["read"],
      task: ["read"],
      analytics: ["read"],
    });
    const calls = routes(s);
    expect((await calls.overview(analyst)).status).toBe(200);
    expect((await calls.chart(analyst)).status).toBe(200);
    expect((await calls.trend(analyst)).status).toBe(200);
    expect((await calls.cycles(analyst)).status).toBe(403);
    expect((await calls.modules(analyst)).status).toBe(403);
    expect((await calls.intake(analyst)).status).toBe(403);

    const planner = await customRole(s, "planner", {
      workspace: ["read"],
      task: ["read"],
      analytics: ["read"],
      cycle: ["read"],
    });
    expect((await calls.cycles(planner)).status).toBe(200);

    const reader = await customRole(s, "reader", {
      workspace: ["read"],
      task: ["read"],
      cycle: ["read"],
    });
    expect((await calls.chart(reader)).status).toBe(403);
    expect((await calls.cycles(reader)).status).toBe(403);
  });

  it("honors API key statements", async () => {
    const s = await analyticsScene();
    const keyFor = async (permissions: Record<string, string[]>) => {
      const key = `margaya_test_${randomUUID()}`;
      await db.insert(schema.apikeyTable).values({
        referenceId: s.owner.id,
        userId: s.owner.id,
        key: createHash("sha256").update(key).digest("base64url"),
        name: "analytics",
        createdAt: new Date(),
        updatedAt: new Date(),
        permissions: JSON.stringify(permissions),
        enabled: true,
      });
      return key;
    };
    mockAnonymousSession();
    const call = (key: string) =>
      s.app.request("/api/analytics/chart", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ workspaceId: s.workspaceId, xAxis: "group" }),
      });
    const allowed = await call(
      await keyFor({ task: ["read"], analytics: ["read"] }),
    );
    expect(allowed.status).toBe(200);
    const taskOnly = await call(await keyFor({ task: ["read"] }));
    expect(taskOnly.status).toBe(403);
    expect(await taskOnly.text()).toBe("Insufficient API key scope");
  });

  it("refuses outsiders, anonymous callers and other workspaces' projects", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const outsider = await createWorkspaceMember({ userName: "Oz" });
    const { project: foreign } = await createProjectFixture({
      workspaceId: outsider.workspace.id,
    });
    await db.insert(schema.taskTable).values({
      projectId: foreign.id,
      title: "Secret",
      number: 1,
      status: "to-do",
    });

    expect((await routes(s).chart(outsider.user)).status).toBe(403);
    expect((await routes(s).overview(outsider.user)).status).toBe(403);

    mockAnonymousSession();
    const anonymous = await s.app.request(
      "/api/analytics/chart",
      json("POST", { workspaceId: s.workspaceId, xAxis: "group" }),
    );
    expect(anonymous.status).toBe(401);

    await s.fails(
      s.post(
        "/chart",
        { xAxis: "group", scope: { projectIds: [s.p1.id, foreign.id] } },
        s.owner,
      ),
      404,
      "Project not found",
    );
    await s.fails(
      s.get("/cycles", { projectIds: foreign.id }, s.owner),
      404,
      "Project not found",
    );

    // The outsider's own analytics never see this workspace's tasks.
    mockAuthenticatedSession(outsider.user);
    const theirs = await s.app.request(
      "/api/analytics/chart",
      json("POST", { workspaceId: outsider.workspace.id, xAxis: "project" }),
    );
    expect(theirs.status).toBe(200);
    expect(((await theirs.json()) as { totalCount: number }).totalCount).toBe(
      1,
    );
  });

  it("backfills analytics into seeded member and admin rows once", async () => {
    const s = await analyticsScene();
    // Rows as seeded before analytics existed.
    const legacy = {
      viewer: { project: ["read"], task: ["read"], workspace: ["read"] },
      member: {
        project: ["create", "read"],
        task: ["create", "read", "update"],
        workspace: ["read"],
      },
      admin: {
        project: ["create", "read", "update", "delete", "share"],
        task: ["create", "read", "update", "delete", "assign"],
        workspace: ["read", "update", "manage_settings"],
      },
    };
    await db.insert(schema.workspaceRoleTable).values(
      Object.entries(legacy).map(([role, permission]) => ({
        workspaceId: s.workspaceId,
        role,
        permission: JSON.stringify(permission),
      })),
    );
    // The stored member row wins: no analytics yet.
    expect((await routes(s).chart(s.m1)).status).toBe(403);

    const result = await backfillRolePermissions();
    expect(result?.pending).toContain("analytics");
    const rows = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, s.workspaceId));
    const stored = Object.fromEntries(
      rows.map((row) => [row.role, JSON.parse(row.permission)]),
    ) as Record<string, Record<string, string[]>>;
    expect(stored.member?.analytics).toEqual(["read"]);
    expect(stored.admin?.analytics).toEqual(["read"]);
    expect(stored.viewer).not.toHaveProperty("analytics");

    expect((await routes(s).chart(s.m1)).status).toBe(200);
    expect((await routes(s).chart(s.viewer)).status).toBe(403);
    expect(await backfillRolePermissions()).toBeNull();
  });
});
