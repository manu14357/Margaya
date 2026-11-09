import { randomUUID } from "node:crypto";
import type { User } from "better-auth/types";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { billableMemberCount } from "../../apps/api/src/billing/seats";
import db, { schema } from "../../apps/api/src/database";
import {
  invitationProjectTable,
  projectMemberTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { auditRows, authClient, ORIGIN } from "./helpers/audit-log";
import { mockAuthenticatedSession } from "./helpers/auth";
import { json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// A guest's first projects come with their invitation, pickers in a project
// offer that project's people, the web reads a project role's cap from the
// API, and guests stay out of risk radars and retros.

async function restrict(projectId: string) {
  await db
    .update(schema.projectTable)
    .set({ visibility: "restricted" })
    .where(eq(schema.projectTable.id, projectId));
}

async function addToProject(projectId: string, userId: string, role: string) {
  await db.insert(projectMemberTable).values({ projectId, userId, role });
}

async function seed() {
  const { user: owner, workspace } = await createWorkspaceMember({
    role: "owner",
    userName: "Olive Owner",
  });
  const admin = await addWorkspaceMember(workspace.id, "admin");
  const member = await addWorkspaceMember(workspace.id, "member");
  const viewer = await addWorkspaceMember(workspace.id, "viewer");
  const guest = await addWorkspaceMember(workspace.id, "guest");
  const otherGuest = await addWorkspaceMember(workspace.id, "guest");
  const insider = await addWorkspaceMember(workspace.id, "member");

  const { project: shared } = await createProjectFixture({
    workspaceId: workspace.id,
    slug: "shr",
  });
  const { project: editable } = await createProjectFixture({
    workspaceId: workspace.id,
    slug: "edt",
  });
  const { project: hidden } = await createProjectFixture({
    workspaceId: workspace.id,
    slug: "hdn",
  });
  const { project: restricted } = await createProjectFixture({
    workspaceId: workspace.id,
    slug: "rst",
  });
  await restrict(restricted.id);
  await addToProject(shared.id, guest.id, "viewer");
  await addToProject(editable.id, guest.id, "member");
  await addToProject(restricted.id, insider.id, "viewer");

  const { app } = createApp();
  const as = (user: User) => {
    mockAuthenticatedSession(user);
    return app;
  };
  return {
    as,
    workspace,
    owner,
    admin,
    member,
    viewer,
    guest,
    otherGuest,
    insider,
    shared,
    editable,
    hidden,
    restricted,
  };
}

describe("API integration: guests and the risk radar and retros", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("refuses a guest the radar and the retro even in their own project, so no hidden blocker is counted for them", async () => {
    const s = await seed();
    const [blocked] = await db
      .insert(schema.taskTable)
      .values({ projectId: s.editable.id, title: "Blocked", status: "to-do" })
      .returning();
    const [blocker] = await db
      .insert(schema.taskTable)
      .values({
        projectId: s.restricted.id,
        title: "Restricted blocker",
        status: "to-do",
      })
      .returning();
    if (!blocked || !blocker) throw new Error("Failed to seed tasks");
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: blocker.id,
      targetTaskId: blocked.id,
      relationType: "blocks",
    });
    const [cycle] = await db
      .insert(schema.cycleTable)
      .values({
        projectId: s.editable.id,
        name: "Now",
        startDate: "2026-11-01",
        endDate: "2026-11-20",
      })
      .returning();
    if (!cycle) throw new Error("Failed to seed a cycle");
    await db
      .insert(schema.cycleTaskTable)
      .values({ cycleId: cycle.id, taskId: blocked.id });

    // The guest role holds no analytics:read, which every one of these
    // needs, and the role can't be edited.
    for (const path of [
      `/api/delivery/project/${s.editable.id}/risks`,
      `/api/delivery/cycle/${cycle.id}/risks`,
      `/api/insight/retro/cycle/${cycle.id}`,
    ]) {
      const denied = await s.as(s.guest).request(path);
      expect(denied.status, path).toBe(403);
      expect(await denied.text(), path).not.toContain("hiddenBlockers");
    }

    // A member keeps hearing of the restricted blocker, unnamed.
    const risks = await s
      .as(s.member)
      .request(`/api/delivery/project/${s.editable.id}/risks`);
    expect(risks.status, await risks.clone().text()).toBe(200);
    const body = (await risks.json()) as { hiddenBlockers: number };
    expect(body.hiddenBlockers).toBe(1);
    expect(JSON.stringify(body)).not.toContain("Restricted blocker");
  });
});

describe("API integration: a project's people for pickers", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  const ids = (people: { id: string }[]) => people.map((p) => p.id).sort();

  it("gives a guest the people of their project and nobody else", async () => {
    const s = await seed();
    const response = await s
      .as(s.guest)
      .request(`/api/project/${s.editable.id}/people`);
    expect(response.status, await response.clone().text()).toBe(200);
    const text = await response.clone().text();
    const people = (await response.json()) as {
      id: string;
      name: string;
      image: string | null;
    }[];
    // Everyone the open project reaches, the guest included; not the guest
    // who wasn't added.
    expect(ids(people)).toEqual(
      [
        s.owner.id,
        s.admin.id,
        s.member.id,
        s.viewer.id,
        s.insider.id,
        s.guest.id,
      ].sort(),
    );
    expect(Object.keys(people[0] ?? {}).sort()).toEqual([
      "id",
      "image",
      "name",
    ]);
    expect(text).not.toContain("@example.com");

    expect(
      (await s.as(s.guest).request(`/api/project/${s.hidden.id}/people`))
        .status,
    ).toBe(404);
  });

  it("lists only who reaches a restricted project", async () => {
    const s = await seed();
    const response = await s
      .as(s.owner)
      .request(`/api/project/${s.restricted.id}/people`);
    expect(response.status).toBe(200);
    expect(ids((await response.json()) as { id: string }[])).toEqual(
      [s.owner.id, s.admin.id, s.insider.id].sort(),
    );
    expect(
      (await s.as(s.member).request(`/api/project/${s.restricted.id}/people`))
        .status,
    ).toBe(404);
  });
});

describe("API integration: my project roles in a workspace", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  type Rights = {
    projects: {
      projectId: string;
      projectRole: string;
      statements: Record<string, string[]>;
    }[];
  };
  const rights = async (s: Awaited<ReturnType<typeof seed>>, user: User) => {
    const response = await s
      .as(user)
      .request(`/api/project/access/mine?workspaceId=${s.workspace.id}`);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Rights;
    return new Map(body.projects.map((entry) => [entry.projectId, entry]));
  };

  it("names each project role that caps a guest or restricted member, with what it grants", async () => {
    const s = await seed();
    const guest = await rights(s, s.guest);
    // Only the guest's own projects, never one they weren't added to.
    expect([...guest.keys()].sort()).toEqual(
      [s.shared.id, s.editable.id].sort(),
    );
    expect(guest.get(s.shared.id)?.projectRole).toBe("viewer");
    expect(guest.get(s.shared.id)?.statements.task).toEqual(["read"]);
    expect(guest.get(s.editable.id)?.projectRole).toBe("member");
    expect(guest.get(s.editable.id)?.statements.task).toContain("update");

    const insider = await rights(s, s.insider);
    expect([...insider.keys()]).toEqual([s.restricted.id]);
    expect(insider.get(s.restricted.id)?.statements.task).toEqual(["read"]);

    // Nothing caps an open project's members, or owners anywhere.
    await addToProject(s.shared.id, s.member.id, "viewer");
    expect((await rights(s, s.member)).size).toBe(0);
    await addToProject(s.restricted.id, s.owner.id, "viewer");
    expect((await rights(s, s.owner)).size).toBe(0);
  });

  it("reads a custom or edited project role from the workspace", async () => {
    const s = await seed();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: s.workspace.id,
      role: "commenter",
      permission: JSON.stringify({ project: ["read"], task: ["read"] }),
    });
    await db
      .update(projectMemberTable)
      .set({ role: "commenter" })
      .where(
        and(
          eq(projectMemberTable.projectId, s.restricted.id),
          eq(projectMemberTable.userId, s.insider.id),
        ),
      );
    expect((await rights(s, s.insider)).get(s.restricted.id)).toEqual({
      projectId: s.restricted.id,
      projectRole: "commenter",
      statements: { project: ["read"], task: ["read"] },
    });
  });
});

describe("API integration: project roles cap analytics", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function openTask(projectId: string, assignee: string) {
    const [task] = await db
      .insert(schema.taskTable)
      .values({ projectId, title: "Open work", status: "to-do" })
      .returning();
    if (!task) throw new Error("Failed to seed a task");
    await db
      .insert(schema.taskAssigneeTable)
      .values({ taskId: task.id, userId: assignee });
  }

  it("refuses a scope naming a project where the role reads only, and leaves it out otherwise", async () => {
    const s = await seed();
    await openTask(s.shared.id, s.member.id);
    await openTask(s.restricted.id, s.member.id);
    const workload = (user: User, projectIds?: string) =>
      s
        .as(user)
        .request(
          `/api/analytics/workload?workspaceId=${s.workspace.id}${projectIds ? `&projectIds=${projectIds}` : ""}`,
        );
    const tasksOf = async (response: Response) => {
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as {
        members: { userId: string | null; tasks: number }[];
      };
      return body.members.find((m) => m.userId === s.member.id)?.tasks ?? 0;
    };

    // The insider is a workspace member and a viewer of the restricted one.
    expect((await workload(s.insider, s.restricted.id)).status).toBe(403);
    const chart = await s.as(s.insider).request(
      "/api/analytics/chart",
      json("POST", {
        workspaceId: s.workspace.id,
        scope: { projectIds: [s.restricted.id] },
        xAxis: "priority",
      }),
    );
    expect(chart.status, await chart.clone().text()).toBe(403);
    expect(await tasksOf(await workload(s.insider))).toBe(1);

    // As a member of it they read it too; an owner always does.
    await db
      .update(projectMemberTable)
      .set({ role: "member" })
      .where(eq(projectMemberTable.userId, s.insider.id));
    expect(await tasksOf(await workload(s.insider))).toBe(2);
    expect(await tasksOf(await workload(s.insider, s.restricted.id))).toBe(1);
    expect(await tasksOf(await workload(s.owner))).toBe(2);
  });
});

describe("API integration: auditing an invitation's projects", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("records who changed them and how", async () => {
    const client = authClient();
    const owner = await client.signup("Olive");
    const workspace = await client.ok<{ id: string }>(
      "/organization/create",
      { name: "Audit Co", slug: `audit-${randomUUID().slice(0, 8)}` },
      owner.cookie,
    );
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
      slug: "aud",
    });
    const invitation = await client.ok<{ id: string }>(
      "/organization/invite-member",
      {
        email: "guest@example.com",
        role: "guest",
        organizationId: workspace.id,
      },
      owner.cookie,
    );
    const put = (projects: { projectId: string; role: string }[]) =>
      client.app.request(`/api/invitation/${invitation.id}/projects`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ projects }),
      });
    expect(
      (await put([{ projectId: project.id, role: "member" }])).status,
    ).toBe(200);
    // The same list again changes nothing and records nothing.
    expect(
      (await put([{ projectId: project.id, role: "member" }])).status,
    ).toBe(200);
    const entries = (await auditRows(workspace.id)).filter(
      (row) => row.action === "member.invitation_projects_changed",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorUserId: owner.id,
      targetType: "invitation",
      targetId: invitation.id,
      targetLabel: "guest@example.com",
      metadata: {
        changes: {
          projects: { before: [], after: [`${project.id}:member`] },
        },
      },
    });
  });
});

describe("API integration: inviting a guest straight into projects", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function scene() {
    const client = authClient();
    const owner = await client.signup("Olive");
    const workspace = await client.ok<{ id: string }>(
      "/organization/create",
      { name: "Guest Co", slug: `guest-${randomUUID().slice(0, 8)}` },
      owner.cookie,
    );
    const { project: alpha } = await createProjectFixture({
      workspaceId: workspace.id,
      slug: "alp",
    });
    const { project: beta } = await createProjectFixture({
      workspaceId: workspace.id,
      slug: "bet",
    });
    const { project: closed } = await createProjectFixture({
      workspaceId: workspace.id,
      slug: "cls",
    });
    await restrict(closed.id);
    const request = (
      method: string,
      path: string,
      cookie: string,
      body?: unknown,
    ) =>
      client.app.request(`/api${path}`, {
        method,
        headers: {
          Origin: ORIGIN,
          Cookie: cookie,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const invite = async (
      email: string,
      role = "guest",
      cookie = owner.cookie,
    ) =>
      client.ok<{ id: string }>(
        "/organization/invite-member",
        { email, role, organizationId: workspace.id },
        cookie,
      );
    const setProjects = (
      invitationId: string,
      projects: { projectId: string; role: string }[],
      cookie = owner.cookie,
    ) =>
      request("PUT", `/invitation/${invitationId}/projects`, cookie, {
        projects,
      });
    /** Someone holding a custom role that may invite but not share. */
    const inviter = async () => {
      await db.insert(schema.workspaceRoleTable).values({
        workspaceId: workspace.id,
        role: "inviter",
        // Everything the guest role holds, so a guest invitation stays
        // within it, and invitations; no project:share.
        permission: JSON.stringify({
          project: ["read"],
          task: ["create", "read", "update"],
          label: ["read"],
          cycle: ["read"],
          module: ["read"],
          view: ["read"],
          page: ["read"],
          invitation: ["create"],
        }),
      });
      const user = await client.signup("Ivy");
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "inviter",
        joinedAt: new Date(),
      });
      return user;
    };
    return {
      ...client,
      owner,
      workspaceId: workspace.id,
      alpha,
      beta,
      closed,
      request,
      invite,
      setProjects,
      inviter,
    };
  }

  it("adds the guest to the chosen projects with their roles when they accept", async () => {
    const s = await scene();
    const guest = await s.signup("Gus");
    const invitation = await s.invite(guest.email);
    const set = await s.setProjects(invitation.id, [
      { projectId: s.alpha.id, role: "member" },
      { projectId: s.closed.id, role: "viewer" },
    ]);
    expect(set.status, await set.clone().text()).toBe(200);
    expect(await set.json()).toEqual({
      projects: expect.arrayContaining([
        { projectId: s.alpha.id, role: "member" },
        { projectId: s.closed.id, role: "viewer" },
      ]),
    });

    await s.ok(
      "/organization/accept-invitation",
      { invitationId: invitation.id },
      guest.cookie,
    );

    const list = await s.request(
      "GET",
      `/project?workspaceId=${s.workspaceId}`,
      guest.cookie,
    );
    expect(list.status).toBe(200);
    const projects = (await list.json()) as { id: string }[];
    expect(projects.map((project) => project.id).sort()).toEqual(
      [s.alpha.id, s.closed.id].sort(),
    );
    const roles = await db
      .select({
        projectId: projectMemberTable.projectId,
        role: projectMemberTable.role,
        addedBy: projectMemberTable.addedBy,
      })
      .from(projectMemberTable)
      .where(eq(projectMemberTable.userId, guest.id));
    expect(roles).toEqual(
      expect.arrayContaining([
        { projectId: s.alpha.id, role: "member", addedBy: s.owner.id },
        { projectId: s.closed.id, role: "viewer", addedBy: s.owner.id },
      ]),
    );
    expect(roles).toHaveLength(2);

    // The roles hold: tasks in alpha, reads only in the restricted one.
    const task = (projectId: string) =>
      s.request("POST", `/task/${projectId}`, guest.cookie, {
        title: "From the guest",
        description: "",
        status: "to-do",
        priority: "low",
      });
    expect((await task(s.alpha.id)).status).toBe(200);
    expect((await task(s.closed.id)).status).toBe(403);
    expect((await task(s.beta.id)).status).toBe(404);
  });

  it("replaces and clears the list, and skips a project trashed before acceptance", async () => {
    const s = await scene();
    const guest = await s.signup("Gus");
    const invitation = await s.invite(guest.email);
    await s.setProjects(invitation.id, [
      { projectId: s.alpha.id, role: "member" },
    ]);
    const replaced = await s.setProjects(invitation.id, [
      { projectId: s.beta.id, role: "viewer" },
    ]);
    expect(await replaced.json()).toEqual({
      projects: [{ projectId: s.beta.id, role: "viewer" }],
    });
    const cleared = await s.setProjects(invitation.id, []);
    expect(await cleared.json()).toEqual({ projects: [] });

    await s.setProjects(invitation.id, [
      { projectId: s.alpha.id, role: "member" },
      { projectId: s.beta.id, role: "member" },
    ]);
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, s.beta.id));
    await s.ok(
      "/organization/accept-invitation",
      { invitationId: invitation.id },
      guest.cookie,
    );
    const rows = await db
      .select({ projectId: projectMemberTable.projectId })
      .from(projectMemberTable)
      .where(eq(projectMemberTable.userId, guest.id));
    expect(rows).toEqual([{ projectId: s.alpha.id }]);

    // Accepted: no more changes.
    const late = await s.setProjects(invitation.id, []);
    expect(late.status).toBe(409);
  });

  it("only shares projects the inviter may share", async () => {
    const s = await scene();
    const ivy = await s.inviter();
    const invitation = await s.invite(
      "friend@example.com",
      "guest",
      ivy.cookie,
    );

    const noShare = await s.setProjects(
      invitation.id,
      [{ projectId: s.alpha.id, role: "viewer" }],
      ivy.cookie,
    );
    expect(noShare.status).toBe(403);

    // As the project's lead they may share that one, and only that one.
    await db
      .update(schema.projectTable)
      .set({ leadUserId: ivy.id })
      .where(eq(schema.projectTable.id, s.alpha.id));
    const asLead = await s.setProjects(
      invitation.id,
      [{ projectId: s.alpha.id, role: "viewer" }],
      ivy.cookie,
    );
    expect(asLead.status, await asLead.clone().text()).toBe(200);
    const mixed = await s.setProjects(
      invitation.id,
      [
        { projectId: s.alpha.id, role: "viewer" },
        { projectId: s.beta.id, role: "viewer" },
      ],
      ivy.cookie,
    );
    expect(mixed.status).toBe(403);
    // A refused change leaves the list as it was.
    expect(
      await db
        .select({ projectId: invitationProjectTable.projectId })
        .from(invitationProjectTable),
    ).toEqual([{ projectId: s.alpha.id }]);

    // A restricted project they aren't in reads as missing.
    const hidden = await s.setProjects(
      invitation.id,
      [{ projectId: s.closed.id, role: "viewer" }],
      ivy.cookie,
    );
    expect(hidden.status).toBe(404);
  });

  it("refuses projects of another workspace, unknown roles and duplicates", async () => {
    const s = await scene();
    const invitation = await s.invite("friend@example.com");
    const { workspace: other } = await createWorkspaceMember({ role: "owner" });
    const { project: foreign } = await createProjectFixture({
      workspaceId: other.id,
    });
    expect(
      (
        await s.setProjects(invitation.id, [
          { projectId: foreign.id, role: "viewer" },
        ])
      ).status,
    ).toBe(404);
    for (const role of ["guest", "owner", "nonexistent"]) {
      const refused = await s.setProjects(invitation.id, [
        { projectId: s.alpha.id, role },
      ]);
      expect(refused.status, role).toBe(400);
    }
    const twice = await s.setProjects(invitation.id, [
      { projectId: s.alpha.id, role: "viewer" },
      { projectId: s.alpha.id, role: "member" },
    ]);
    expect(twice.status).toBe(400);
    expect(await db.select().from(invitationProjectTable)).toEqual([]);
  });

  it("refuses someone without invitation rights, and a guest", async () => {
    const s = await scene();
    const invitation = await s.invite("friend@example.com");
    const member = await s.signup("Mia");
    await s.ok(
      "/organization/accept-invitation",
      { invitationId: (await s.invite(member.email, "member")).id },
      member.cookie,
    );
    const guest = await s.signup("Gus");
    await s.ok(
      "/organization/accept-invitation",
      { invitationId: (await s.invite(guest.email)).id },
      guest.cookie,
    );
    const projects = [{ projectId: s.alpha.id, role: "viewer" }];
    expect(
      (await s.setProjects(invitation.id, projects, member.cookie)).status,
    ).toBe(403);
    expect(
      (await s.setProjects(invitation.id, projects, guest.cookie)).status,
    ).toBe(404);
  });
});

describe("API integration: guests and seats", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("counts a guest as a billable seat, and an agent never", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    await addWorkspaceMember(workspace.id, "guest");
    const agent = await addWorkspaceMember(workspace.id, "member");
    await db
      .update(schema.userTable)
      .set({ kind: "agent" })
      .where(eq(schema.userTable.id, agent.id));
    expect(await billableMemberCount(workspace.id)).toBe(2);
  });
});
