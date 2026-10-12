import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { createApiKey } from "./helpers/api-keys";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// B13 K26: Margaya's public API is its app API. For every Phase B resource,
// a read and a write succeed with an admin's Bearer API key, and a key whose
// stored permissions omit the resource is refused with 403. Pages (B5),
// webhooks (B13a) and exports (B13b) join this matrix when they land.

type Call = { method: string; path: string; body?: unknown };
type Scene = Awaited<ReturnType<typeof seed>>;
type Case = {
  resource: string;
  read: (s: Scene) => Call;
  write?: (s: Scene) => Call;
  /** A gated call (usually the write) and a key scope that lacks it. */
  scoped?: { call: (s: Scene) => Call; permissions: Record<string, string[]> };
};

async function seed() {
  const { user: admin, workspace } = await createWorkspaceMember({
    role: "admin",
  });
  const member = await addWorkspaceMember(workspace.id, "member");
  const { project } = await createProjectFixture({
    workspaceId: workspace.id,
    slug: "api",
  });
  await db
    .update(schema.projectTable)
    .set({ intakeEnabled: true, estimatesEnabled: true })
    .where(eq(schema.projectTable.id, project.id));
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Reachable",
      status: "to-do",
      // Clear of the numbers the API hands out to tasks it creates.
      number: 1000,
    })
    .returning();
  if (!task) throw new Error("Failed to seed a task");
  const key = await createApiKey(admin);
  const { app } = createApp();
  return { admin, member, workspace, project, task, key, app };
}

const cases: Case[] = [
  {
    resource: "Column groups and project features (B1)",
    read: (s) => ({ method: "GET", path: `/api/column/${s.project.id}` }),
    write: (s) => ({
      method: "POST",
      path: `/api/column/${s.project.id}`,
      body: { name: "QA" },
    }),
    scoped: {
      call: (s) => ({
        method: "PATCH",
        path: `/api/project/${s.project.id}/features`,
        body: { viewsEnabled: true },
      }),
      permissions: { project: ["read"] },
    },
  },
  {
    resource: "Favorites and recents (B9a)",
    read: (s) => ({
      method: "GET",
      path: `/api/favorite?workspaceId=${s.workspace.id}`,
    }),
    write: (s) => ({
      method: "POST",
      path: "/api/favorite",
      body: {
        workspaceId: s.workspace.id,
        entityType: "project",
        entityId: s.project.id,
      },
    }),
    scoped: {
      call: (s) => ({
        method: "POST",
        path: "/api/recent-visit",
        body: {
          workspaceId: s.workspace.id,
          entityType: "project",
          entityId: s.project.id,
        },
      }),
      permissions: { workspace: ["read"] },
    },
  },
  {
    resource: "Cycles (B2)",
    read: (s) => ({
      method: "GET",
      path: `/api/cycle/project/${s.project.id}`,
    }),
    write: (s) => ({
      method: "POST",
      path: `/api/cycle/project/${s.project.id}`,
      body: { name: "Sprint 1" },
    }),
    scoped: {
      call: (s) => ({
        method: "POST",
        path: `/api/cycle/project/${s.project.id}`,
        body: { name: "Sprint 2" },
      }),
      permissions: { cycle: ["read"] },
    },
  },
  {
    resource: "Modules (B3)",
    read: (s) => ({
      method: "GET",
      path: `/api/module/project/${s.project.id}`,
    }),
    write: (s) => ({
      method: "POST",
      path: `/api/module/project/${s.project.id}`,
      body: { name: "Auth" },
    }),
    scoped: {
      call: (s) => ({
        method: "POST",
        path: `/api/module/project/${s.project.id}`,
        body: { name: "Billing" },
      }),
      permissions: { module: ["read"] },
    },
  },
  {
    resource: "Views and the task query (B4)",
    read: (s) => ({
      method: "POST",
      path: "/api/task-query",
      body: { workspaceId: s.workspace.id },
    }),
    write: (s) => ({
      method: "POST",
      path: "/api/view",
      body: { workspaceId: s.workspace.id, name: "Mine" },
    }),
    scoped: {
      call: (s) => ({
        method: "POST",
        path: "/api/view",
        body: { workspaceId: s.workspace.id, name: "Theirs" },
      }),
      permissions: { task: ["read"], view: ["read"] },
    },
  },
  {
    resource: "Estimates (B6)",
    read: (s) => ({ method: "GET", path: `/api/estimate/${s.project.id}` }),
    write: (s) => ({
      method: "POST",
      path: `/api/estimate/${s.project.id}`,
      body: { name: "Points", type: "points", values: ["1", "2", "3"] },
    }),
    scoped: {
      call: (s) => ({
        method: "POST",
        path: `/api/estimate/${s.project.id}`,
        body: { name: "Sizes", type: "categories", values: ["S", "M"] },
      }),
      permissions: { project: ["read"], task: ["read"] },
    },
  },
  {
    resource: "Intake (B7)",
    read: (s) => ({
      method: "GET",
      path: `/api/intake/project/${s.project.id}`,
    }),
    write: (s) => ({
      method: "POST",
      path: `/api/intake/project/${s.project.id}`,
      body: { title: "Through the API" },
    }),
    scoped: {
      call: (s) => ({
        method: "POST",
        path: `/api/intake/project/${s.project.id}`,
        body: { title: "Refused" },
      }),
      permissions: { intake: ["read"] },
    },
  },
  {
    resource: "Analytics (B8)",
    read: (s) => ({
      method: "GET",
      path: `/api/analytics/overview?workspaceId=${s.workspace.id}`,
    }),
    scoped: {
      call: (s) => ({
        method: "GET",
        path: `/api/analytics/overview?workspaceId=${s.workspace.id}`,
      }),
      permissions: { task: ["read"] },
    },
  },
  {
    resource: "Home: stickies and quick links (B9b)",
    read: (s) => ({
      method: "GET",
      path: `/api/sticky?workspaceId=${s.workspace.id}`,
    }),
    write: (s) => ({
      method: "POST",
      path: "/api/sticky",
      body: { workspaceId: s.workspace.id, content: "From a script" },
    }),
    scoped: {
      call: (s) => ({
        method: "POST",
        path: "/api/quick-link",
        body: { workspaceId: s.workspace.id, url: "https://example.com" },
      }),
      permissions: { task: ["read"] },
    },
  },
  {
    resource: "Inbox, subscriptions and reactions (B10)",
    read: () => ({ method: "GET", path: "/api/notification" }),
    write: (s) => ({
      method: "PUT",
      path: `/api/subscription/task/${s.task.id}`,
    }),
    scoped: {
      call: (s) => ({
        method: "PUT",
        path: `/api/reaction/task/${s.task.id}/${encodeURIComponent("👍")}`,
      }),
      permissions: { workspace: ["read"] },
    },
  },
  {
    resource: "Drafts, archives and automations (B11)",
    read: (s) => ({
      method: "GET",
      path: `/api/archive/summary?workspaceId=${s.workspace.id}`,
    }),
    write: (s) => ({
      method: "POST",
      path: "/api/task-draft",
      body: { workspaceId: s.workspace.id, title: "Later" },
    }),
    scoped: {
      call: (s) => ({
        method: "POST",
        path: "/api/task-draft",
        body: { workspaceId: s.workspace.id, title: "Refused" },
      }),
      permissions: { task: ["read"] },
    },
  },
  {
    resource: "Assignees (B14a)",
    read: (s) => ({ method: "GET", path: `/api/task/${s.task.id}` }),
    write: (s) => ({
      method: "PUT",
      path: `/api/task/assignees/${s.task.id}`,
      body: { assigneeIds: [s.member.id] },
    }),
    scoped: {
      call: (s) => ({
        method: "PUT",
        path: `/api/task/assignees/${s.task.id}`,
        body: { assigneeIds: [s.admin.id] },
      }),
      permissions: { task: ["read", "update"] },
    },
  },
  {
    resource: "Links, attachments, relations and copies (B15)",
    read: (s) => ({ method: "GET", path: `/api/task-link/${s.task.id}` }),
    write: (s) => ({
      method: "POST",
      path: `/api/task-link/${s.task.id}`,
      body: { url: "https://example.com/spec" },
    }),
    scoped: {
      call: (s) => ({
        method: "POST",
        path: `/api/task-link/${s.task.id}`,
        body: { url: "https://example.com/other" },
      }),
      permissions: { task: ["read"] },
    },
  },
];

function send(s: Scene, headers: Record<string, string>, call: Call) {
  return s.app.request(call.path, {
    method: call.method,
    headers: {
      ...headers,
      ...(call.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    body: call.body === undefined ? undefined : JSON.stringify(call.body),
  });
}

describe("API integration: every Phase B resource is reachable with an API key", () => {
  let s: Scene;

  beforeAll(async () => {
    await resetTestDatabase();
    s = await seed();
  });

  for (const entry of cases) {
    it(`${entry.resource}: reads and writes with an admin's key`, async () => {
      const read = await send(s, s.key.headers, entry.read(s));
      expect(read.status, await read.clone().text()).toBe(200);
      expect(read.headers.get("X-RateLimit-Limit")).not.toBeNull();
      if (entry.write) {
        const write = await send(s, s.key.headers, entry.write(s));
        expect(write.status, await write.clone().text()).toBe(200);
      }
    });

    if (entry.scoped) {
      const { call, permissions } = entry.scoped;
      it(`${entry.resource}: a key without that scope gets 403`, async () => {
        const scopedKey = await createApiKey(s.admin, permissions);
        const response = await send(s, scopedKey.headers, call(s));
        expect(response.status).toBe(403);
        expect(await response.text()).toBe("Insufficient API key scope");
      });
    }
  }

  it("personal resources act as the key's user, and intake records the source", async () => {
    const [sticky] = await db
      .select({ userId: schema.stickyTable.userId })
      .from(schema.stickyTable)
      .where(eq(schema.stickyTable.workspaceId, s.workspace.id));
    expect(sticky?.userId).toBe(s.admin.id);

    const [draft] = await db
      .select({ createdBy: schema.taskDraftTable.createdBy })
      .from(schema.taskDraftTable)
      .where(eq(schema.taskDraftTable.workspaceId, s.workspace.id));
    expect(draft?.createdBy).toBe(s.admin.id);

    const [favorite] = await db
      .select({ userId: schema.favoriteTable.userId })
      .from(schema.favoriteTable)
      .where(
        and(
          eq(schema.favoriteTable.workspaceId, s.workspace.id),
          eq(schema.favoriteTable.entityId, s.project.id),
        ),
      );
    expect(favorite?.userId).toBe(s.admin.id);

    const [request] = await db
      .select({ source: schema.intakeItemTable.source })
      .from(schema.intakeItemTable)
      .where(eq(schema.intakeItemTable.projectId, s.project.id));
    expect(request?.source).toBe("api");
  });
});
