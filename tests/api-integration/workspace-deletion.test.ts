import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  auditLogTable,
  instanceAuditLogTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { handleGiteaWebhookRequest } from "../../apps/api/src/plugins/gitea/webhook-handler";
import { findAllIntegrationsByRepo } from "../../apps/api/src/plugins/github/services/task-service";
import { runWorkspaceDeletionPurge } from "../../apps/api/src/workspace-deletion/purge-job";
import { createApiKey } from "./helpers/api-keys";
import { addPerson } from "./helpers/assignees";
import { mockAuthenticatedSession } from "./helpers/auth";
import { json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// 5.3: deleting a workspace schedules it; it is read-only (and its API keys
// stop working) during the grace period, its owner can cancel, and the purge
// job deletes it once it is due.

type User = typeof schema.userTable.$inferSelect;
type Deletion = {
  pending: boolean;
  scheduledAt: string | null;
  dueAt: string | null;
  scheduledBy: { id: string; name: string } | null;
  graceDays: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

async function scene() {
  const { user: owner, workspace } = await createWorkspaceMember({
    role: "owner",
    userName: "Olivia",
    workspaceName: "Doomed Co",
  });
  const admin = await addPerson(workspace.id, "Ada", "admin");
  const member = await addPerson(workspace.id, "Ben", "member");
  const { project } = await createProjectFixture({
    workspaceId: workspace.id,
    slug: "web",
  });
  const { app } = createApp();
  const call = (user: User, path: string, init?: RequestInit) => {
    mockAuthenticatedSession(user);
    return app.request(`/api${path}`, init);
  };
  const deletionPath = `/workspace/${workspace.id}/deletion`;
  return { app, owner, admin, member, workspace, project, call, deletionPath };
}

async function workspaceRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, id));
  return row;
}

describe("delayed workspace deletion", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lets only the owner schedule it, for the 14-day grace period by default", async () => {
    const s = await scene();

    const byAdmin = await s.call(s.admin, s.deletionPath, { method: "POST" });
    expect(byAdmin.status).toBe(403);

    const before = Date.now();
    const scheduled = await s.call(s.owner, s.deletionPath, { method: "POST" });
    expect(scheduled.status, await scheduled.clone().text()).toBe(200);
    const body = (await scheduled.json()) as Deletion;
    expect(body.pending).toBe(true);
    expect(body.graceDays).toBe(14);
    expect(body.scheduledBy).toEqual({ id: s.owner.id, name: "Olivia" });
    const due = new Date(body.dueAt ?? "").getTime();
    expect(due - before).toBeGreaterThanOrEqual(14 * DAY_MS - 1000);
    expect(due - before).toBeLessThan(14 * DAY_MS + 60_000);

    // Scheduling again keeps the first due date.
    const again = (await (
      await s.call(s.owner, s.deletionPath, { method: "POST" })
    ).json()) as Deletion;
    expect(again.dueAt).toBe(body.dueAt);

    const seen = await s.call(s.member, s.deletionPath);
    expect(seen.status).toBe(200);
    expect(((await seen.json()) as Deletion).pending).toBe(true);

    const [audit] = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.workspaceId, s.workspace.id),
          eq(auditLogTable.action, "workspace.deletion_scheduled"),
        ),
      );
    expect(audit?.actorUserId).toBe(s.owner.id);
  });

  it("makes the workspace read-only during the grace period, then writable after a cancel", async () => {
    const s = await scene();
    await s.call(s.owner, s.deletionPath, { method: "POST" });

    // Reads keep working.
    const pages = await s.call(s.member, `/page/project/${s.project.id}`);
    expect(pages.status).toBe(200);
    const members = await s.call(
      s.member,
      `/workspace/${s.workspace.id}/members`,
    );
    expect(members.status).toBe(200);

    // Writes answer 423, for the owner and an instance admin too.
    const page = await s.call(
      s.member,
      `/page/project/${s.project.id}`,
      json("POST", { title: "Late" }),
    );
    expect(page.status).toBe(423);
    const task = await s.call(
      s.member,
      `/task/${s.project.id}`,
      json("POST", { title: "Late", priority: "low", status: "to-do" }),
    );
    expect(task.status).toBe(423);
    const settings = await s.call(
      s.owner,
      `/workspace/${s.workspace.id}/settings`,
      json("PATCH", { timezone: "Europe/Berlin" }),
    );
    expect(settings.status).toBe(423);
    const instanceAdmin = await addPerson(s.workspace.id, "Root", "member");
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, instanceAdmin.id));
    const byInstanceAdmin = await s.call(
      instanceAdmin,
      `/page/project/${s.project.id}`,
      json("POST", { title: "Late" }),
    );
    expect(byInstanceAdmin.status).toBe(423);

    // Outsiders learn nothing: still 403, not 423.
    const { user: outsider } = await createWorkspaceMember({ role: "owner" });
    const foreign = await s.call(
      outsider,
      `/page/project/${s.project.id}`,
      json("POST", { title: "Nope" }),
    );
    expect(foreign.status).toBe(403);

    const cancelled = await s.call(s.owner, s.deletionPath, {
      method: "DELETE",
    });
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as Deletion).pending).toBe(false);
    expect((await workspaceRow(s.workspace.id))?.deletionDueAt).toBeNull();

    const after = await s.call(
      s.member,
      `/page/project/${s.project.id}`,
      json("POST", { title: "Back" }),
    );
    expect(after.status).toBe(200);
  });

  it("shows pages as read-only to everyone while the deletion is pending", async () => {
    const s = await scene();
    const created = await s.call(
      s.member,
      `/page/project/${s.project.id}`,
      json("POST", { title: "Notes" }),
    );
    const page = (await created.json()) as { id: string };
    await s.call(s.owner, s.deletionPath, { method: "POST" });

    const read = await s.call(s.member, `/page/${page.id}`);
    expect(read.status).toBe(200);
    const body = (await read.json()) as {
      capabilities: Record<string, boolean>;
    };
    expect(body.capabilities.canEdit).toBe(false);
    expect(body.capabilities.canCreateSubpage).toBe(false);
    expect(body.capabilities.canDuplicate).toBe(false);
  });

  it("stops API keys, even for reads, until the deletion is cancelled", async () => {
    const s = await scene();
    const key = await createApiKey(s.owner);
    const read = () =>
      s.app.request(`/api/page/project/${s.project.id}`, {
        headers: key.headers,
      });
    expect((await read()).status).toBe(200);

    await s.call(s.owner, s.deletionPath, { method: "POST" });
    const blocked = await read();
    expect([403, 404]).toContain(blocked.status);
    const members = await s.app.request(
      `/api/workspace/${s.workspace.id}/members`,
      { headers: key.headers },
    );
    expect(members.status).toBe(403);
    expect(await members.text()).toMatch(
      /API keys and integrations are paused/,
    );

    await s.call(s.owner, s.deletionPath, { method: "DELETE" });
    expect((await read()).status).toBe(200);
  });

  it("purges a workspace once it is due, once, and leaves cancelled ones alone", async () => {
    const s = await scene();
    const other = await createWorkspaceMember({ role: "owner" });

    await s.call(s.owner, s.deletionPath, { method: "POST" });
    mockAuthenticatedSession(other.user);
    await s.app.request(`/api/workspace/${other.workspace.id}/deletion`, {
      method: "POST",
    });
    await s.app.request(`/api/workspace/${other.workspace.id}/deletion`, {
      method: "DELETE",
    });

    // Not due yet: nothing happens.
    expect((await runWorkspaceDeletionPurge()).purged).toBe(0);
    expect(await workspaceRow(s.workspace.id)).toBeDefined();

    const later = new Date(Date.now() + 15 * DAY_MS);
    const first = await runWorkspaceDeletionPurge(later);
    expect(first).toEqual({ degraded: false, purged: 1 });
    expect(await workspaceRow(s.workspace.id)).toBeUndefined();
    expect(await workspaceRow(other.workspace.id)).toBeDefined();
    const projects = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, s.project.id));
    expect(projects).toHaveLength(0);

    // Idempotent: a second run finds nothing.
    expect((await runWorkspaceDeletionPurge(later)).purged).toBe(0);

    // The instance audit trail keeps the record after the purge.
    const trail = await db
      .select()
      .from(instanceAuditLogTable)
      .where(eq(instanceAuditLogTable.targetId, s.workspace.id));
    expect(trail.map((entry) => entry.action).sort()).toEqual([
      "workspace.deletion_scheduled",
      "workspace.purged",
    ]);
  });

  it("refuses an immediate delete through Better Auth and blocks workspace changes there", async () => {
    const { app } = createApp();
    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "owner-delay@example.com",
        password: "correct horse battery staple",
        name: "Delay Owner",
      }),
    });
    expect(signUp.status).toBe(200);
    const cookie = signUp.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; ");
    const created = await app.request("/api/auth/organization/create", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Delay Space", slug: "delay-space" }),
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };

    const deleted = await app.request("/api/auth/organization/delete", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ organizationId: workspace.id }),
    });
    expect(deleted.status).toBe(409);
    expect(await deleted.text()).toMatch(/grace period/);
    expect(await workspaceRow(workspace.id)).toBeDefined();

    const scheduled = await app.request(
      `/api/workspace/${workspace.id}/deletion`,
      { method: "POST", headers: { cookie } },
    );
    expect(scheduled.status).toBe(200);

    const renamed = await app.request("/api/auth/organization/update", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        organizationId: workspace.id,
        data: { name: "Renamed" },
      }),
    });
    expect(renamed.status).toBe(423);
    expect((await workspaceRow(workspace.id))?.name).toBe("Delay Space");

    // Better Auth's custom-role endpoints have no organization hooks.
    const createRole = () =>
      app.request("/api/auth/organization/create-role", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          organizationId: workspace.id,
          role: "reviewer",
          permission: { task: ["read"] },
        }),
      });
    const locked = await createRole();
    expect(locked.status).toBe(423);
    const roles = await db
      .select({ role: schema.workspaceRoleTable.role })
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));
    expect(roles.map((row) => row.role)).not.toContain("reviewer");

    const cancelled = await app.request(
      `/api/workspace/${workspace.id}/deletion`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(cancelled.status).toBe(200);
    const created2 = await createRole();
    expect(created2.status, await created2.clone().text()).toBe(200);
  });

  it("pauses inbound GitHub and Gitea webhooks while the deletion is pending", async () => {
    const s = await scene();
    const secret = "gitea-webhook-secret";
    const [gitea] = await db
      .insert(schema.integrationTable)
      .values({
        projectId: s.project.id,
        type: "gitea",
        config: JSON.stringify({
          baseUrl: "https://gitea.example",
          accessToken: "fake-local-token",
          repositoryOwner: "owner",
          repositoryName: "repo",
          webhookSecret: secret,
        }),
      })
      .returning();
    const { project: other } = await createProjectFixture({
      workspaceId: s.workspace.id,
      slug: "api",
    });
    await db.insert(schema.integrationTable).values({
      projectId: other.id,
      type: "github",
      config: JSON.stringify({
        repositoryOwner: "owner",
        repositoryName: "repo",
        installationId: 7,
        repositoryId: 42,
        verifiedGithubAccountId: "99",
        verifiedByUserId: s.owner.id,
      }),
    });
    const source = { installation: { id: 7 }, repository: { id: 42 } };
    expect(await findAllIntegrationsByRepo(source)).toHaveLength(1);

    await s.call(s.owner, s.deletionPath, { method: "POST" });
    expect(await findAllIntegrationsByRepo(source)).toEqual([]);

    const body = JSON.stringify({
      action: "opened",
      issue: { number: 1, title: "From Gitea", body: "", labels: [] },
      repository: { full_name: "owner/repo", name: "repo" },
    });
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const result = await handleGiteaWebhookRequest(
      gitea?.id ?? "",
      body,
      signature,
      "issues",
    );
    expect(result).toEqual({ success: true });
    const tasks = await db
      .select({ id: schema.taskTable.id })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, s.project.id));
    expect(tasks).toEqual([]);

    await s.call(s.owner, s.deletionPath, { method: "DELETE" });
    expect(await findAllIntegrationsByRepo(source)).toHaveLength(1);
  });
});
