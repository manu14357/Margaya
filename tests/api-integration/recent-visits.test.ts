import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

vi.mock(
  "../../apps/api/src/notification/controllers/create-notification",
  () => ({ default: vi.fn(async () => null) }),
);

type RecentVisit = {
  entityType: string;
  entityId: string;
  projectId: string | null;
  visitedAt: string;
  entity: { name: string; key: string | null; details: unknown };
};

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function context() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    slug: "rv",
    name: "Recents",
  });
  mockAuthenticatedSession(owner.user);
  const { app } = createApp();
  const workspaceId = owner.workspace.id;

  const record = (entityId: string, entityType = "task") =>
    app.request(
      "/api/recent-visit",
      json("POST", { workspaceId, entityType, entityId }),
    );
  const list = async (query = "") => {
    const response = await app.request(
      `/api/recent-visit?workspaceId=${workspaceId}${query}`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as RecentVisit[];
  };
  const task = async (number: number) => {
    const [row] = await db
      .insert(schema.taskTable)
      .values({ projectId: project.id, title: `Task ${number}`, number })
      .returning();
    return row;
  };
  const rows = () =>
    db
      .select()
      .from(schema.recentVisitTable)
      .where(eq(schema.recentVisitTable.userId, owner.user.id));

  return { ...owner, app, project, workspaceId, record, list, task, rows };
}

async function backdateVisit(userId: string, entityId: string, at: Date) {
  await db
    .update(schema.recentVisitTable)
    .set({ visitedAt: at })
    .where(
      and(
        eq(schema.recentVisitTable.userId, userId),
        eq(schema.recentVisitTable.entityId, entityId),
      ),
    );
}

async function waitFor(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition not met in time");
}

describe("API integration: recent visits", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("records a visit once and bumps it on revisit", async () => {
    const { record, rows, project, user } = await context();

    const first = await record(project.id, "project");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
      entity: { name: "Recents", key: "rv" },
    });

    const past = new Date("2026-01-01T00:00:00.000Z");
    await backdateVisit(user.id, project.id, past);
    await record(project.id, "project");

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.visitedAt.getTime()).toBeGreaterThan(past.getTime());
  });

  it("keeps the 20 most recent visits", async () => {
    const { record, rows, task, user } = await context();
    const tasks = [];
    for (let number = 1; number <= 21; number++) tasks.push(await task(number));

    for (const [index, entry] of tasks.slice(0, 20).entries()) {
      expect((await record(entry.id)).status).toBe(200);
      await backdateVisit(
        user.id,
        entry.id,
        new Date(Date.UTC(2026, 0, 1, 0, index)),
      );
    }
    await record(tasks[20]?.id as string);

    const stored = await rows();
    expect(stored).toHaveLength(20);
    expect(stored.map((row) => row.entityId)).not.toContain(tasks[0]?.id);
  });

  it("lists newest first and filters by type and limit", async () => {
    const { record, list, task, project, user } = await context();
    const older = await task(1);
    const newer = await task(2);
    await record(older.id);
    await record(newer.id);
    await record(project.id, "project");
    await backdateVisit(user.id, older.id, new Date("2026-01-01T00:00:00Z"));
    await backdateVisit(user.id, newer.id, new Date("2026-01-02T00:00:00Z"));
    await backdateVisit(user.id, project.id, new Date("2026-01-03T00:00:00Z"));

    expect((await list()).map((visit) => visit.entityId)).toEqual([
      project.id,
      newer.id,
      older.id,
    ]);
    expect(
      (await list("&entityType=task")).map((visit) => visit.entityId),
    ).toEqual([newer.id, older.id]);
    expect((await list("&limit=1")).map((visit) => visit.entityId)).toEqual([
      project.id,
    ]);

    const [taskVisit] = await list("&entityType=task&limit=1");
    expect(taskVisit?.entity).toMatchObject({
      key: "rv-2",
      details: { group: "unstarted", status: "to-do" },
    });
  });

  it("refuses tasks from other workspaces and unsupported types", async () => {
    const { record } = await context();
    const other = await createWorkspaceMember();
    const { project: foreign } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    const [foreignTask] = await db
      .insert(schema.taskTable)
      .values({ projectId: foreign.id, title: "Foreign", number: 1 })
      .returning();

    const crossWorkspace = await record(foreignTask.id);
    expect(crossWorkspace.status).toBe(404);

    // Pages have a resolver now: an unknown one reads as missing.
    const page = await record("some-page", "page");
    expect(page.status).toBe(404);
  });

  it("forgets deleted tasks and follows moved ones", async () => {
    const { app, record, rows, task, workspace } = await context();
    const deleted = await task(1);
    const moved = await task(2);
    await record(deleted.id);
    await record(moved.id);

    const removal = await app.request(`/api/task/${deleted.id}`, {
      method: "DELETE",
    });
    expect(removal.status).toBe(200);
    // Deleting trashes the task (C7); the permanent delete forgets it.
    const purge = await app.request(`/api/trash/task/${deleted.id}`, {
      method: "DELETE",
    });
    expect(purge.status).toBe(200);
    await waitFor(async () =>
      (await rows()).every((row) => row.entityId !== deleted.id),
    );

    const { project: destination } = await createProjectFixture({
      workspaceId: workspace.id,
      slug: "dest",
    });
    const move = await app.request(
      `/api/task/move/${moved.id}`,
      json("PUT", { destinationProjectId: destination.id }),
    );
    expect(move.status).toBe(200);
    await waitFor(async () =>
      (await rows()).some(
        (row) => row.entityId === moved.id && row.projectId === destination.id,
      ),
    );
  });

  it("hides visits of archived projects", async () => {
    const { record, list, project, task } = await context();
    const visited = await task(1);
    await record(visited.id);
    await record(project.id, "project");

    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    expect(await list()).toEqual([]);
    expect((await record(project.id, "project")).status).toBe(409);
  });
});
