import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "better-auth/types";
import { eq, sql } from "drizzle-orm";
import type { WSContext } from "hono/ws";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  cycleTaskTable,
  projectMemberTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import {
  hiddenProjectIds,
  hiddenProjectIdsAnywhere,
  mayStayConnected,
  projectReach,
  usersWhoCanSeeProject,
} from "../../apps/api/src/project/visibility";
import {
  addConnection,
  initializeWebSocketAdapter,
  PROJECT_ACCESS_REVOKED_CLOSE_CODE,
  removeConnection,
} from "../../apps/api/src/ws";
import { createApiKey } from "./helpers/api-keys";
import { authClient, ORIGIN } from "./helpers/audit-log";
import { mockAuthenticatedSession } from "./helpers/auth";
import { json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { settledActivity } from "./helpers/task-detail";

// A guest is limited to the projects they are added to. Everything else in
// the workspace answers 404 or leaves out what they may not see, whichever
// surface asks, and this holds for each role around them.

const HIDDEN_TEXT = "Zebracorn hidden";
const SHARED_TEXT = "Zebracorn shared";

async function createTask(projectId: string, title: string) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId, title, status: "to-do", number: 1000 })
    .returning();
  if (!task) throw new Error("Failed to seed a task");
  return task;
}

async function seed() {
  const { user: owner, workspace } = await createWorkspaceMember({
    role: "owner",
  });
  const admin = await addWorkspaceMember(workspace.id, "admin");
  const member = await addWorkspaceMember(workspace.id, "member");
  const viewer = await addWorkspaceMember(workspace.id, "viewer");
  const guest = await addWorkspaceMember(workspace.id, "guest");

  const { project: shared } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Shared project",
    slug: "shr",
  });
  const { project: editable } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Editable project",
    slug: "edt",
  });
  const { project: hidden } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Hidden project",
    slug: "hdn",
  });
  const { project: restricted } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Restricted project",
    slug: "rst",
  });
  await db
    .update(schema.projectTable)
    .set({ visibility: "restricted" })
    .where(eq(schema.projectTable.id, restricted.id));

  const sharedTask = await createTask(shared.id, SHARED_TEXT);
  const editableTask = await createTask(editable.id, "Editable task");
  const hiddenTask = await createTask(hidden.id, HIDDEN_TEXT);
  const restrictedTask = await createTask(restricted.id, HIDDEN_TEXT);

  const [cycle] = await db
    .insert(schema.cycleTable)
    .values({ projectId: hidden.id, name: "Hidden cycle" })
    .returning();
  const [page] = await db
    .insert(schema.pageTable)
    .values({
      workspaceId: workspace.id,
      projectId: hidden.id,
      title: HIDDEN_TEXT,
      access: "public",
      ownerId: owner.id,
    })
    .returning();
  const [workspaceView] = await db
    .insert(schema.savedViewTable)
    .values({
      workspaceId: workspace.id,
      projectId: null,
      name: "Zebracorn workspace view",
      access: "workspace",
      ownerId: owner.id,
    })
    .returning();
  const [workspaceLabel] = await db
    .insert(schema.labelTable)
    .values({
      name: "workspace-label",
      color: "#000000",
      workspaceId: workspace.id,
    })
    .returning();
  if (!cycle || !page || !workspaceView || !workspaceLabel) {
    throw new Error("Failed to seed the workspace");
  }

  const { app } = createApp();
  const as = (user: User) => {
    mockAuthenticatedSession(user);
    return app;
  };

  for (const [projectId, role] of [
    [shared.id, "viewer"],
    [editable.id, "member"],
  ] as const) {
    const added = await as(owner).request(
      `/api/project/${projectId}/access/members`,
      json("POST", { userId: guest.id, role }),
    );
    expect(added.status, await added.clone().text()).toBe(200);
  }

  return {
    app,
    as,
    workspace,
    owner,
    admin,
    member,
    viewer,
    guest,
    shared,
    editable,
    hidden,
    restricted,
    sharedTask,
    editableTask,
    hiddenTask,
    restrictedTask,
    cycle,
    page,
    workspaceView,
    workspaceLabel,
  };
}

type Scene = Awaited<ReturnType<typeof seed>>;

function createTaskCall(s: Scene, projectId: string) {
  return s.as(s.guest).request(
    `/api/task/${projectId}`,
    json("POST", {
      title: "From the guest",
      description: "",
      status: "to-do",
      priority: "low",
    }),
  );
}

/** Routes of a project: 404 for a guest who was not added to it. */
function projectRoutes(s: Scene, projectId: string, taskId: string) {
  const w = s.workspace.id;
  return [
    `/api/project/${projectId}`,
    `/api/task/tasks/${projectId}`,
    `/api/task/${taskId}`,
    `/api/activity/${taskId}`,
    `/api/column/${projectId}`,
    `/api/cycle/project/${projectId}`,
    `/api/module/project/${projectId}`,
    `/api/page/project/${projectId}`,
    `/api/view?workspaceId=${w}&projectId=${projectId}`,
  ];
}

/** About the workspace, not one of a guest's projects: 404 for a guest. */
function workspaceRoutes(s: Scene) {
  const w = s.workspace.id;
  return [
    `/api/workspace/${w}/members`,
    `/api/workspace/${w}/members/${s.owner.id}`,
    `/api/workspace/${w}/deletion`,
    `/api/label/workspace/${w}`,
    `/api/label/${s.workspaceLabel.id}`,
    `/api/view?workspaceId=${w}`,
    `/api/view/${s.workspaceView.id}`,
    `/api/analytics/overview?workspaceId=${w}`,
    `/api/analytics/overview?workspaceId=${w}&projectIds=${s.shared.id}`,
    `/api/analytics/workload?workspaceId=${w}`,
    `/api/analytics-report?workspaceId=${w}`,
    `/api/audit-log?workspaceId=${w}`,
    `/api/webhook?workspaceId=${w}`,
    `/api/task-export?workspaceId=${w}`,
    `/api/archive/summary?workspaceId=${w}`,
    `/api/trash/projects?workspaceId=${w}`,
    `/api/sticky?workspaceId=${w}`,
    `/api/quick-link?workspaceId=${w}`,
    `/api/home/preferences?workspaceId=${w}`,
    `/api/delivery/home/risks?workspaceId=${w}`,
    `/api/insight/my-brief?workspaceId=${w}`,
    `/api/activity/member/${s.owner.id}?workspaceId=${w}`,
    `/api/time-entry/report?workspaceId=${w}`,
    `/api/task-draft?workspaceId=${w}`,
    `/api/ai/agents?workspaceId=${w}`,
    `/api/ai/settings?workspaceId=${w}`,
    `/api/billing/${w}`,
  ];
}

describe("API integration: workspace guests", () => {
  beforeAll(async () => {
    await initializeWebSocketAdapter();
  });
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("gives each role the projects its place allows, and a guest only theirs", async () => {
    const s = await seed();
    const reach = async (user: User, projectId: string) =>
      (await s.as(user).request(`/api/project/${projectId}`)).status;

    for (const user of [s.owner, s.admin, s.member, s.viewer]) {
      expect(await reach(user, s.hidden.id)).toBe(200);
      expect(await reach(user, s.shared.id)).toBe(200);
    }
    expect(await reach(s.owner, s.restricted.id)).toBe(200);
    expect(await reach(s.admin, s.restricted.id)).toBe(200);
    expect(await reach(s.member, s.restricted.id)).toBe(404);
    expect(await reach(s.viewer, s.restricted.id)).toBe(404);

    expect(await reach(s.guest, s.shared.id)).toBe(200);
    expect(await reach(s.guest, s.editable.id)).toBe(200);
    expect(await reach(s.guest, s.hidden.id)).toBe(404);
    expect(await reach(s.guest, s.restricted.id)).toBe(404);
  });

  it("answers 404 on every route of a project the guest was not added to", async () => {
    const s = await seed();
    for (const path of [
      ...projectRoutes(s, s.hidden.id, s.hiddenTask.id),
      ...projectRoutes(s, s.restricted.id, s.restrictedTask.id),
      `/api/cycle/${s.cycle.id}`,
      `/api/page/${s.page.id}`,
      `/api/task/by-key/${s.workspace.id}/HDN-1000`,
    ]) {
      const denied = await s.as(s.guest).request(path);
      expect(denied.status, path).toBe(404);
      expect(await denied.text(), path).not.toContain(HIDDEN_TEXT);
    }
    const socket = await s.as(s.guest).request(`/api/ws/${s.hidden.id}`);
    expect(socket.status).not.toBe(101);
  });

  it("serves the project routes of a project they were added to", async () => {
    const s = await seed();
    for (const path of [
      ...projectRoutes(s, s.shared.id, s.sharedTask.id),
      `/api/task/by-key/${s.workspace.id}/SHR-1000`,
    ]) {
      const response = await s.as(s.guest).request(path);
      expect(response.status, `${path} ${await response.clone().text()}`).toBe(
        200,
      );
    }
  });

  it("answers 404 to a guest on everything about the workspace, and not to members", async () => {
    const s = await seed();
    for (const path of workspaceRoutes(s)) {
      const denied = await s.as(s.guest).request(path);
      expect(denied.status, `guest: ${path}`).toBe(404);
      expect(await denied.text(), path).not.toContain("Zebracorn");
    }
    // Other roles get their usual answer: reached, or refused by permission.
    for (const path of workspaceRoutes(s)) {
      if (path.includes("/api/billing/")) continue;
      const response = await s.as(s.owner).request(path);
      expect(response.status, `owner: ${path}`).not.toBe(404);
    }
  });

  it("refuses workspace-wide writes and exports", async () => {
    const s = await seed();
    const w = s.workspace.id;
    for (const [path, body] of [
      [
        "/api/project",
        { workspaceId: w, name: "N", icon: "Layout", slug: "n" },
      ],
      ["/api/label", { workspaceId: w, name: "n", color: "#000000" }],
      ["/api/view", { workspaceId: w, name: "n", query: {} }],
      ["/api/task-export", { workspaceId: w, format: "csv" }],
      [
        "/api/task-export",
        { workspaceId: w, format: "csv", projectIds: [s.shared.id] },
      ],
      ["/api/ai/ask", { workspaceId: w, question: "What is hidden?" }],
    ] as const) {
      const denied = await s.as(s.guest).request(path, json("POST", body));
      expect(denied.status, path).toBe(404);
    }
  });

  it("leaves other projects out of workspace-wide reads", async () => {
    const s = await seed();
    const w = s.workspace.id;

    const list = await s.as(s.guest).request(`/api/project?workspaceId=${w}`);
    expect(list.status).toBe(200);
    const projects = (await list.json()) as { id: string }[];
    expect(projects.map((project) => project.id).sort()).toEqual(
      [s.shared.id, s.editable.id].sort(),
    );

    const search = await s
      .as(s.guest)
      .request(`/api/search?q=Zebracorn&workspaceId=${w}`);
    expect(search.status).toBe(200);
    const found = await search.text();
    expect(found).toContain(SHARED_TEXT);
    expect(found).not.toContain(HIDDEN_TEXT);
    expect(found).not.toContain("Zebracorn workspace view");
    // The same search finds both for a member, so the fence is what differs.
    const memberSearch = await s
      .as(s.member)
      .request(`/api/search?q=Zebracorn&workspaceId=${w}`);
    expect(await memberSearch.text()).toContain(HIDDEN_TEXT);

    const query = await s
      .as(s.guest)
      .request("/api/task-query", json("POST", { workspaceId: w }));
    expect(query.status, await query.clone().text()).toBe(200);
    const rows = await query.text();
    expect(rows).toContain(SHARED_TEXT);
    expect(rows).not.toContain(HIDDEN_TEXT);

    const hiddenQuery = await s.as(s.guest).request(
      "/api/task-query",
      json("POST", {
        workspaceId: w,
        scope: { projectIds: [s.hidden.id] },
      }),
    );
    expect(hiddenQuery.status).toBe(404);
  });

  it("hides the notifications of projects the guest can't see", async () => {
    const s = await seed();
    await db.insert(schema.notificationTable).values([
      {
        userId: s.guest.id,
        title: HIDDEN_TEXT,
        content: HIDDEN_TEXT,
        type: "task_updated",
        resourceId: s.hiddenTask.id,
        resourceType: "task",
        workspaceId: s.workspace.id,
      },
      {
        userId: s.guest.id,
        title: SHARED_TEXT,
        content: SHARED_TEXT,
        type: "task_updated",
        resourceId: s.sharedTask.id,
        resourceType: "task",
        workspaceId: s.workspace.id,
      },
    ]);
    for (const path of [
      "/api/notification",
      `/api/notification/inbox?workspaceId=${s.workspace.id}`,
    ]) {
      const response = await s.as(s.guest).request(path);
      expect(response.status, path).toBe(200);
      const body = await response.text();
      expect(body, path).toContain(SHARED_TEXT);
      expect(body, path).not.toContain(HIDDEN_TEXT);
    }
  });

  it("keeps favourites and recents to the guest's projects", async () => {
    const s = await seed();
    const w = s.workspace.id;
    const favourite = (entityType: string, entityId: string) =>
      s
        .as(s.guest)
        .request(
          "/api/favorite",
          json("POST", { workspaceId: w, entityType, entityId }),
        );
    expect((await favourite("project", s.shared.id)).status).toBe(200);
    for (const [type, id] of [
      ["project", s.hidden.id],
      ["task", s.hiddenTask.id],
      ["view", s.workspaceView.id],
    ] as const) {
      const denied = await favourite(type, id);
      expect([400, 404], `${type}`).toContain(denied.status);
    }
    const list = await s.as(s.guest).request(`/api/favorite?workspaceId=${w}`);
    expect(list.status).toBe(200);
    expect(await list.text()).toContain(s.shared.id);

    const visit = await s.as(s.guest).request(
      "/api/recent-visit",
      json("POST", {
        workspaceId: w,
        entityType: "view",
        entityId: s.workspaceView.id,
      }),
    );
    expect([400, 404]).toContain(visit.status);
  });

  it("caps what a guest can do by their project role, up to the guest role", async () => {
    const s = await seed();
    // Added as viewer: reads only.
    expect((await createTaskCall(s, s.shared.id)).status).toBe(403);
    const comment = await s
      .as(s.guest)
      .request(
        "/api/activity/comment",
        json("POST", { taskId: s.sharedTask.id, comment: "Hello" }),
      );
    expect(comment.status).toBe(403);

    // Added as member: adds tasks and comments.
    const created = await createTaskCall(s, s.editable.id);
    expect(created.status, await created.clone().text()).toBe(200);
    const commented = await s
      .as(s.guest)
      .request(
        "/api/activity/comment",
        json("POST", { taskId: s.editableTask.id, comment: "Hello" }),
      );
    expect(commented.status, await commented.clone().text()).toBe(200);

    // Never beyond the guest role, even as a project admin.
    await s
      .as(s.owner)
      .request(
        `/api/project/${s.editable.id}/access/members/${s.guest.id}`,
        json("PATCH", { role: "admin" }),
      );
    const del = await s
      .as(s.guest)
      .request(`/api/task/${s.editableTask.id}`, { method: "DELETE" });
    expect(del.status).toBe(403);
    const rename = await s
      .as(s.guest)
      .request(
        `/api/project/${s.editable.id}`,
        json("PUT", { name: "Taken", icon: "Layout", slug: "edt" }),
      );
    expect(rename.status).toBe(403);
    const removal = await s
      .as(s.guest)
      .request(`/api/project/${s.editable.id}`, { method: "DELETE" });
    expect(removal.status).toBe(403);
  });

  it("applies bulk task routes per project", async () => {
    const s = await seed();
    const bulk = (taskIds: string[]) =>
      s.as(s.guest).request(
        "/api/task/bulk",
        json("PATCH", {
          taskIds,
          operation: "updateStatus",
          value: "to-do",
        }),
      );
    expect((await bulk([s.hiddenTask.id])).status).toBe(404);
    expect((await bulk([s.editableTask.id, s.hiddenTask.id])).status).toBe(404);
    // The viewer project role refuses the write, whatever else is in the list.
    expect((await bulk([s.sharedTask.id])).status).toBe(403);
  });

  it("never lets a guest manage access or read a member list, even as lead", async () => {
    const s = await seed();
    await db
      .update(schema.projectTable)
      .set({ leadUserId: s.guest.id })
      .where(eq(schema.projectTable.id, s.editable.id));

    const read = await s
      .as(s.guest)
      .request(`/api/project/${s.editable.id}/access`);
    expect(read.status).toBe(404);
    const restrict = await s
      .as(s.guest)
      .request(
        `/api/project/${s.editable.id}/access/visibility`,
        json("PUT", { visibility: "restricted" }),
      );
    expect(restrict.status).toBe(403);
    // Guest is a workspace role, not a project role.
    const notAProjectRole = await s
      .as(s.owner)
      .request(
        `/api/project/${s.editable.id}/access/members/${s.guest.id}`,
        json("PATCH", { role: "guest" }),
      );
    expect(notAProjectRole.status).toBe(400);
    const addSelf = await s
      .as(s.guest)
      .request(
        `/api/project/${s.hidden.id}/access/members`,
        json("POST", { userId: s.guest.id, role: "admin" }),
      );
    expect(addSelf.status).toBe(404);
    // An owner still reads and manages it.
    expect(
      (await s.as(s.owner).request(`/api/project/${s.editable.id}/access`))
        .status,
    ).toBe(200);
  });

  it("drops the guest's socket when they are removed, also from an open project", async () => {
    const s = await seed();
    expect(await mayStayConnected(s.guest.id, s.shared.id)).toBe(true);
    expect(await mayStayConnected(s.guest.id, s.hidden.id)).toBe(false);

    const closed: number[] = [];
    const ws = {
      send: () => {},
      close: (code: number) => closed.push(code),
    } as unknown as WSContext;
    const conn = addConnection(s.shared.id, ws, s.guest.id, s.guest.id);
    try {
      const removed = await s
        .as(s.owner)
        .request(`/api/project/${s.shared.id}/access/members/${s.guest.id}`, {
          method: "DELETE",
        });
      expect(removed.status).toBe(200);
      await expect
        .poll(() => closed, { timeout: 3000 })
        .toContain(PROJECT_ACCESS_REVOKED_CLOSE_CODE);
      expect(
        (await s.as(s.guest).request(`/api/project/${s.shared.id}`)).status,
      ).toBe(404);
    } finally {
      removeConnection(s.shared.id, conn);
    }
  });

  it("answers the same for the visibility helpers background work uses", async () => {
    const s = await seed();
    const hidden = await hiddenProjectIds(s.guest.id, s.workspace.id);
    expect(hidden.sort()).toEqual([s.hidden.id, s.restricted.id].sort());
    expect(await hiddenProjectIds(s.member.id, s.workspace.id)).toEqual([
      s.restricted.id,
    ]);
    expect(await hiddenProjectIds(s.owner.id, s.workspace.id)).toEqual([]);

    const anywhere = await hiddenProjectIdsAnywhere(s.guest.id, [
      s.shared.id,
      s.hidden.id,
      s.restricted.id,
    ]);
    expect([...anywhere].sort()).toEqual([s.hidden.id, s.restricted.id].sort());

    const seers = await usersWhoCanSeeProject(s.hidden.id, [
      s.guest.id,
      s.member.id,
      s.viewer.id,
    ]);
    expect([...seers].sort()).toEqual([s.member.id, s.viewer.id].sort());
    const sharedSeers = await usersWhoCanSeeProject(s.shared.id, [s.guest.id]);
    expect([...sharedSeers]).toEqual([s.guest.id]);

    const reach = await projectReach(s.guest.id, s.shared.id);
    expect(reach).toMatchObject({ visible: true, projectRole: "viewer" });
    // Open-project members other than guests keep no project-role cap.
    const memberReach = await projectReach(s.member.id, s.shared.id);
    expect(memberReach).toMatchObject({ visible: true, projectRole: null });
  });

  it("holds for a guest's API key, which is what MCP tools call with", async () => {
    const s = await seed();
    const key = await createApiKey(s.guest);
    const withKey = (path: string, init: RequestInit = {}) =>
      s.app.request(path, {
        ...init,
        headers: { ...init.headers, ...key.headers },
      });
    const list = await withKey(`/api/project?workspaceId=${s.workspace.id}`);
    expect(list.status, await list.clone().text()).toBe(200);
    const projects = (await list.json()) as { id: string }[];
    expect(projects.map((project) => project.id).sort()).toEqual(
      [s.shared.id, s.editable.id].sort(),
    );
    expect((await withKey(`/api/project/${s.hidden.id}`)).status).toBe(404);
    expect(
      (await withKey(`/api/workspace/${s.workspace.id}/members`)).status,
    ).toBe(404);
    expect(
      (await withKey(`/api/analytics/overview?workspaceId=${s.workspace.id}`))
        .status,
    ).toBe(404);
  });

  it("keeps an instance admin's reach when they also hold the guest role", async () => {
    const s = await seed();
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, s.guest.id));
    const admin = { ...s.guest, role: "admin" } as User;
    expect(
      (await s.as(admin).request(`/api/project/${s.hidden.id}`)).status,
    ).toBe(200);
    expect(
      (await s.as(admin).request(`/api/workspace/${s.workspace.id}/members`))
        .status,
    ).toBe(200);
  });
});

describe("API integration: a guest moving and copying tasks", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  const moveAs = (s: Scene, taskId: string, destinationProjectId: string) =>
    s
      .as(s.guest)
      .request(
        `/api/task/move/${taskId}`,
        json("PUT", { destinationProjectId }),
      );
  const copyAs = (s: Scene, taskId: string, projectId?: string) =>
    s
      .as(s.guest)
      .request(`/api/task-copy/${taskId}`, json("POST", { projectId }));
  const projectOf = async (taskId: string) => {
    const [task] = await db
      .select({ projectId: schema.taskTable.projectId })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, taskId));
    return task?.projectId;
  };
  const addAsMember = async (s: Scene, slug: string) => {
    const { project } = await createProjectFixture({
      workspaceId: s.workspace.id,
      name: `Project ${slug}`,
      slug,
    });
    const added = await s
      .as(s.owner)
      .request(
        `/api/project/${project.id}/access/members`,
        json("POST", { userId: s.guest.id, role: "member" }),
      );
    expect(added.status, await added.clone().text()).toBe(200);
    return project;
  };

  it("won't move a task into a project where they only read", async () => {
    const s = await seed();
    const response = await moveAs(s, s.editableTask.id, s.shared.id);
    expect(response.status).toBe(403);
    expect(await projectOf(s.editableTask.id)).toBe(s.editable.id);
  });

  it("won't copy a task into a project where they only read", async () => {
    const s = await seed();
    const response = await copyAs(s, s.editableTask.id, s.shared.id);
    expect(response.status).toBe(403);
    const rows = await db
      .select({ id: schema.taskTable.id })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, s.shared.id));
    expect(rows.map((row) => row.id)).toEqual([s.sharedTask.id]);
  });

  it("reads a project they were not added to as missing", async () => {
    const s = await seed();
    for (const destination of [s.hidden.id, s.restricted.id]) {
      expect((await moveAs(s, s.editableTask.id, destination)).status).toBe(
        404,
      );
      expect((await copyAs(s, s.editableTask.id, destination)).status).toBe(
        404,
      );
    }
    expect(await projectOf(s.editableTask.id)).toBe(s.editable.id);
  });

  it("moves and copies between projects where they may edit", async () => {
    const s = await seed();
    const other = await addAsMember(s, "oth");
    const copied = await copyAs(s, s.editableTask.id, other.id);
    expect(copied.status, await copied.clone().text()).toBe(200);
    const moved = await moveAs(s, s.editableTask.id, other.id);
    expect(moved.status, await moved.clone().text()).toBe(200);
    expect(await projectOf(s.editableTask.id)).toBe(other.id);
  });
});

describe("API integration: guest links between projects", () => {
  beforeAll(async () => {
    await initializeWebSocketAdapter();
  });
  beforeEach(async () => {
    await resetTestDatabase();
  });

  const relate = (
    s: Scene,
    user: User,
    sourceTaskId: string,
    targetTaskId: string,
    relationType = "blocks",
  ) =>
    s
      .as(user)
      .request(
        "/api/task-relation",
        json("POST", { sourceTaskId, targetTaskId, relationType }),
      );

  const seedRelation = async (sourceTaskId: string, targetTaskId: string) => {
    const [relation] = await db
      .insert(schema.taskRelationTable)
      .values({ sourceTaskId, targetTaskId, relationType: "blocks" })
      .returning();
    if (!relation) throw new Error("Failed to seed a relation");
    return relation;
  };

  const relationCount = async () =>
    (await db.select().from(schema.taskRelationTable)).length;

  it("won't link into a project where the guest only reads", async () => {
    const s = await seed();
    // Member on `editable`, viewer on `shared`. Every name stores or flips onto
    // the task of the read-only project, so each would write there.
    for (const relationType of ["blocks", "blocked_by", "related"]) {
      const denied = await relate(
        s,
        s.guest,
        s.editableTask.id,
        s.sharedTask.id,
        relationType,
      );
      expect(denied.status, relationType).toBe(403);
    }
    expect(
      (await relate(s, s.guest, s.sharedTask.id, s.editableTask.id)).status,
    ).toBe(403);
    expect(await relationCount()).toBe(0);

    const hidden = await relate(s, s.guest, s.editableTask.id, s.hiddenTask.id);
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe("Target task not found");
    expect(await relationCount()).toBe(0);

    const [second] = await db
      .insert(schema.taskTable)
      .values({ projectId: s.editable.id, title: "Second", number: 1001 })
      .returning();
    const inside = await relate(
      s,
      s.guest,
      s.editableTask.id,
      second?.id ?? "",
    );
    expect(inside.status, await inside.clone().text()).toBe(200);
  });

  it("caps a restricted project's viewer the same way on the target side", async () => {
    const s = await seed();
    const added = await s
      .as(s.owner)
      .request(
        `/api/project/${s.restricted.id}/access/members`,
        json("POST", { userId: s.member.id, role: "viewer" }),
      );
    expect(added.status, await added.clone().text()).toBe(200);

    const denied = await relate(
      s,
      s.member,
      s.editableTask.id,
      s.restrictedTask.id,
    );
    expect(denied.status).toBe(403);
    expect(await relationCount()).toBe(0);

    // An open project caps no one, and an owner reaches them all.
    const open = await relate(s, s.member, s.editableTask.id, s.hiddenTask.id);
    expect(open.status, await open.clone().text()).toBe(200);
    const owner = await relate(
      s,
      s.owner,
      s.editableTask.id,
      s.restrictedTask.id,
    );
    expect(owner.status, await owner.clone().text()).toBe(200);
  });

  it("won't unlink from a project where the guest only reads or sees nothing", async () => {
    const s = await seed();
    const intoViewer = await seedRelation(s.editableTask.id, s.sharedTask.id);
    const intoHidden = await seedRelation(s.editableTask.id, s.hiddenTask.id);
    const remove = (user: User, id: string) =>
      s.as(user).request(`/api/task-relation/${id}`, { method: "DELETE" });

    expect((await remove(s.guest, intoViewer.id)).status).toBe(403);
    expect((await remove(s.guest, intoHidden.id)).status).toBe(404);
    expect(await relationCount()).toBe(2);

    expect((await remove(s.owner, intoViewer.id)).status).toBe(200);
    expect((await remove(s.owner, intoHidden.id)).status).toBe(200);
    expect(await relationCount()).toBe(0);
  });

  it("names only a project's own task on its socket when a link crosses projects", async () => {
    const s = await seed();
    const socket = () => {
      const messages: Record<string, unknown>[] = [];
      const ws = {
        send: (text: string) => messages.push(JSON.parse(text)),
        close: () => {},
      } as unknown as WSContext;
      return { ws, messages };
    };
    const open = socket();
    const hidden = socket();
    const openConnection = addConnection(
      s.shared.id,
      open.ws,
      s.member.id,
      "member-window",
    );
    const hiddenConnection = addConnection(
      s.restricted.id,
      hidden.ws,
      s.owner.id,
      "owner-window",
    );
    try {
      const linked = await relate(
        s,
        s.owner,
        s.restrictedTask.id,
        s.sharedTask.id,
      );
      expect(linked.status, await linked.clone().text()).toBe(200);
      const relationMessage = (messages: Record<string, unknown>[]) =>
        messages.find((message) => message.type === "TASK_RELATION_UPDATED");
      await expect
        .poll(() => relationMessage(open.messages), { timeout: 3000 })
        .toBeDefined();
      await expect
        .poll(() => relationMessage(hidden.messages), { timeout: 3000 })
        .toBeDefined();

      expect(relationMessage(open.messages)).toEqual({
        type: "TASK_RELATION_UPDATED",
        projectId: s.shared.id,
        taskId: s.sharedTask.id,
        targetTaskId: s.sharedTask.id,
      });
      expect(JSON.stringify(open.messages)).not.toContain(s.restrictedTask.id);
      expect(relationMessage(hidden.messages)).toEqual({
        type: "TASK_RELATION_UPDATED",
        projectId: s.restricted.id,
        taskId: s.restrictedTask.id,
        sourceTaskId: s.restrictedTask.id,
      });
      expect(JSON.stringify(hidden.messages)).not.toContain(s.sharedTask.id);
    } finally {
      removeConnection(s.shared.id, openConnection);
      removeConnection(s.restricted.id, hiddenConnection);
    }
  });
});

describe("API integration: what a guest's activity says about other projects", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  /** An open project the guest was not added to, linked to one they were. */
  const linked = async (s: Scene) => {
    const created = await s.as(s.owner).request(
      "/api/task-relation",
      json("POST", {
        sourceTaskId: s.hiddenTask.id,
        targetTaskId: s.sharedTask.id,
        relationType: "blocking",
      }),
    );
    expect(created.status, await created.clone().text()).toBe(200);
    await settledActivity(s.sharedTask.id, "relation_added");
  };

  it("hides an open project they were not added to, unlike for a member", async () => {
    const s = await seed();
    await linked(s);
    type Row = { type: string; eventData: Record<string, unknown> };

    const asGuest = await s
      .as(s.guest)
      .request(`/api/activity/${s.sharedTask.id}`);
    const text = await asGuest.text();
    expect(asGuest.status, text).toBe(200);
    for (const trace of [
      HIDDEN_TEXT,
      s.hidden.name,
      "HDN-",
      s.hidden.id,
      s.hiddenTask.id,
    ]) {
      expect(text).not.toContain(trace);
    }
    const rows = JSON.parse(text) as Row[];
    expect(
      rows.find((row) => row.type === "relation_added")?.eventData,
    ).toEqual({
      relation: "blocked_by",
      otherTaskId: null,
      otherTaskKey: null,
      otherTaskTitle: null,
      otherProjectId: null,
      otherTaskHidden: true,
    });

    const asMember = await s
      .as(s.member)
      .request(`/api/activity/${s.sharedTask.id}`);
    const memberRows = (await asMember.json()) as Row[];
    expect(
      memberRows.find((row) => row.type === "relation_added")?.eventData,
    ).toMatchObject({
      otherTaskId: s.hiddenTask.id,
      otherTaskTitle: HIDDEN_TEXT,
      otherProjectId: s.hidden.id,
    });
  });

  it("doesn't find a row by what they can't see, and doesn't show it", async () => {
    const s = await seed();
    await linked(s);
    const find = (user: User, q: string) =>
      s
        .as(user)
        .request(
          `/api/search?q=${encodeURIComponent(q)}&type=activities&workspaceId=${s.workspace.id}`,
        );
    type Hit = { taskId?: string; content?: string };
    const results = async (response: Response) =>
      ((await response.json()) as { results: Hit[] }).results;

    expect(await results(await find(s.guest, "hidden"))).toEqual([]);
    expect(await results(await find(s.guest, "HDN"))).toEqual([]);
    expect(
      (await results(await find(s.member, "hidden"))).map((hit) => hit.taskId),
    ).toContain(s.sharedTask.id);

    // Found by the guest's own task, the row names nothing.
    const hits = await results(await find(s.guest, "shared"));
    const hit = hits.find((one) => one.content?.includes("blocked by"));
    expect(hit?.content).toBe(
      "marked this task as blocked by a task in another project",
    );
  });

  it("doesn't name the cycle of a project they weren't added to", async () => {
    const s = await seed();
    const [cycle] = await db
      .insert(schema.cycleTable)
      .values({ projectId: s.hidden.id, name: "Okapi sprint" })
      .returning();
    if (!cycle) throw new Error("Failed to seed a cycle");
    await db
      .insert(cycleTaskTable)
      .values({ taskId: s.hiddenTask.id, cycleId: cycle.id });
    const moved = await s
      .as(s.owner)
      .request(
        `/api/task/move/${s.hiddenTask.id}`,
        json("PUT", { destinationProjectId: s.shared.id }),
      );
    expect(moved.status, await moved.clone().text()).toBe(200);
    await settledActivity(s.hiddenTask.id, "cycle_changed");

    type Row = { type: string; eventData: Record<string, unknown> };
    const feedOf = async (user: User) => {
      const response = await s
        .as(user)
        .request(`/api/activity/${s.hiddenTask.id}`);
      expect(response.status).toBe(200);
      return response.text();
    };
    const asGuest = await feedOf(s.guest);
    expect(asGuest).not.toContain("Okapi");
    expect(asGuest).not.toContain(cycle.id);
    const asMember = JSON.parse(await feedOf(s.member)) as Row[];
    expect(
      asMember.find((row) => row.type === "cycle_changed")?.eventData,
    ).toMatchObject({ oldCycleId: cycle.id, oldCycleName: "Okapi sprint" });

    const search = (user: User) =>
      s
        .as(user)
        .request(
          `/api/search?q=Okapi&type=activities&workspaceId=${s.workspace.id}`,
        );
    const hits = async (user: User) =>
      ((await (await search(user)).json()) as { results: unknown[] }).results
        .length;
    expect(await hits(s.guest)).toBe(0);
    expect(await hits(s.member)).toBeGreaterThan(0);
  });
});

describe("API integration: guest invitations and the member list", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function authScene() {
    const client = authClient();
    const owner = await client.signup("Olive");
    const workspace = await client.ok<{ id: string }>(
      "/organization/create",
      { name: "Guest Co", slug: `guest-${owner.id.slice(0, 8).toLowerCase()}` },
      owner.cookie,
    );
    const join = async (name: string, role: string) => {
      const user = await client.signup(name);
      const invitation = await client.ok<{ id: string }>(
        "/organization/invite-member",
        { email: user.email, role, organizationId: workspace.id },
        owner.cookie,
      );
      await client.ok(
        "/organization/accept-invitation",
        { invitationId: invitation.id },
        user.cookie,
      );
      return user;
    };
    const get = (path: string, cookie: string) =>
      client.app.request(`/api/auth${path}`, {
        headers: { Origin: ORIGIN, Cookie: cookie },
      });
    return { ...client, owner, workspaceId: workspace.id, join, get };
  }

  it("invites a guest, who then sees only their own row in the member lists", async () => {
    const s = await authScene();
    const guest = await s.join("Gus", "guest");
    const member = await s.join("Mia", "member");
    await s.ok(
      "/organization/invite-member",
      {
        email: "pending@example.com",
        role: "member",
        organizationId: s.workspaceId,
      },
      s.owner.cookie,
    );
    const w = `organizationId=${s.workspaceId}`;

    const listed = await s.get(`/organization/list-members?${w}`, guest.cookie);
    expect(listed.status).toBe(200);
    const list = (await listed.json()) as {
      members: { userId: string; role: string }[];
      total: number;
    };
    expect(list.total).toBe(1);
    expect(list.members.map((m) => m.userId)).toEqual([guest.id]);
    expect(list.members[0]?.role).toBe("guest");

    const full = await s.get(
      `/organization/get-full-organization?${w}`,
      guest.cookie,
    );
    expect(full.status).toBe(200);
    const fullBody = await full.text();
    const workspace = JSON.parse(fullBody) as {
      members: { userId: string }[];
      invitations: unknown[];
    };
    expect(workspace.members.map((m) => m.userId)).toEqual([guest.id]);
    expect(workspace.invitations).toEqual([]);
    expect(fullBody).not.toContain(member.email);
    expect(fullBody).not.toContain("pending@example.com");

    const invitations = await s.get(
      `/organization/list-invitations?${w}`,
      guest.cookie,
    );
    expect(await invitations.json()).toEqual([]);

    const otherRole = await s.get(
      `/organization/get-active-member-role?${w}&userId=${member.id}`,
      guest.cookie,
    );
    expect(otherRole.status).toBe(403);

    const roles = await s.get(`/organization/list-roles?${w}`, guest.cookie);
    expect(roles.status).toBe(403);

    // The others keep the whole list.
    const forMember = await s.get(
      `/organization/list-members?${w}`,
      member.cookie,
    );
    const memberList = (await forMember.json()) as { total: number };
    expect(memberList.total).toBe(3);
    const forOwner = await s.get(
      `/organization/list-invitations?${w}`,
      s.owner.cookie,
    );
    expect(await forOwner.text()).toContain("pending@example.com");
  });

  it("reports a guest's own rights through has-permission", async () => {
    const s = await authScene();
    const guest = await s.join("Gus", "guest");
    const check = async (permissions: Record<string, string[]>) => {
      const response = await s.call(
        "/organization/has-permission",
        { organizationId: s.workspaceId, permissions },
        guest.cookie,
      );
      return ((await response.json()) as { success: boolean }).success;
    };
    expect(await check({ task: ["read"] })).toBe(true);
    expect(await check({ project: ["read"] })).toBe(true);
    expect(await check({ project: ["create"] })).toBe(false);
    expect(await check({ task: ["delete"] })).toBe(false);
    expect(await check({ analytics: ["read"] })).toBe(false);
    expect(await check({ invitation: ["create"] })).toBe(false);
    expect(await check({ workspace: ["read"] })).toBe(false);
  });

  it("reserves the guest role name and refuses combining it", async () => {
    const s = await authScene();
    const taken = await s.call(
      "/organization/create-role",
      {
        role: "guest",
        permission: { task: ["delete"] },
        organizationId: s.workspaceId,
      },
      s.owner.cookie,
    );
    expect(taken.status).toBe(400);

    const user = await s.signup("Combo");
    const combined = await s.call(
      "/organization/invite-member",
      {
        email: user.email,
        role: ["guest", "member"],
        organizationId: s.workspaceId,
      },
      s.owner.cookie,
    );
    expect(combined.status).toBe(400);
  });

  it("only lets people with invitation rights invite guests", async () => {
    const s = await authScene();
    const viewer = await s.join("Vee", "viewer");
    const denied = await s.call(
      "/organization/invite-member",
      {
        email: "guest@example.com",
        role: "guest",
        organizationId: s.workspaceId,
      },
      viewer.cookie,
    );
    expect(denied.status).toBe(403);
    const guest = await s.join("Gus", "guest");
    const fromGuest = await s.call(
      "/organization/invite-member",
      {
        email: "friend@example.com",
        role: "guest",
        organizationId: s.workspaceId,
      },
      guest.cookie,
    );
    expect(fromGuest.status).toBe(403);
  });

  it("fences someone as soon as they are made a guest, and frees them when not", async () => {
    const s = await authScene();
    const person = await s.join("Pat", "member");
    const { project } = await createProjectFixture({
      workspaceId: s.workspaceId,
      name: "Open project",
      slug: "opn",
    });
    const reach = () =>
      s.app.request(`/api/project/${project.id}`, {
        headers: { Origin: ORIGIN, Cookie: person.cookie },
      });
    expect((await reach()).status).toBe(200);
    const [row] = await db
      .select({ id: schema.workspaceUserTable.id })
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, person.id));
    const change = (role: string) =>
      s.ok(
        "/organization/update-member-role",
        { memberId: row?.id, role, organizationId: s.workspaceId },
        s.owner.cookie,
      );
    await change("guest");
    expect((await reach()).status).toBe(404);
    await change("member");
    expect((await reach()).status).toBe(200);
  });
});

describe("API integration: migration 0042 for a custom role named guest", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  const applyMigration = async () => {
    const file = resolve(process.cwd(), "drizzle/0042_reserve_guest_role.sql");
    for (const statement of readFileSync(file, "utf8").split(
      "--> statement-breakpoint",
    )) {
      await db.execute(sql.raw(statement));
    }
  };

  const roleOf = async (userId: string) =>
    (
      await db
        .select({ role: schema.workspaceUserTable.role })
        .from(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.userId, userId))
    )[0]?.role;

  it("keeps two roles apart when the workspace already has custom-guest", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    const wasGuest = { task: ["read"] };
    const wasCustomGuest = { task: ["read", "update", "delete"] };
    await db.insert(schema.workspaceRoleTable).values([
      {
        workspaceId: workspace.id,
        role: "guest",
        permission: JSON.stringify(wasGuest),
      },
      {
        workspaceId: workspace.id,
        role: "custom-guest",
        permission: JSON.stringify(wasCustomGuest),
      },
    ]);
    const guestHolder = await addWorkspaceMember(workspace.id, "guest");
    const multiHolder = await addWorkspaceMember(workspace.id, "member, guest");
    const customHolder = await addWorkspaceMember(workspace.id, "custom-guest");
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
      name: "Open project",
      slug: "opn",
    });
    await db.insert(projectMemberTable).values({
      projectId: project.id,
      userId: guestHolder.id,
      role: "guest",
    });

    await applyMigration();

    expect(await roleOf(guestHolder.id)).toBe("custom-guest-2");
    expect(await roleOf(multiHolder.id)).toBe("member, custom-guest-2");
    expect(await roleOf(customHolder.id)).toBe("custom-guest");
    const [projectMember] = await db
      .select()
      .from(projectMemberTable)
      .where(eq(projectMemberTable.userId, guestHolder.id));
    expect(projectMember?.role).toBe("custom-guest-2");

    const rows = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));
    const permissionsOf = (role: string) =>
      rows
        .filter((row) => row.role === role)
        .map((row) => JSON.parse(row.permission));
    expect(permissionsOf("guest")).toEqual([]);
    expect(permissionsOf("custom-guest")).toEqual([wasCustomGuest]);
    expect(permissionsOf("custom-guest-2")).toEqual([wasGuest]);
  });

  it("moves the custom role and its holders, so they keep their access", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    const custom = { task: ["read", "update"], project: ["read"] };
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: workspace.id,
      role: "guest",
      permission: JSON.stringify(custom),
    });
    const holder = await addWorkspaceMember(workspace.id, "guest");
    const multi = await addWorkspaceMember(workspace.id, "member, guest");
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
      name: "Open project",
      slug: "opn",
    });
    await db.insert(projectMemberTable).values({
      projectId: project.id,
      userId: holder.id,
      role: "guest",
    });
    const [inviter] = await db.select().from(schema.userTable).limit(1);
    await db.insert(schema.invitationTable).values({
      workspaceId: workspace.id,
      email: "invited@example.com",
      role: "guest",
      expiresAt: new Date(Date.now() + 60_000),
      inviterId: inviter?.id ?? holder.id,
    });

    // Another workspace with no such role: its "guest" holder is a real guest.
    const { workspace: other } = await createWorkspaceMember({ role: "owner" });
    const realGuest = await addWorkspaceMember(other.id, "guest");

    await applyMigration();

    expect(await roleOf(holder.id)).toBe("custom-guest");
    expect(await roleOf(multi.id)).toBe("member, custom-guest");
    expect(await roleOf(realGuest.id)).toBe("guest");

    const [invitation] = await db.select().from(schema.invitationTable);
    expect(invitation?.role).toBe("custom-guest");
    const [projectMember] = await db
      .select()
      .from(projectMemberTable)
      .where(eq(projectMemberTable.userId, holder.id));
    expect(projectMember?.role).toBe("custom-guest");
    const roles = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.role, "custom-guest"));
    expect(roles).toHaveLength(1);
    expect(JSON.parse(roles[0]?.permission ?? "{}")).toEqual(custom);

    // Not fenced any more: the open project is reachable with the old rights.
    const { app } = createApp();
    mockAuthenticatedSession(holder);
    const reached = await app.request(`/api/project/${project.id}`);
    expect(reached.status).toBe(200);
  });
});
