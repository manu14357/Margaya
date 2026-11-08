import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAiGatewayState } from "../../apps/api/src/ai/gateway";
import { setFakeResponder } from "../../apps/api/src/ai/provider/fake";
import type { ChatRequest } from "../../apps/api/src/ai/types";
import {
  flushApiRequestLog,
  runApiRequestLogRetention,
} from "../../apps/api/src/api-key/request-log";
import { encodeScope } from "../../apps/api/src/api-key/scope";
import db, { schema } from "../../apps/api/src/database";
import {
  pageTemplateTable,
  workspaceAiSettingTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { createApiKey } from "./helpers/api-keys";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
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

  it("treats a linked task outside a project-limited key as missing", async () => {
    const s = await seed();
    const [own, second] = await db
      .insert(schema.taskTable)
      .values([
        { projectId: s.allowed.id, title: "Inside", number: 1 },
        { projectId: s.allowed.id, title: "Also inside", number: 2 },
      ])
      .returning();
    if (!own || !second) throw new Error("no tasks");
    const [linked] = await db
      .insert(schema.taskRelationTable)
      .values({
        sourceTaskId: own.id,
        targetTaskId: s.task.id,
        relationType: "blocks",
      })
      .returning();
    if (!linked) throw new Error("no relation");
    const key = await createApiKey(
      s.user,
      encodeScope({ access: "full", projectIds: [s.allowed.id] }) ?? undefined,
    );

    const read = await call(
      s.app,
      "GET",
      `/api/task-relation/${own.id}`,
      key.headers,
    );
    expect(read.status).toBe(200);
    const relations = await read.text();
    expect(relations).not.toContain("Elsewhere");
    expect(JSON.parse(relations)).toEqual([]);

    for (const relationType of ["related", "blocks", "blocked_by"]) {
      const link = await call(
        s.app,
        "POST",
        "/api/task-relation",
        key.headers,
        {
          sourceTaskId: second.id,
          targetTaskId: s.task.id,
          relationType,
        },
      );
      expect(link.status, relationType).toBe(404);
      expect(await link.text()).toBe("Target task not found");
    }

    // Unlinking would clear the other project's task, so it reads as missing.
    const unlink = await call(
      s.app,
      "DELETE",
      `/api/task-relation/${linked.id}`,
      key.headers,
    );
    expect(unlink.status).toBe(404);
    expect(await db.select().from(schema.taskRelationTable)).toHaveLength(1);

    // Inside the key, and with an unlimited key, links work as ever.
    const inside = await call(
      s.app,
      "POST",
      "/api/task-relation",
      key.headers,
      { sourceTaskId: own.id, targetTaskId: second.id, relationType: "blocks" },
    );
    expect(inside.status, await inside.clone().text()).toBe(200);
    const unlimited = await createApiKey(s.user);
    const all = await call(
      s.app,
      "GET",
      `/api/task-relation/${own.id}`,
      unlimited.headers,
    );
    expect(await all.json()).toHaveLength(2);
  });

  /** A task in the key's project, blocked by the task outside it. */
  async function blockedInsideKey(s: Awaited<ReturnType<typeof seed>>) {
    const [own] = await db
      .insert(schema.taskTable)
      .values({
        projectId: s.allowed.id,
        title: "Inside",
        status: "to-do",
        number: 1,
      })
      .returning();
    if (!own) throw new Error("no task");
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: s.task.id,
      targetTaskId: own.id,
      relationType: "blocks",
    });
    const limited = await createApiKey(
      s.user,
      encodeScope({ access: "full", projectIds: [s.allowed.id] }) ?? undefined,
    );
    const unlimited = await createApiKey(s.user);
    return { own, limited, unlimited };
  }

  it("names no task outside a project-limited key in risks", async () => {
    const s = await seed();
    const { own, limited, unlimited } = await blockedInsideKey(s);
    const [cycle] = await db
      .insert(schema.cycleTable)
      .values({ projectId: s.allowed.id, name: "Sprint" })
      .returning();
    const [module] = await db
      .insert(schema.moduleTable)
      .values({ projectId: s.allowed.id, name: "Launch" })
      .returning();
    if (!cycle || !module) throw new Error("Failed to seed the scopes");
    await db
      .insert(schema.cycleTaskTable)
      .values({ taskId: own.id, cycleId: cycle.id });
    await db
      .insert(schema.moduleTaskTable)
      .values({ taskId: own.id, moduleId: module.id });

    for (const path of [
      `/api/delivery/project/${s.allowed.id}/risks`,
      `/api/delivery/cycle/${cycle.id}/risks`,
      `/api/delivery/module/${module.id}/risks`,
    ]) {
      const risks = await call(s.app, "GET", path, limited.headers);
      const text = await risks.text();
      expect(risks.status, `${path} ${text}`).toBe(200);
      expect(text, path).not.toContain("Elsewhere");
      expect(text, path).not.toContain(s.task.id);
      // The same blocker is named without the limit, so the limit is the fence.
      const full = await call(s.app, "GET", path, unlimited.headers);
      expect(await full.text(), path).toContain("Elsewhere");
    }
  });

  it("names no task outside a project-limited key in a coding agent brief", async () => {
    const s = await seed();
    const { own, limited, unlimited } = await blockedInsideKey(s);
    const [integration] = await db
      .insert(schema.integrationTable)
      .values({
        projectId: s.allowed.id,
        type: "github",
        config: JSON.stringify({
          repositoryOwner: "acme",
          repositoryName: "web",
          installationId: 10,
          repositoryId: 20,
          verifiedGithubAccountId: "30",
          verifiedByUserId: s.user.id,
          branchPattern: "{slug}-{number}",
        }),
      })
      .returning();
    if (!integration) throw new Error("Failed to seed the integration");

    const brief = (headers: Record<string, string>) =>
      call(s.app, "POST", `/api/coding-agent/task/${own.id}/brief`, headers, {
        integrationId: integration.id,
      });
    const limitedBrief = await brief(limited.headers);
    const limitedText = await limitedBrief.text();
    expect(limitedBrief.status, limitedText).toBe(200);
    expect(limitedText).not.toContain("Elsewhere");
    expect(JSON.parse(limitedText).relatedTasks).toBe(0);
    expect(await (await brief(unlimited.headers)).text()).toContain(
      "Elsewhere",
    );
  });

  it("doesn't count a blocker outside a project-limited key as blocking", async () => {
    const s = await seed();
    const [own, alsoWaiting, blockerInside] = await db
      .insert(schema.taskTable)
      .values(
        ["Waiting", "Also waiting", "Blocker inside"].map((title, index) => ({
          projectId: s.allowed.id,
          title,
          status: "to-do",
          number: index + 1,
        })),
      )
      .returning();
    if (!own || !alsoWaiting || !blockerInside) throw new Error("no tasks");
    await db.insert(schema.taskRelationTable).values([
      {
        sourceTaskId: s.task.id,
        targetTaskId: own.id,
        relationType: "blocks",
      },
      {
        sourceTaskId: blockerInside.id,
        targetTaskId: alsoWaiting.id,
        relationType: "blocks",
      },
    ]);
    const limited = await createApiKey(
      s.user,
      encodeScope({ access: "full", projectIds: [s.allowed.id] }) ?? undefined,
    );
    const unlimited = await createApiKey(s.user);
    const blockedIds = async (headers: Record<string, string>) => {
      const response = await call(
        s.app,
        "GET",
        `/api/task-relation/project/${s.allowed.id}`,
        headers,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as { blockedTaskIds: string[] };
      return [...body.blockedTaskIds].sort();
    };

    expect(await blockedIds(limited.headers)).toEqual([alsoWaiting.id]);
    expect(await blockedIds(unlimited.headers)).toEqual(
      [own.id, alsoWaiting.id].sort(),
    );
  });

  it("won't move a draft to a project outside a project-limited key", async () => {
    const s = await seed();
    const [draft] = await db
      .insert(schema.taskDraftTable)
      .values({
        workspaceId: s.workspace.id,
        projectId: s.allowed.id,
        createdBy: s.user.id,
        title: "Draft",
      })
      .returning();
    if (!draft) throw new Error("no draft");
    const key = await createApiKey(
      s.user,
      encodeScope({ access: "full", projectIds: [s.allowed.id] }) ?? undefined,
    );

    const moved = await call(
      s.app,
      "PATCH",
      `/api/task-draft/${draft.id}`,
      key.headers,
      { projectId: s.other.id },
    );
    expect(moved.status).toBe(404);
    const [stored] = await db
      .select({ projectId: schema.taskDraftTable.projectId })
      .from(schema.taskDraftTable)
      .where(eq(schema.taskDraftTable.id, draft.id));
    expect(stored?.projectId).toBe(s.allowed.id);

    const edited = await call(
      s.app,
      "PATCH",
      `/api/task-draft/${draft.id}`,
      key.headers,
      { title: "Still here" },
    );
    expect(edited.status, await edited.clone().text()).toBe(200);
  });

  it("won't move a page to a project outside a project-limited key", async () => {
    const s = await seed();
    const [page] = await db
      .insert(schema.pageTable)
      .values({
        workspaceId: s.workspace.id,
        projectId: s.allowed.id,
        title: "Movable",
        access: "public",
        ownerId: s.user.id,
      })
      .returning();
    if (!page) throw new Error("no page");
    const projectOfPage = async () => {
      const [row] = await db
        .select({ projectId: schema.pageTable.projectId })
        .from(schema.pageTable)
        .where(eq(schema.pageTable.id, page.id));
      return row?.projectId;
    };
    const limited = await createApiKey(
      s.user,
      encodeScope({ access: "full", projectIds: [s.allowed.id] }) ?? undefined,
    );

    const moved = await call(
      s.app,
      "POST",
      `/api/page/${page.id}/move`,
      limited.headers,
      { projectId: s.other.id },
    );
    expect(moved.status).toBe(404);
    expect(await projectOfPage()).toBe(s.allowed.id);

    const unlimited = await createApiKey(s.user);
    const allowed = await call(
      s.app,
      "POST",
      `/api/page/${page.id}/move`,
      unlimited.headers,
      { projectId: s.other.id },
    );
    expect(allowed.status, await allowed.clone().text()).toBe(200);
    expect(await projectOfPage()).toBe(s.other.id);
  });

  it("won't label a task outside a project-limited key", async () => {
    const s = await seed();
    const addTask = async (number: number) => {
      const [task] = await db
        .insert(schema.taskTable)
        .values({ projectId: s.allowed.id, title: "Mine", number })
        .returning();
      if (!task) throw new Error("no task");
      return task;
    };
    const mine = await addTask(600);
    const alsoMine = await addTask(601);
    const [label] = await db
      .insert(schema.labelTable)
      .values({
        name: "movable",
        color: "#112233",
        taskId: mine.id,
        workspaceId: s.workspace.id,
      })
      .returning();
    if (!label) throw new Error("no label");
    const labelsOn = async (taskId: string) =>
      (
        await db
          .select({ name: schema.labelTable.name })
          .from(schema.labelTable)
          .where(eq(schema.labelTable.taskId, taskId))
      ).map((row) => row.name);
    const key = await createApiKey(
      s.user,
      encodeScope({ access: "full", projectIds: [s.allowed.id] }) ?? undefined,
    );

    const moved = await call(
      s.app,
      "PUT",
      `/api/label/${label.id}/task`,
      key.headers,
      { taskId: s.task.id },
    );
    expect(moved.status).toBe(404);
    expect(await labelsOn(s.task.id)).toEqual([]);
    expect(await labelsOn(mine.id)).toEqual(["movable"]);

    const created = await call(s.app, "POST", "/api/label", key.headers, {
      workspaceId: s.workspace.id,
      name: "elsewhere",
      color: "#112233",
      taskId: s.task.id,
    });
    expect([403, 404]).toContain(created.status);
    expect(await labelsOn(s.task.id)).toEqual([]);

    const inside = await call(
      s.app,
      "PUT",
      `/api/label/${label.id}/task`,
      key.headers,
      { taskId: alsoMine.id },
    );
    expect(inside.status, await inside.clone().text()).toBe(200);
    expect(await labelsOn(alsoMine.id)).toEqual(["movable"]);
  });

  it("won't save a workspace template through a project-limited key", async () => {
    const s = await seed();
    const [page] = await db
      .insert(schema.pageTable)
      .values({
        workspaceId: s.workspace.id,
        projectId: s.allowed.id,
        title: "Source",
        access: "public",
        ownerId: s.user.id,
      })
      .returning();
    if (!page) throw new Error("no page");
    const save = (headers: Record<string, string>, scope: string) =>
      call(s.app, "POST", `/api/page/${page.id}/template`, headers, {
        name: `Template ${scope}`,
        scope,
      });
    const templates = () =>
      db
        .select({ projectId: pageTemplateTable.projectId })
        .from(pageTemplateTable);
    const limited = await createApiKey(
      s.user,
      encodeScope({ access: "full", projectIds: [s.allowed.id] }) ?? undefined,
    );

    expect((await save(limited.headers, "workspace")).status).toBe(403);
    expect(await templates()).toEqual([]);

    const own = await save(limited.headers, "project");
    expect(own.status, await own.clone().text()).toBe(200);
    expect(await templates()).toEqual([{ projectId: s.allowed.id }]);

    const unlimited = await createApiKey(s.user);
    const wide = await save(unlimited.headers, "workspace");
    expect(wide.status, await wide.clone().text()).toBe(200);
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

type Seed = Awaited<ReturnType<typeof seed>>;
type Headers = Record<string, string>;

type RetroBody = {
  counts: { blocked: number };
  blocked: {
    task: { id: string };
    blockers: { id: string }[];
    hiddenBlockers: number;
  }[];
};

type RisksBody = {
  hiddenBlockers: number;
  criticalPath: { taskIds: string[]; hiddenCount: number } | null;
  signals: {
    kind: string;
    headTaskId?: string | null;
    taskIds: string[];
    depth?: number;
  }[];
};

// A key limited to one project reads nothing about another one: not its
// tasks in AI context, nor even an unnamed count of its blockers. Members
// who can't see a project keep hearing that a hidden task holds theirs up.
describe("project-limited keys and the projects outside them", () => {
  const AI_ENV = ["MARGAYA_AI_ENABLED", "MARGAYA_AI_PROVIDER"] as const;

  beforeEach(async () => {
    await resetTestDatabase();
    resetAiGatewayState();
    resetRateLimitMemory();
  });

  afterEach(() => {
    for (const name of AI_ENV) delete process.env[name];
    setFakeResponder(null);
  });

  const limitedTo = (s: Seed) =>
    createApiKey(
      s.user,
      encodeScope({ access: "full", projectIds: [s.allowed.id] }) ?? undefined,
    );

  const DAY_MS = 24 * 60 * 60 * 1000;
  /** The calendar day `offset` days from today, as YYYY-MM-DD. */
  const day = (offset: number) =>
    new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

  /** One task per title, in order; throws unless all of them were made. */
  async function tasksIn(projectId: string, titles: string[]) {
    const tasks = await db
      .insert(schema.taskTable)
      .values(
        titles.map((title, index) => ({
          projectId,
          title,
          status: "to-do",
          number: index + 1,
        })),
      )
      .returning();
    if (tasks.length !== titles.length) throw new Error("no tasks");
    return tasks.map((task) => ({ id: task.id }));
  }

  function blocks(pairs: [{ id: string }, { id: string }][]) {
    return db.insert(schema.taskRelationTable).values(
      pairs.map(([blocker, blocked]) => ({
        sourceTaskId: blocker.id,
        targetTaskId: blocked.id,
        relationType: "blocks",
      })),
    );
  }

  /** The other project turns restricted; the new member isn't in it. */
  async function memberWithoutOther(s: Seed) {
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.other.id));
    return createApiKey(await addWorkspaceMember(s.workspace.id, "member"));
  }

  async function turnOnAi(workspaceId: string) {
    process.env.MARGAYA_AI_ENABLED = "true";
    process.env.MARGAYA_AI_PROVIDER = "fake";
    await db
      .insert(workspaceAiSettingTable)
      .values({ workspaceId, enabled: true });
  }

  /** Answers JSON prompts with `answer` and keeps what the model was shown. */
  function recordPrompts(answer: (prompt: string) => unknown) {
    const prompts: string[] = [];
    setFakeResponder((request: ChatRequest) => {
      if (!request.jsonSchema) return null;
      const last = request.messages.at(-1);
      const prompt = !last
        ? ""
        : typeof last.content === "string"
          ? last.content
          : last.content
              .map((block) => ("text" in block ? block.text : ""))
              .join("");
      prompts.push(prompt);
      return { text: JSON.stringify(answer(prompt)) };
    });
    return prompts;
  }

  async function read<T>(app: App, path: string, headers: Headers) {
    const response = await call(app, "GET", path, headers);
    const text = await response.text();
    expect(response.status, `${path} ${text}`).toBe(200);
    return { text, body: JSON.parse(text) as T };
  }

  it("keeps AI triage inside a project-limited key", async () => {
    const s = await seed();
    await turnOnAi(s.workspace.id);
    // The other project's task (OTHER-500) has the very same title.
    const [own] = await tasksIn(s.allowed.id, ["Elsewhere"]);
    if (!own) throw new Error("no task");
    await db
      .insert(schema.labelTable)
      .values({ workspaceId: s.workspace.id, name: "bug", color: "#112233" });
    const prompts = recordPrompts((prompt) =>
      prompt.includes("Candidate projects")
        ? {
            labels: [],
            assignee: [],
            priority: [],
            project: [
              {
                ref: /(R\d+): Other/.exec(prompt)?.[1] ?? "none",
                reason: "It fits there",
              },
            ],
            duplicates: [{ ref: "OTHER-500", reason: "Same title" }],
          }
        : { labels: [] },
    );
    const suggest = (headers: Headers) =>
      call(s.app, "POST", "/api/ai/triage/suggest", headers, {
        taskId: own.id,
      });
    const draftLabels = (headers: Headers) =>
      call(s.app, "POST", "/api/ai/triage/labels", headers, {
        projectId: s.allowed.id,
        title: "Elsewhere",
      });

    const limited = await limitedTo(s);
    const response = await suggest(limited.headers);
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).not.toContain(s.other.id);
    expect(text).not.toContain(s.task.id);
    expect(JSON.parse(text)).toMatchObject({ project: null, duplicates: [] });
    const labels = await draftLabels(limited.headers);
    expect(labels.status, await labels.clone().text()).toBe(200);
    // Nor did the model see the other project or its task.
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt).not.toContain("OTHER-500");
      expect(prompt).not.toMatch(/R\d+: Other/);
    }

    // Without the limit, the same calls reach the other project.
    prompts.length = 0;
    const unlimited = await createApiKey(s.user);
    expect(await (await suggest(unlimited.headers)).json()).toMatchObject({
      project: { projectId: s.other.id },
      duplicates: [expect.objectContaining({ taskId: s.task.id })],
    });
    expect((await draftLabels(unlimited.headers)).status).toBe(200);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) expect(prompt).toContain("OTHER-500");
  });

  it("finds a duplicate inside a project-limited key past newer ones outside it", async () => {
    const s = await seed();
    await turnOnAi(s.workspace.id);
    const hoursAgo = (hours: number) =>
      new Date(Date.now() - hours * 60 * 60 * 1000);
    // Enough newer matches outside the key to fill every search slot.
    await db.insert(schema.taskTable).values(
      Array.from({ length: 8 }, (_, index) => ({
        projectId: s.other.id,
        title: "Export fails",
        status: "to-do",
        number: 600 + index,
        createdAt: hoursAgo(1),
      })),
    );
    const [own, earlier] = await db
      .insert(schema.taskTable)
      .values([
        {
          projectId: s.allowed.id,
          title: "Export fails",
          status: "to-do",
          number: 1,
          createdAt: hoursAgo(72),
        },
        {
          projectId: s.allowed.id,
          title: "Export fails",
          status: "to-do",
          number: 2,
          createdAt: hoursAgo(48),
        },
      ])
      .returning();
    if (!own || !earlier) throw new Error("no tasks");
    recordPrompts(() => ({
      labels: [],
      assignee: [],
      priority: [],
      project: [],
      duplicates: [],
    }));

    const response = await call(
      s.app,
      "POST",
      "/api/ai/triage/suggest",
      (await limitedTo(s)).headers,
      { taskId: own.id },
    );
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const body = JSON.parse(text) as { duplicates: { taskId: string }[] };
    expect(body.duplicates.map((duplicate) => duplicate.taskId)).toEqual([
      earlier.id,
    ]);
  });

  it("names and counts no blocker outside a project-limited key in a retrospective", async () => {
    const s = await seed();
    const memberKey = await memberWithoutOther(s);
    const [cycle] = await db
      .insert(schema.cycleTable)
      .values({
        projectId: s.allowed.id,
        name: "Sprint",
        startDate: day(-7),
        endDate: day(7),
      })
      .returning();
    if (!cycle) throw new Error("no cycle");
    const [waiting, alsoWaiting, blockerInside] = await tasksIn(s.allowed.id, [
      "Waiting",
      "Also waiting",
      "Blocker inside",
    ]);
    if (!waiting || !alsoWaiting || !blockerInside) throw new Error("no tasks");
    await db.insert(schema.cycleTaskTable).values([
      { taskId: waiting.id, cycleId: cycle.id },
      { taskId: alsoWaiting.id, cycleId: cycle.id },
    ]);
    // Waiting is held up from both sides of the key, Also waiting only from
    // outside it.
    await blocks([
      [s.task, waiting],
      [blockerInside, waiting],
      [s.task, alsoWaiting],
    ]);
    const path = `/api/insight/retro/cycle/${cycle.id}`;

    const limited = await read<RetroBody>(
      s.app,
      path,
      (await limitedTo(s)).headers,
    );
    expect(limited.text).not.toContain("Elsewhere");
    expect(limited.text).not.toContain(s.task.id);
    expect(limited.body.counts.blocked).toBe(1);
    expect(limited.body.blocked).toEqual([
      expect.objectContaining({
        task: expect.objectContaining({ id: waiting.id }),
        blockers: [expect.objectContaining({ id: blockerInside.id })],
        hiddenBlockers: 0,
      }),
    ]);

    const unlimited = await read<RetroBody>(
      s.app,
      path,
      (await createApiKey(s.user)).headers,
    );
    expect(unlimited.text).toContain("Elsewhere");
    expect(unlimited.body.counts.blocked).toBe(2);

    // A member who can't see the other project still hears, unnamed.
    const member = await read<RetroBody>(s.app, path, memberKey.headers);
    expect(member.text).not.toContain("Elsewhere");
    expect(member.body.counts.blocked).toBe(2);
    expect(member.body.blocked.map((entry) => entry.hiddenBlockers)).toEqual([
      1, 1,
    ]);
  });

  it("counts no blocker outside a project-limited key in risks", async () => {
    const s = await seed();
    const memberKey = await memberWithoutOther(s);
    const [waiting, upstream, alsoWaiting, blockerInside] = await tasksIn(
      s.allowed.id,
      ["Waiting", "Upstream", "Also waiting", "Blocker inside"],
    );
    if (!waiting || !upstream || !alsoWaiting || !blockerInside) {
      throw new Error("no tasks");
    }
    // Upstream holds Waiting up through the other project's task.
    await blocks([
      [upstream, s.task],
      [s.task, waiting],
      [blockerInside, alsoWaiting],
    ]);
    const path = `/api/delivery/project/${s.allowed.id}/risks`;
    const chains = (body: RisksBody) =>
      body.signals.filter((signal) => signal.kind === "blocked_chain");
    const throughOther = expect.objectContaining({
      headTaskId: upstream.id,
      taskIds: [waiting.id],
      depth: 2,
    });

    const limited = await read<RisksBody>(
      s.app,
      path,
      (await limitedTo(s)).headers,
    );
    expect(limited.body.hiddenBlockers).toBe(0);
    expect(chains(limited.body)).toEqual([
      expect.objectContaining({
        headTaskId: blockerInside.id,
        taskIds: [alsoWaiting.id],
        depth: 1,
      }),
    ]);
    expect(limited.body.criticalPath).toMatchObject({
      taskIds: [blockerInside.id, alsoWaiting.id],
      hiddenCount: 0,
    });

    const unlimited = await read<RisksBody>(
      s.app,
      path,
      (await createApiKey(s.user)).headers,
    );
    expect(unlimited.text).toContain("Elsewhere");
    expect(unlimited.body.hiddenBlockers).toBe(0);
    expect(chains(unlimited.body)).toEqual(
      expect.arrayContaining([throughOther]),
    );

    // A member who can't see the other project still hears, unnamed.
    const member = await read<RisksBody>(s.app, path, memberKey.headers);
    expect(member.text).not.toContain("Elsewhere");
    expect(member.text).not.toContain(s.task.id);
    expect(member.body.hiddenBlockers).toBe(1);
    expect(chains(member.body)).toEqual(expect.arrayContaining([throughOther]));
    expect(member.body.criticalPath).toMatchObject({ hiddenCount: 1 });
  });

  it("counts no dependant outside a project-limited key in a capacity check", async () => {
    const s = await seed();
    const memberKey = await memberWithoutOther(s);
    // Two ended cycles with two tasks done in each: a usual cycle fits two.
    for (const [index, [start, end]] of [
      [-30, -21],
      [-20, -11],
    ].entries()) {
      const [past] = await db
        .insert(schema.cycleTable)
        .values({
          projectId: s.allowed.id,
          name: `Past ${index}`,
          startDate: day(start as number),
          endDate: day(end as number),
        })
        .returning();
      if (!past) throw new Error("no cycle");
      const done = await db
        .insert(schema.taskTable)
        .values(
          [0, 1].map((n) => ({
            projectId: s.allowed.id,
            title: `Done ${index}-${n}`,
            status: "done",
            number: 100 + index * 10 + n,
            completedAt: new Date(Date.now() + ((end as number) - 2) * DAY_MS),
          })),
        )
        .returning();
      await db
        .insert(schema.cycleTaskTable)
        .values(done.map((task) => ({ taskId: task.id, cycleId: past.id })));
    }
    const [current] = await db
      .insert(schema.cycleTable)
      .values({
        projectId: s.allowed.id,
        name: "Now",
        startDate: day(-3),
        endDate: day(6),
      })
      .returning();
    if (!current) throw new Error("no cycle");
    // Four planned against a usual two: the lowest priority goes first.
    const planned = await db
      .insert(schema.taskTable)
      .values(
        ["no-priority", "urgent", "urgent", "urgent"].map((priority, n) => ({
          projectId: s.allowed.id,
          title: `Planned ${n}`,
          status: "to-do",
          priority,
          number: 200 + n,
        })),
      )
      .returning();
    await db
      .insert(schema.cycleTaskTable)
      .values(
        planned.map((task) => ({ taskId: task.id, cycleId: current.id })),
      );
    const [first] = planned;
    const [dependantInside] = await db
      .insert(schema.taskTable)
      .values({
        projectId: s.allowed.id,
        title: "Waiting inside",
        status: "to-do",
        number: 300,
      })
      .returning();
    if (!first || !dependantInside) throw new Error("no tasks");
    // The first planned task holds up one task on each side of the key.
    await blocks([
      [first, s.task],
      [first, dependantInside],
    ]);
    type CapacityBody = {
      status: string;
      deferrals: { id: string; dependants: number }[];
    };
    const path = `/api/insight/capacity/cycle/${current.id}`;
    const dependantsOfFirst = (body: CapacityBody) =>
      body.deferrals.find((task) => task.id === first.id)?.dependants;

    const limited = await read<CapacityBody>(
      s.app,
      path,
      (await limitedTo(s)).headers,
    );
    expect(limited.body.status).toBe("over");
    expect(dependantsOfFirst(limited.body)).toBe(1);

    const unlimited = await read<CapacityBody>(
      s.app,
      path,
      (await createApiKey(s.user)).headers,
    );
    expect(dependantsOfFirst(unlimited.body)).toBe(2);

    // As in risks, a member still counts what they can't see, unnamed.
    const member = await read<CapacityBody>(s.app, path, memberKey.headers);
    expect(member.text).not.toContain(s.task.id);
    expect(dependantsOfFirst(member.body)).toBe(2);
  });

  it("refuses a project-limited key on workspace reads that only hide by person", async () => {
    const s = await seed();
    const limited = await limitedTo(s);
    const workspaceId = s.workspace.id;
    const query = `workspaceId=${workspaceId}`;
    const entity = {
      workspaceId,
      entityType: "project",
      entityId: s.allowed.id,
    };
    // Favorites and recent visits resolve through the entity registry; the
    // rest list or count across the workspace's projects.
    const routes: [string, string, unknown?][] = [
      ["GET", `/api/favorite?${query}`],
      ["POST", "/api/favorite", entity],
      ["GET", `/api/recent-visit?${query}`],
      ["POST", "/api/recent-visit", entity],
      ["GET", `/api/analytics-report?${query}`],
      ["GET", `/api/ai/memory?${query}&projectId=${s.allowed.id}`],
      ["GET", `/api/ai/agents/runs?${query}`],
      ["GET", `/api/ai/agents/approvals?${query}`],
      ["GET", `/api/task-draft?${query}`],
      ["GET", `/api/task-export?${query}`],
      [
        "POST",
        "/api/task-export",
        { workspaceId, format: "csv", projectIds: [s.allowed.id] },
      ],
      ["GET", `/api/insight/my-brief?${query}`],
      ["GET", `/api/delivery/home/risks?${query}`],
    ];
    for (const [method, path, body] of routes) {
      const response = await call(s.app, method, path, limited.headers, body);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.text(), `${method} ${path}`).toBe(
        "This API key is limited to specific projects",
      );
    }

    // The limit is the fence: the same person's unlimited key reads them.
    const unlimited = await createApiKey(s.user);
    for (const path of [
      `/api/favorite?${query}`,
      `/api/recent-visit?${query}`,
    ]) {
      expect((await call(s.app, "GET", path, unlimited.headers)).status).toBe(
        200,
      );
    }
  });
});
