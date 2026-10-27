import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  flushApiRequestLog,
  runApiRequestLogRetention,
} from "../../apps/api/src/api-key/request-log";
import { encodeScope } from "../../apps/api/src/api-key/scope";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { createApiKey } from "./helpers/api-keys";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { ORIGIN, signUpWithSession } from "./helpers/instance-admin";

// 4.10: API keys limited to reading, to chosen areas and to chosen
// projects, plus the per-key request log. Keys without a scope keep full
// access.

type App = ReturnType<typeof createApp>["app"];

async function seed() {
  const { user, workspace } = await createWorkspaceMember({ role: "admin" });
  const { project: allowed } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Allowed",
    slug: "allowed",
  });
  const { project: other } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Other",
    slug: "other",
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: other.id,
      title: "Elsewhere",
      status: "to-do",
      number: 500,
    })
    .returning();
  if (!task) throw new Error("no task");
  const { app } = createApp();
  return { user, workspace, allowed, other, task, app };
}

function call(
  app: App,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  return app.request(path, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const newTask = {
  title: "From a key",
  description: "",
  priority: "low",
  status: "to-do",
};

describe("scoped API keys", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lets a read-only key read and refuses every write with 403", async () => {
    const s = await seed();
    const key = await createApiKey(
      s.user,
      encodeScope({ access: "read" }) ?? undefined,
    );

    const list = await call(
      s.app,
      "GET",
      `/api/project?workspaceId=${s.workspace.id}`,
      key.headers,
    );
    expect(list.status).toBe(200);
    expect(
      (await call(s.app, "GET", `/api/task/tasks/${s.allowed.id}`, key.headers))
        .status,
    ).toBe(200);

    const create = await call(
      s.app,
      "POST",
      `/api/task/${s.allowed.id}`,
      key.headers,
      newTask,
    );
    expect(create.status).toBe(403);
    const rename = await call(
      s.app,
      "PUT",
      `/api/project/${s.allowed.id}`,
      key.headers,
      { name: "Renamed", icon: "Folder", slug: "allowed" },
    );
    expect(rename.status).toBe(403);
    // Writes outside any permission check are refused too.
    const favorite = await call(s.app, "POST", "/api/favorite", key.headers, {
      workspaceId: s.workspace.id,
      entityType: "project",
      entityId: s.allowed.id,
    });
    expect(favorite.status).toBe(403);
    const [stillOne] = await db
      .select({ name: schema.projectTable.name })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, s.allowed.id));
    expect(stillOne?.name).toBe("Allowed");
  });

  it("limits a custom key to its areas", async () => {
    const s = await seed();
    const key = await createApiKey(
      s.user,
      encodeScope({
        access: "custom",
        areas: { task: "write", project: "read" },
      }) ?? undefined,
    );
    expect(
      (
        await call(
          s.app,
          "POST",
          `/api/task/${s.allowed.id}`,
          key.headers,
          newTask,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(s.app, "PUT", `/api/project/${s.allowed.id}`, key.headers, {
          name: "Renamed",
          icon: "Folder",
          slug: "allowed",
        })
      ).status,
    ).toBe(403);
  });

  it("answers 404 for projects outside a project-scoped key", async () => {
    const s = await seed();
    const key = await createApiKey(
      s.user,
      encodeScope({ access: "full", projectIds: [s.allowed.id] }) ?? undefined,
    );

    expect(
      (await call(s.app, "GET", `/api/project/${s.allowed.id}`, key.headers))
        .status,
    ).toBe(200);
    expect(
      (await call(s.app, "GET", `/api/project/${s.other.id}`, key.headers))
        .status,
    ).toBe(404);
    expect(
      (await call(s.app, "GET", `/api/task/tasks/${s.other.id}`, key.headers))
        .status,
    ).toBe(404);
    expect(
      (await call(s.app, "GET", `/api/task/${s.task.id}`, key.headers)).status,
    ).toBe(404);
    expect(
      (
        await call(
          s.app,
          "POST",
          `/api/task/${s.other.id}`,
          key.headers,
          newTask,
        )
      ).status,
    ).toBe(404);
    // Writes inside the project still work: the key is not read-only.
    expect(
      (
        await call(
          s.app,
          "POST",
          `/api/task/${s.allowed.id}`,
          key.headers,
          newTask,
        )
      ).status,
    ).toBe(200);

    // The project list shows only the key's projects.
    const list = await call(
      s.app,
      "GET",
      `/api/project?workspaceId=${s.workspace.id}`,
      key.headers,
    );
    expect(list.status).toBe(200);
    const projects = (await list.json()) as { id: string }[];
    expect(projects.map((project) => project.id)).toEqual([s.allowed.id]);

    // Workspace-wide routes that can't narrow their answer are refused.
    const search = await call(
      s.app,
      "GET",
      `/api/search?q=Elsewhere&workspaceId=${s.workspace.id}`,
      key.headers,
    );
    expect(search.status).toBe(403);
  });

  it("keeps full access for keys created before scoping", async () => {
    const s = await seed();
    const key = await createApiKey(s.user);
    expect(
      (await call(s.app, "GET", `/api/project/${s.other.id}`, key.headers))
        .status,
    ).toBe(200);
    expect(
      (
        await call(
          s.app,
          "POST",
          `/api/task/${s.other.id}`,
          key.headers,
          newTask,
        )
      ).status,
    ).toBe(200);
  });

  it("refuses scoped keys on the Better Auth routes", async () => {
    const s = await seed();
    const scoped = await createApiKey(
      s.user,
      encodeScope({ access: "read" }) ?? undefined,
    );
    const response = await s.app.request("/api/auth/api-key/list", {
      headers: { "x-api-key": scoped.key, Origin: ORIGIN },
    });
    expect(response.status).toBe(403);
  });

  it("creates a scoped key for a session and lists its scope", async () => {
    const { app } = createApp();
    const { cookie, user } = await signUpWithSession(app, "owner@example.com");
    const { workspace } = await createWorkspaceMember({ role: "member" });
    await db
      .update(schema.workspaceUserTable)
      .set({ userId: user.id })
      .where(eq(schema.workspaceUserTable.workspaceId, workspace.id));
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
      name: "Scoped",
      slug: "scoped",
    });

    const created = await app.request("/api/api-key", {
      method: "POST",
      headers: { cookie, Origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        name: "CI",
        expiresIn: null,
        access: "read",
        projectIds: [project.id],
      }),
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as {
      id: string;
      key: string;
      scope: { access: string; projects: { id: string; name: string }[] };
    };
    expect(body.key).toBeTruthy();
    expect(body.scope.access).toBe("read");
    expect(body.scope.projects).toEqual([{ id: project.id, name: "Scoped" }]);

    // The key works only on its project, and only for reads.
    const read = await app.request(`/api/project/${project.id}`, {
      headers: { "x-api-key": body.key },
    });
    expect(read.status).toBe(200);

    const list = await app.request("/api/api-key", { headers: { cookie } });
    expect(list.status).toBe(200);
    const keys = (await list.json()) as {
      id: string;
      scope: { access: string };
    }[];
    expect(keys).toEqual([
      expect.objectContaining({
        id: body.id,
        scope: expect.objectContaining({ access: "read" }),
      }),
    ]);

    // A project the caller can't reach is refused.
    const { project: foreign } = await createProjectFixture({
      workspaceId: (await createWorkspaceMember()).workspace.id,
      slug: "foreign",
    });
    const refused = await app.request("/api/api-key", {
      method: "POST",
      headers: { cookie, Origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Bad",
        expiresIn: null,
        access: "full",
        projectIds: [foreign.id],
      }),
    });
    expect(refused.status).toBe(400);

    // Keys can't manage keys.
    const viaKey = await app.request("/api/api-key", {
      headers: { "x-api-key": body.key },
    });
    expect(viaKey.status).toBe(403);
  });

  it("logs each key request without paths, bodies or query strings", async () => {
    const s = await seed();
    const key = await createApiKey(
      s.user,
      encodeScope({ access: "read" }) ?? undefined,
    );
    await call(
      s.app,
      "GET",
      `/api/project?workspaceId=${s.workspace.id}&secret=hunter2`,
      key.headers,
    );
    await call(s.app, "GET", `/api/project/${s.allowed.id}`, key.headers);
    await call(
      s.app,
      "POST",
      `/api/task/${s.allowed.id}`,
      key.headers,
      newTask,
    );
    await flushApiRequestLog();

    const rows = await db
      .select()
      .from(schema.apiRequestLogTable)
      .where(eq(schema.apiRequestLogTable.apiKeyId, key.id));
    expect(rows).toHaveLength(3);
    const routes = rows.map(
      (row) => `${row.method} ${row.route} ${row.status}`,
    );
    expect(routes).toEqual(
      expect.arrayContaining([
        "GET /api/project 200",
        "GET /api/project/:id 200",
        "POST /api/task/:projectId 403",
      ]),
    );
    for (const row of rows) {
      expect(row.route).not.toContain(s.allowed.id);
      expect(row.route).not.toContain("hunter2");
      expect(row.durationMs).toBeGreaterThanOrEqual(0);
    }

    // Only the owner reads it, through a session.
    const { app } = s;
    const { cookie } = await signUpWithSession(
      app,
      `viewer-${randomUUID()}@example.com`,
    );
    const foreign = await app.request(`/api/api-key/${key.id}/requests`, {
      headers: { cookie },
    });
    expect(foreign.status).toBe(404);

    // Retention drops rows older than the window.
    await db
      .update(schema.apiRequestLogTable)
      .set({ createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.apiRequestLogTable.apiKeyId, key.id));
    const outcome = await runApiRequestLogRetention();
    expect(outcome.deleted).toBe(3);
  });

  it("shows the owner their key's requests", async () => {
    const { app } = createApp();
    const { cookie, user } = await signUpWithSession(app, "logs@example.com");
    const key = await createApiKey({ id: user.id });
    await app.request("/api/notification?workspaceId=none", {
      headers: key.headers,
    });
    const response = await app.request(`/api/api-key/${key.id}/requests`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      items: { method: string; route: string }[];
    };
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    expect(page.items[0]?.method).toBe("GET");
  });
});
