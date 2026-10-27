import type { User } from "better-auth/types";
import { eq } from "drizzle-orm";
import type { WSContext } from "hono/ws";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  addConnection,
  initializeWebSocketAdapter,
  PROJECT_ACCESS_REVOKED_CLOSE_CODE,
  removeConnection,
} from "../../apps/api/src/ws";
import { mockAuthenticatedSession } from "./helpers/auth";
import { json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// PLAN 5.1: restricted projects. A restricted project is reached only by its
// members and by workspace owners and admins. Everyone else gets 404 from
// every project route, and workspace-wide reads leave its data out.

const SECRET = "Zebracorn secret";

async function seed() {
  const { user: owner, workspace } = await createWorkspaceMember({
    role: "owner",
  });
  const admin = await addWorkspaceMember(workspace.id, "admin");
  const member = await addWorkspaceMember(workspace.id, "member");
  const outsider = await addWorkspaceMember(workspace.id, "member");
  const reader = await addWorkspaceMember(workspace.id, "member");

  const { project } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Secret project",
    slug: "sec",
  });
  const { project: open } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Open project",
    slug: "opn",
  });
  await db
    .update(schema.projectTable)
    .set({ intakeEnabled: true })
    .where(eq(schema.projectTable.id, project.id));

  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: SECRET,
      status: "to-do",
      // Clear of the numbers the API hands out to tasks it creates.
      number: 1000,
    })
    .returning();
  const [openTask] = await db
    .insert(schema.taskTable)
    .values({
      projectId: open.id,
      title: "Zebracorn open",
      status: "to-do",
      // Clear of the numbers the API hands out to tasks it creates.
      number: 1000,
    })
    .returning();
  const [cycle] = await db
    .insert(schema.cycleTable)
    .values({ projectId: project.id, name: "Secret cycle" })
    .returning();
  const [module] = await db
    .insert(schema.moduleTable)
    .values({ projectId: project.id, name: "Secret module" })
    .returning();
  const [page] = await db
    .insert(schema.pageTable)
    .values({
      workspaceId: workspace.id,
      projectId: project.id,
      title: "Zebracorn page",
      access: "public",
      ownerId: owner.id,
    })
    .returning();
  const [label] = await db
    .insert(schema.labelTable)
    .values({
      name: "secret-label",
      color: "#000000",
      taskId: task?.id,
      workspaceId: workspace.id,
    })
    .returning();
  if (!task || !openTask || !cycle || !module || !page || !label) {
    throw new Error("Failed to seed the restricted project");
  }

  // Seeded while the project was open: a notification and a favourite of
  // the outsider, which must disappear (not be deleted) once restricted.
  await db.insert(schema.notificationTable).values({
    userId: outsider.id,
    title: SECRET,
    content: SECRET,
    type: "task_updated",
    resourceId: task.id,
    resourceType: "task",
    workspaceId: workspace.id,
  });
  await db.insert(schema.favoriteTable).values({
    userId: outsider.id,
    workspaceId: workspace.id,
    entityType: "project",
    entityId: project.id,
  });

  const { app } = createApp();
  const as = (user: User) => {
    mockAuthenticatedSession(user);
    return app;
  };

  // The owner restricts the project and adds the member and the reader.
  let response = await as(owner).request(
    `/api/project/${project.id}/access/visibility`,
    json("PUT", { visibility: "restricted" }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  response = await as(owner).request(
    `/api/project/${project.id}/access/members`,
    json("POST", { userId: member.id, role: "member" }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  response = await as(owner).request(
    `/api/project/${project.id}/access/members`,
    json("POST", { userId: reader.id, role: "viewer" }),
  );
  expect(response.status, await response.clone().text()).toBe(200);

  return {
    app,
    as,
    workspace,
    owner,
    admin,
    member,
    outsider,
    reader,
    project,
    open,
    task,
    openTask,
    cycle,
    module,
    page,
    label,
  };
}

type Scene = Awaited<ReturnType<typeof seed>>;
type Call = { name: string; path: string; init?: RequestInit };

/** Routes of the restricted project itself: 404 for outsiders. */
function projectCalls(s: Scene): Call[] {
  const w = s.workspace.id;
  const p = s.project.id;
  return [
    { name: "project", path: `/api/project/${p}` },
    { name: "access", path: `/api/project/${p}/access` },
    { name: "board", path: `/api/task/tasks/${p}` },
    { name: "task", path: `/api/task/${s.task.id}` },
    { name: "task by key", path: `/api/task/by-key/${w}/SEC-1000` },
    { name: "activity", path: `/api/activity/${s.task.id}` },
    { name: "columns", path: `/api/column/${p}` },
    { name: "cycles", path: `/api/cycle/project/${p}` },
    { name: "cycle", path: `/api/cycle/${s.cycle.id}` },
    { name: "modules", path: `/api/module/project/${p}` },
    { name: "module", path: `/api/module/${s.module.id}` },
    { name: "intake", path: `/api/intake/project/${p}` },
    { name: "pages", path: `/api/page/project/${p}` },
    { name: "page", path: `/api/page/${s.page.id}` },
    { name: "page templates", path: `/api/page/project/${p}/templates` },
    { name: "task labels", path: `/api/label/task/${s.task.id}` },
    { name: "views", path: `/api/view?workspaceId=${w}&projectId=${p}` },
    {
      name: "archive",
      path: `/api/archive/summary?workspaceId=${w}&projectId=${p}`,
    },
    {
      name: "analytics",
      path: `/api/analytics/overview?workspaceId=${w}&projectIds=${p}`,
    },
    {
      name: "task query",
      path: "/api/task-query",
      init: json("POST", { workspaceId: w, scope: { projectIds: [p] } }),
    },
    {
      name: "export",
      path: "/api/task-export",
      init: json("POST", { workspaceId: w, format: "csv", projectIds: [p] }),
    },
  ];
}

/** Workspace-wide reads: the restricted project's data must not show. */
function workspaceCalls(s: Scene): Call[] {
  const w = s.workspace.id;
  return [
    { name: "project list", path: `/api/project?workspaceId=${w}` },
    {
      name: "search",
      path: `/api/search?q=Zebracorn&workspaceId=${w}`,
    },
    {
      name: "task query",
      path: "/api/task-query",
      init: json("POST", { workspaceId: w }),
    },
    { name: "notifications", path: "/api/notification" },
    { name: "inbox", path: `/api/notification/inbox?workspaceId=${w}` },
    { name: "favourites", path: `/api/favorite?workspaceId=${w}` },
    { name: "labels", path: `/api/label/workspace/${w}` },
    { name: "analytics", path: `/api/analytics/overview?workspaceId=${w}` },
    { name: "archive", path: `/api/archive/summary?workspaceId=${w}` },
  ];
}

/** Ids and names that reveal the restricted project. */
function secrets(s: Scene) {
  return [s.project.id, s.task.id, SECRET, "Secret project", s.label.id];
}

describe("API integration: restricted projects", () => {
  beforeAll(async () => {
    await initializeWebSocketAdapter();
  });
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("answers 404 to non-members on every project route, and 200 to members, admins and owners", async () => {
    const s = await seed();
    for (const call of projectCalls(s)) {
      const outsider = await s.as(s.outsider).request(call.path, call.init);
      expect(outsider.status, `outsider: ${call.name}`).toBe(404);
      const body = await outsider.text();
      for (const secret of secrets(s)) {
        expect(body, `outsider: ${call.name}`).not.toContain(secret);
      }
      for (const [who, user] of [
        ["member", s.member],
        ["admin", s.admin],
        ["owner", s.owner],
      ] as const) {
        const response = await s.as(user).request(call.path, call.init);
        expect(
          response.status,
          `${who}: ${call.name} ${await response.clone().text()}`,
        ).toBe(200);
      }
    }
  });

  it("leaves the restricted project out of workspace-wide reads for non-members only", async () => {
    const s = await seed();
    for (const call of workspaceCalls(s)) {
      const outsider = await s.as(s.outsider).request(call.path, call.init);
      expect(
        outsider.status,
        `outsider: ${call.name} ${await outsider.clone().text()}`,
      ).toBe(200);
      const body = await outsider.text();
      for (const secret of secrets(s)) {
        expect(body, `outsider: ${call.name}`).not.toContain(secret);
      }
    }
    // Members, admins and owners still find it.
    for (const user of [s.member, s.admin, s.owner]) {
      for (const name of ["project list", "search", "task query"]) {
        const call = workspaceCalls(s).find((c) => c.name === name);
        if (!call) throw new Error(name);
        const response = await s.as(user).request(call.path, call.init);
        expect(await response.text(), name).toContain(s.project.id);
      }
    }
    // The open project stays visible to the outsider.
    const list = await s
      .as(s.outsider)
      .request(`/api/project?workspaceId=${s.workspace.id}`);
    expect(await list.text()).toContain(s.open.id);
  });

  it("keeps hidden favourites for when access comes back", async () => {
    const s = await seed();
    await s
      .as(s.outsider)
      .request(`/api/favorite?workspaceId=${s.workspace.id}`);
    const rows = await db
      .select()
      .from(schema.favoriteTable)
      .where(eq(schema.favoriteTable.userId, s.outsider.id));
    expect(rows).toHaveLength(1);

    const create = await s.as(s.outsider).request(
      "/api/favorite",
      json("POST", {
        workspaceId: s.workspace.id,
        entityType: "task",
        entityId: s.task.id,
      }),
    );
    expect([400, 404]).toContain(create.status);

    await s
      .as(s.owner)
      .request(
        `/api/project/${s.project.id}/access/members`,
        json("POST", { userId: s.outsider.id, role: "member" }),
      );
    const favourites = await s
      .as(s.outsider)
      .request(`/api/favorite?workspaceId=${s.workspace.id}`);
    expect(await favourites.text()).toContain(s.project.id);
  });

  it("caps a member's rights by their project role", async () => {
    const s = await seed();
    const create = (user: User) =>
      s.as(user).request(
        `/api/task/${s.project.id}`,
        json("POST", {
          title: "New",
          description: "",
          status: "to-do",
          priority: "low",
        }),
      );
    expect((await create(s.reader)).status).toBe(403);
    const read = await s.as(s.reader).request(`/api/task/${s.task.id}`);
    expect(read.status).toBe(200);
    const created = await create(s.member);
    expect(created.status, await created.clone().text()).toBe(200);
    // The workspace role still caps the project role: a viewer stays a
    // viewer even with the admin project role.
    const viewer = await addWorkspaceMember(s.workspace.id, "viewer");
    await s
      .as(s.owner)
      .request(
        `/api/project/${s.project.id}/access/members`,
        json("POST", { userId: viewer.id, role: "admin" }),
      );
    expect((await create(viewer)).status).toBe(403);
  });

  it("lets owners, admins and the lead manage access, and nobody else", async () => {
    const s = await seed();
    const restrict = (user: User, visibility: string) =>
      s
        .as(user)
        .request(
          `/api/project/${s.project.id}/access/visibility`,
          json("PUT", { visibility }),
        );
    expect((await restrict(s.outsider, "open")).status).toBe(404);
    expect((await restrict(s.member, "open")).status).toBe(403);
    expect((await restrict(s.admin, "restricted")).status).toBe(200);

    await db
      .update(schema.projectTable)
      .set({ leadUserId: s.member.id })
      .where(eq(schema.projectTable.id, s.project.id));
    const opened = await restrict(s.member, "open");
    expect(opened.status).toBe(200);
    expect(((await opened.json()) as { visibility: string }).visibility).toBe(
      "open",
    );
    // Open again: the outsider is back in.
    const project = await s
      .as(s.outsider)
      .request(`/api/project/${s.project.id}`);
    expect(project.status).toBe(200);

    // Roles must exist; members must belong to the workspace.
    const badRole = await s
      .as(s.owner)
      .request(
        `/api/project/${s.project.id}/access/members/${s.member.id}`,
        json("PATCH", { role: "nope" }),
      );
    expect(badRole.status).toBe(400);
    const stranger = await createWorkspaceMember();
    const badUser = await s
      .as(s.owner)
      .request(
        `/api/project/${s.project.id}/access/members`,
        json("POST", { userId: stranger.user.id, role: "member" }),
      );
    expect(badUser.status).toBe(400);
  });

  it("creates a restricted project with its creator as the only member", async () => {
    const s = await seed();
    const response = await s.as(s.member).request(
      "/api/project",
      json("POST", {
        workspaceId: s.workspace.id,
        name: "Private",
        icon: "Layout",
        slug: "prv",
        visibility: "restricted",
      }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const created = (await response.json()) as {
      id: string;
      visibility: string;
    };
    expect(created.visibility).toBe("restricted");
    expect(
      (await s.as(s.outsider).request(`/api/project/${created.id}`)).status,
    ).toBe(404);
    const access = await s
      .as(s.member)
      .request(`/api/project/${created.id}/access`);
    const body = (await access.json()) as { members: { userId: string }[] };
    expect(body.members.map((m) => m.userId)).toEqual([s.member.id]);
  });

  it("refuses the project socket to non-members and closes it on removal", async () => {
    const s = await seed();
    const closed: number[] = [];
    const ws = {
      send: () => {},
      close: (code: number) => closed.push(code),
    } as unknown as WSContext;
    const conn = addConnection(s.project.id, ws, s.member.id, s.member.id);
    try {
      const removed = await s
        .as(s.owner)
        .request(`/api/project/${s.project.id}/access/members/${s.member.id}`, {
          method: "DELETE",
        });
      expect(removed.status).toBe(200);
      // Broadcasts are batched for 100 ms, then re-checked.
      await expect
        .poll(() => closed, { timeout: 3000 })
        .toContain(PROJECT_ACCESS_REVOKED_CLOSE_CODE);
      expect(
        (await s.as(s.member).request(`/api/project/${s.project.id}`)).status,
      ).toBe(404);
    } finally {
      removeConnection(s.project.id, conn);
    }

    // An admin's socket survives a member change.
    const adminClosed: number[] = [];
    const adminWs = {
      send: () => {},
      close: (code: number) => adminClosed.push(code),
    } as unknown as WSContext;
    const adminConn = addConnection(
      s.project.id,
      adminWs,
      s.admin.id,
      s.admin.id,
    );
    try {
      await s
        .as(s.owner)
        .request(`/api/project/${s.project.id}/access/members/${s.reader.id}`, {
          method: "DELETE",
        });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(adminClosed).toEqual([]);
    } finally {
      removeConnection(s.project.id, adminConn);
    }
  });
});
