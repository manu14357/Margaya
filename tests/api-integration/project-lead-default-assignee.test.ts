import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { clearMemberProjectRoles } from "../../apps/api/src/project/people";
import { assigneesOfTask } from "../../apps/api/src/task/assignees";
import { mockAuthenticatedSession } from "./helpers/auth";
import { json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { intakeScene } from "./helpers/intake";

const ORIGIN = "http://localhost:5173";

const projectEvents: Array<Record<string, unknown>> = [];
await subscribeToEvent<Record<string, unknown>>(
  "project.updated",
  async (data) => {
    projectEvents.push(data);
  },
);

beforeEach(async () => {
  await resetTestDatabase();
  projectEvents.length = 0;
});

async function scene() {
  const admin = await createWorkspaceMember({ role: "admin" });
  const teammate = await addWorkspaceMember(admin.workspace.id);
  const outsider = await createWorkspaceMember();
  const { project } = await createProjectFixture({
    workspaceId: admin.workspace.id,
    slug: "led",
  });
  mockAuthenticatedSession(admin.user);
  const { app } = createApp();
  const request = (path: string, init?: RequestInit) =>
    app.request(`/api${path}`, init);
  const update = (people: Record<string, string | null | undefined>) =>
    request(
      `/project/${project.id}`,
      json("PUT", {
        name: project.name,
        icon: project.icon ?? "Folder",
        slug: project.slug,
        description: "",
        isPublic: false,
        ...people,
      }),
    );
  return { ...admin, teammate, outsider, project, request, update };
}

async function projectRow(projectId: string) {
  const [row] = await db
    .select()
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, projectId));
  return row;
}

describe("API integration: project lead and default assignee", () => {
  it("sets both fields, publishes project.updated and keeps them when omitted", async () => {
    const s = await scene();
    const response = await s.update({
      leadUserId: s.user.id,
      defaultAssigneeUserId: s.teammate.id,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      leadUserId: s.user.id,
      defaultAssigneeUserId: s.teammate.id,
    });
    expect(projectEvents).toContainEqual(
      expect.objectContaining({
        projectId: s.project.id,
        changed: expect.arrayContaining([
          "leadUserId",
          "defaultAssigneeUserId",
        ]),
      }),
    );

    // A profile save without the fields leaves them alone.
    expect((await s.update({})).status).toBe(200);
    expect(await projectRow(s.project.id)).toMatchObject({
      leadUserId: s.user.id,
      defaultAssigneeUserId: s.teammate.id,
    });

    expect((await s.update({ leadUserId: null })).status).toBe(200);
    expect((await projectRow(s.project.id))?.leadUserId).toBeNull();
  });

  it("rejects people outside the workspace", async () => {
    const s = await scene();
    for (const field of ["leadUserId", "defaultAssigneeUserId"]) {
      const response = await s.update({ [field]: s.outsider.user.id });
      expect(response.status).toBe(400);
      const unknown = await s.update({ [field]: `user-${randomUUID()}` });
      expect(unknown.status).toBe(400);
    }
    expect(await projectRow(s.project.id)).toMatchObject({
      leadUserId: null,
      defaultAssigneeUserId: null,
    });
  });

  it("applies the default only when the create omits assignees", async () => {
    const s = await scene();
    await s.update({ defaultAssigneeUserId: s.teammate.id });
    const create = async (extra: Record<string, unknown>) => {
      const response = await s.request(
        `/task/${s.project.id}`,
        json("POST", {
          title: "New",
          description: "",
          priority: "no-priority",
          status: "to-do",
          ...extra,
        }),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const task = (await response.json()) as { id: string };
      return assigneesOfTask(task.id);
    };

    expect(await create({})).toEqual([s.teammate.id]);
    expect(await create({ assigneeIds: [] })).toEqual([]);
    expect(await create({ assigneeIds: [s.user.id] })).toEqual([s.user.id]);
    expect(await create({ userId: s.user.id })).toEqual([s.user.id]);
  });

  it("clears both fields when the member is removed", async () => {
    const s = await scene();
    await s.update({
      leadUserId: s.teammate.id,
      defaultAssigneeUserId: s.teammate.id,
    });
    projectEvents.length = 0;
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, s.teammate.id));
    await clearMemberProjectRoles(s.workspace.id, s.teammate.id);

    expect(await projectRow(s.project.id)).toMatchObject({
      leadUserId: null,
      defaultAssigneeUserId: null,
    });
    expect(projectEvents).toContainEqual(
      expect.objectContaining({
        projectId: s.project.id,
        changed: ["leadUserId", "defaultAssigneeUserId"],
      }),
    );
  });
});

describe("API integration: intake accept assigns the default", () => {
  it("assigns an unassigned request and leaves an assigned one alone", async () => {
    const s = await intakeScene();
    await db
      .update(schema.projectTable)
      .set({ defaultAssigneeUserId: s.member.id })
      .where(eq(schema.projectTable.id, s.project.id));

    const plain = await s.submit(s.admin, { title: "Unassigned" });
    const accepted = await s.action(s.admin, plain.id, "accept", {
      status: "to-do",
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect(await assigneesOfTask(plain.taskId)).toEqual([s.member.id]);
    const [task] = await db
      .select({ userId: schema.taskTable.userId })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, plain.taskId));
    expect(task?.userId).toBe(s.member.id);

    const owned = await s.submit(s.admin, { title: "Owned" });
    await db.insert(schema.taskAssigneeTable).values({
      taskId: owned.taskId,
      userId: s.admin.id,
      position: 0,
    });
    await s.action(s.admin, owned.id, "accept", { status: "to-do" });
    expect(await assigneesOfTask(owned.taskId)).toEqual([s.admin.id]);
  });
});

describe("API integration: member removal through Better Auth", () => {
  it("clears the project roles of a removed member", async () => {
    const { app } = createApp();
    const call = (path: string, body: unknown, cookie = "") =>
      app.request(`/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      });
    const signup = async (name: string) => {
      const email = `${name}-${randomUUID()}@example.com`;
      const response = await call("/sign-up/email", {
        name,
        email,
        password: "long-password-for-tests",
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as { user: { id: string } };
      const cookie = response.headers
        .getSetCookie()
        .map((entry) => entry.split(";")[0])
        .join("; ");
      return { id: body.user.id, email, cookie };
    };
    const ok = async <T>(path: string, body: unknown, cookie: string) => {
      const response = await call(path, body, cookie);
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json()) as T;
    };

    const owner = await signup("owner");
    const lead = await signup("lead");
    const workspace = await ok<{ id: string }>(
      "/organization/create",
      { name: "Lead Co", slug: `lead-${randomUUID().slice(0, 8)}` },
      owner.cookie,
    );
    const invitation = await ok<{ id: string }>(
      "/organization/invite-member",
      { email: lead.email, role: "member", organizationId: workspace.id },
      owner.cookie,
    );
    const joined = await ok<{ member: { id: string } }>(
      "/organization/accept-invitation",
      { invitationId: invitation.id },
      lead.cookie,
    );
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
      slug: "rm",
    });
    await db
      .update(schema.projectTable)
      .set({ leadUserId: lead.id, defaultAssigneeUserId: lead.id })
      .where(eq(schema.projectTable.id, project.id));

    await ok(
      "/organization/remove-member",
      { memberIdOrEmail: joined.member.id, organizationId: workspace.id },
      owner.cookie,
    );

    expect(await projectRow(project.id)).toMatchObject({
      leadUserId: null,
      defaultAssigneeUserId: null,
    });
  });
});
