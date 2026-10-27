import { expect, test } from "../../fixtures";
import {
  addMember,
  createProject,
  createTask,
  expectJson,
  expectStatus,
  signUpUser,
  type TestUser,
  verifyEmail,
  type Workspace,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Better Auth organization management (workspaces, invitations, roles and
// teams) plus Margaya's invitation and member routes. Everything runs in a
// workspace this file creates with fresh accounts: never on the seeded one.

type Member = { id: string; userId: string; role: string };
type Deletion = {
  pending: boolean;
  dueAt: string | null;
  scheduledBy: { id: string; name: string } | null;
  graceDays: number;
};
type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  organizationId: string;
};

let owner: TestUser;
let member: TestUser;
let invitee: TestUser;
let workspace: Workspace;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  owner = await signUpUser("org owner");
  member = await signUpUser("org member");
  invitee = await signUpUser("org invitee");
});

test.afterAll(async () => {
  await Promise.all(
    [owner, member, invitee].map((user) => user?.ctx.dispose()),
  );
});

async function listMembers(): Promise<Member[]> {
  const body = await expectJson<{ members: Member[] }>(
    await owner.ctx.get("/api/auth/organization/list-members", {
      params: { organizationId: workspace.id },
    }),
  );
  return body.members;
}

test(
  "check a slug, create a workspace and list it",
  covers(
    "checkOrganizationSlug",
    "createOrganization",
    "listOrganization",
    "setOrganizationActive",
    "getOrganizationFullOrganization",
    "getOrganizationActiveMember",
    "getOrganizationActiveMemberRole",
  ),
  async () => {
    const slug = `e2e-org-${Date.now().toString(36)}`;
    const free = await expectJson<{ status: boolean }>(
      await owner.ctx.post("/api/auth/organization/check-slug", {
        data: { slug },
      }),
    );
    expect(free.status).toBe(true);

    const name = uniqueName("E2E Org");
    workspace = await expectJson<Workspace>(
      await owner.ctx.post("/api/auth/organization/create", {
        data: { name, slug },
      }),
    );
    expect(workspace).toMatchObject({ name, slug });

    const taken = await expectStatus(
      await owner.ctx.post("/api/auth/organization/check-slug", {
        data: { slug },
      }),
      400,
    );
    expect(taken).toContain("ORGANIZATION_SLUG_ALREADY_TAKEN");

    const listed = await expectJson<Workspace[]>(
      await owner.ctx.get("/api/auth/organization/list"),
    );
    expect(listed.map((entry) => entry.id)).toContain(workspace.id);

    const active = await expectJson<Workspace>(
      await owner.ctx.post("/api/auth/organization/set-active", {
        data: { organizationId: workspace.id },
      }),
    );
    expect(active.id).toBe(workspace.id);

    const full = await expectJson<Workspace & { members: Member[] }>(
      await owner.ctx.get("/api/auth/organization/get-full-organization", {
        params: { organizationId: workspace.id },
      }),
    );
    expect(full.members).toHaveLength(1);
    expect(full.members[0]).toMatchObject({ role: "owner", userId: owner.id });

    const activeMember = await expectJson<Member & { organizationId: string }>(
      await owner.ctx.get("/api/auth/organization/get-active-member"),
    );
    expect(activeMember).toMatchObject({
      userId: owner.id,
      organizationId: workspace.id,
      role: "owner",
    });
    const activeRole = await expectJson<{ role: string }>(
      await owner.ctx.get("/api/auth/organization/get-active-member-role"),
    );
    expect(activeRole.role).toBe("owner");
  },
);

test("creating a workspace validates its body", async () => {
  await expectStatus(
    await owner.ctx.post("/api/auth/organization/create", {
      data: { slug: "e2e-missing-name" },
    }),
    400,
  );
});

test(
  "invite, inspect and accept an invitation; the workspace member list shows the member",
  covers(
    "inviteOrganizationMember",
    "listOrganizationInvitations",
    "getOrganizationInvitation",
    "getInvitationDetails",
    "getUserPendingInvitations",
    "listOrganizationUserInvitations",
    "acceptOrganizationInvitation",
    "listOrganizationMembers",
    "getWorkspaceMembers",
  ),
  async ({ api }) => {
    const invitation = await expectJson<Invitation>(
      await owner.ctx.post("/api/auth/organization/invite-member", {
        data: {
          email: member.email,
          role: "member",
          organizationId: workspace.id,
        },
      }),
    );
    expect(invitation).toMatchObject({
      email: member.email,
      role: "member",
      status: "pending",
      organizationId: workspace.id,
    });

    const invitations = await expectJson<Invitation[]>(
      await owner.ctx.get("/api/auth/organization/list-invitations", {
        params: { organizationId: workspace.id },
      }),
    );
    expect(invitations.map((entry) => entry.id)).toContain(invitation.id);

    const fetched = await expectJson<Invitation & { organizationName: string }>(
      await member.ctx.get("/api/auth/organization/get-invitation", {
        params: { id: invitation.id },
      }),
    );
    expect(fetched.organizationName).toBe(workspace.name);

    const details = await expectJson<{
      valid: boolean;
      invitation: { workspaceName: string; email: string; status: string };
    }>(await member.ctx.get(`/api/invitation/${invitation.id}`));
    expect(details.valid).toBe(true);
    expect(details.invitation).toMatchObject({
      workspaceName: workspace.name,
      email: member.email,
      status: "pending",
    });
    const unknown = await expectJson<{ valid: boolean; error?: string }>(
      await member.ctx.get("/api/invitation/e2e-unknown-invitation"),
    );
    expect(unknown.valid).toBe(false);

    // Unverified accounts see no pending invitations (and Better Auth refuses
    // to list them); a verified account does.
    expect(
      await expectJson<unknown[]>(
        await member.ctx.get("/api/invitation/pending"),
      ),
    ).toEqual([]);
    await expectStatus(
      await member.ctx.get("/api/auth/organization/list-user-invitations"),
      403,
    );
    await verifyEmail(api, member);
    const pending = await expectJson<{ id: string; workspaceName: string }[]>(
      await member.ctx.get("/api/invitation/pending"),
    );
    expect(pending.map((entry) => entry.id)).toContain(invitation.id);
    expect(
      pending.find((entry) => entry.id === invitation.id)?.workspaceName,
    ).toBe(workspace.name);
    const userInvitations = await expectJson<Invitation[]>(
      await member.ctx.get("/api/auth/organization/list-user-invitations"),
    );
    expect(userInvitations.map((entry) => entry.id)).toContain(invitation.id);

    const accepted = await expectJson<{
      invitation: Invitation;
      member: Member;
    }>(
      await member.ctx.post("/api/auth/organization/accept-invitation", {
        data: { invitationId: invitation.id },
      }),
    );
    expect(accepted.invitation.status).toBe("accepted");
    expect(accepted.member).toMatchObject({
      userId: member.id,
      role: "member",
    });

    const members = await listMembers();
    expect(members.map((entry) => entry.userId).sort()).toEqual(
      [owner.id, member.id].sort(),
    );

    const workspaceMembers = await expectJson<
      { id: string; email: string; role: string }[]
    >(await member.ctx.get(`/api/workspace/${workspace.id}/members`));
    expect(workspaceMembers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: member.id,
          email: member.email,
          role: "member",
        }),
        expect.objectContaining({ id: owner.id, role: "owner" }),
      ]),
    );
  },
);

test("a member cannot invite people or rename the workspace", async () => {
  await member.ctx.post("/api/auth/organization/set-active", {
    data: { organizationId: workspace.id },
  });
  await expectStatus(
    await member.ctx.post("/api/auth/organization/invite-member", {
      data: {
        email: invitee.email,
        role: "viewer",
        organizationId: workspace.id,
      },
    }),
    403,
  );
  await expectStatus(
    await member.ctx.post("/api/auth/organization/update", {
      data: { organizationId: workspace.id, data: { name: "Hijacked" } },
    }),
    403,
  );
});

test(
  "reject and cancel invitations",
  covers("rejectOrganizationInvitation", "cancelOrganizationInvitation"),
  async () => {
    const first = await expectJson<Invitation>(
      await owner.ctx.post("/api/auth/organization/invite-member", {
        data: {
          email: invitee.email,
          role: "viewer",
          organizationId: workspace.id,
        },
      }),
    );
    const rejected = await expectJson<{ invitation: Invitation; member: null }>(
      await invitee.ctx.post("/api/auth/organization/reject-invitation", {
        data: { invitationId: first.id },
      }),
    );
    expect(rejected.invitation.status).toBe("rejected");
    expect(rejected.member).toBeNull();

    const second = await expectJson<Invitation>(
      await owner.ctx.post("/api/auth/organization/invite-member", {
        data: {
          email: invitee.email,
          role: "viewer",
          organizationId: workspace.id,
        },
      }),
    );
    const canceled = await expectJson<Invitation>(
      await owner.ctx.post("/api/auth/organization/cancel-invitation", {
        data: { invitationId: second.id },
      }),
    );
    expect(canceled.status).toBe("canceled");

    // A canceled invitation cannot be accepted.
    await expectStatus(
      await invitee.ctx.post("/api/auth/organization/accept-invitation", {
        data: { invitationId: second.id },
      }),
      [400, 403, 404],
    );
    const details = await expectJson<{ valid: boolean }>(
      await invitee.ctx.get(`/api/invitation/${second.id}`),
    );
    expect(details.valid).toBe(false);
    expect((await listMembers()).map((entry) => entry.userId)).not.toContain(
      invitee.id,
    );
  },
);

test(
  "custom roles: create, read, update, grant to a member and delete",
  covers(
    "listOrganizationRoles",
    "createOrganizationRole",
    "getOrganizationRole",
    "updateOrganizationRole",
    "hasOrganizationPermission",
    "updateOrganizationMemberRole",
    "deleteOrganizationRole",
  ),
  async () => {
    const roles = await expectJson<{ role: string }[]>(
      await owner.ctx.get("/api/auth/organization/list-roles", {
        params: { organizationId: workspace.id },
      }),
    );
    // The editable defaults are seeded per workspace; owner stays static.
    expect(roles.map((role) => role.role)).toEqual(
      expect.arrayContaining(["viewer", "member", "admin"]),
    );

    const roleName = `reviewer${Date.now().toString(36)}`;
    const created = await expectJson<{
      success: boolean;
      roleData: { role: string; permission: Record<string, string[]> };
    }>(
      await owner.ctx.post("/api/auth/organization/create-role", {
        data: {
          organizationId: workspace.id,
          role: roleName,
          permission: { project: ["read"], task: ["read", "update"] },
        },
      }),
    );
    expect(created.success).toBe(true);
    expect(created.roleData.permission.task).toEqual(["read", "update"]);

    const fetched = await expectJson<{
      role: string;
      permission: Record<string, string[]>;
    }>(
      await owner.ctx.get("/api/auth/organization/get-role", {
        params: { organizationId: workspace.id, roleName },
      }),
    );
    expect(fetched.role).toBe(roleName);

    // The member cannot create roles.
    await expectStatus(
      await member.ctx.post("/api/auth/organization/create-role", {
        data: {
          organizationId: workspace.id,
          role: `${roleName}x`,
          permission: { project: ["read"] },
        },
      }),
      403,
    );

    const memberRow = (await listMembers()).find(
      (entry) => entry.userId === member.id,
    );
    expect(memberRow).toBeTruthy();
    const updatedMember = await expectJson<Member>(
      await owner.ctx.post("/api/auth/organization/update-member-role", {
        data: {
          memberId: memberRow?.id,
          role: roleName,
          organizationId: workspace.id,
        },
      }),
    );
    expect(updatedMember.role).toBe(roleName);

    // Margaya enforces the custom role: task:update but no task:create.
    const project = await createProject(owner.ctx, workspace.id);
    const task = await createTask(owner.ctx, project.id);
    await expectJson(
      await member.ctx.put(`/api/task/title/${task.id}`, {
        data: { title: "Renamed by a reviewer" },
      }),
    );
    await expectStatus(
      await member.ctx.post(`/api/task/${project.id}`, {
        data: { title: "x", description: "", priority: "low", status: "to-do" },
      }),
      403,
    );
    const canUpdate = await expectJson<{ success: boolean }>(
      await member.ctx.post("/api/auth/organization/has-permission", {
        data: {
          organizationId: workspace.id,
          permissions: { task: ["update"] },
        },
      }),
    );
    expect(canUpdate.success).toBe(true);

    // Narrow the role: task:update goes away for its holder.
    const narrowed = await expectJson<{
      success: boolean;
      roleData: { permission: Record<string, string[]> };
    }>(
      await owner.ctx.post("/api/auth/organization/update-role", {
        data: {
          organizationId: workspace.id,
          roleName,
          data: { permission: { project: ["read"], task: ["read"] } },
        },
      }),
    );
    expect(narrowed.roleData.permission.task).toEqual(["read"]);
    const cannotUpdate = await expectJson<{ success: boolean }>(
      await member.ctx.post("/api/auth/organization/has-permission", {
        data: {
          organizationId: workspace.id,
          permissions: { task: ["update"] },
        },
      }),
    );
    expect(cannotUpdate.success).toBe(false);
    await expectStatus(
      await member.ctx.put(`/api/task/title/${task.id}`, {
        data: { title: "Renamed again" },
      }),
      403,
    );

    // Back to member, then remove the role.
    await expectJson(
      await owner.ctx.post("/api/auth/organization/update-member-role", {
        data: {
          memberId: memberRow?.id,
          role: "member",
          organizationId: workspace.id,
        },
      }),
    );
    const deleted = await expectJson<{ success: boolean }>(
      await owner.ctx.post("/api/auth/organization/delete-role", {
        data: { organizationId: workspace.id, roleName },
      }),
    );
    expect(deleted.success).toBe(true);
    await expectStatus(
      await owner.ctx.get("/api/auth/organization/get-role", {
        params: { organizationId: workspace.id, roleName },
      }),
      [400, 404],
    );
  },
);

test(
  "teams: create, rename, add and remove members, activate and remove",
  covers(
    "createOrganizationTeam",
    "listOrganizationTeams",
    "updateOrganizationTeam",
    "addOrganizationTeamMember",
    "listOrganizationTeamMembers",
    "listOrganizationUserTeams",
    "setOrganizationActiveTeam",
    "removeOrganizationTeamMember",
    "removeOrganizationTeam",
  ),
  async () => {
    type Team = { id: string; name: string; organizationId: string };
    const team = await expectJson<Team>(
      await owner.ctx.post("/api/auth/organization/create-team", {
        data: { name: uniqueName("Team"), organizationId: workspace.id },
      }),
    );
    expect(team.organizationId).toBe(workspace.id);

    const teams = await expectJson<Team[]>(
      await owner.ctx.get("/api/auth/organization/list-teams", {
        params: { organizationId: workspace.id },
      }),
    );
    expect(teams.map((entry) => entry.id)).toContain(team.id);

    const renamedTo = uniqueName("Team renamed");
    const renamed = await expectJson<Team>(
      await owner.ctx.post("/api/auth/organization/update-team", {
        data: { teamId: team.id, data: { name: renamedTo } },
      }),
    );
    expect(renamed.name).toBe(renamedTo);

    const added = await expectJson<{ teamId: string; userId: string }>(
      await owner.ctx.post("/api/auth/organization/add-team-member", {
        data: {
          teamId: team.id,
          userId: member.id,
          organizationId: workspace.id,
        },
      }),
    );
    expect(added).toMatchObject({ teamId: team.id, userId: member.id });

    // Only team members may list a team's members.
    const teamMembers = await expectJson<{ userId: string }[]>(
      await member.ctx.get("/api/auth/organization/list-team-members", {
        params: { teamId: team.id },
      }),
    );
    expect(teamMembers.map((entry) => entry.userId)).toContain(member.id);

    const userTeams = await expectJson<Team[]>(
      await member.ctx.get("/api/auth/organization/list-user-teams"),
    );
    expect(userTeams.map((entry) => entry.id)).toContain(team.id);

    await expectJson(
      await member.ctx.post("/api/auth/organization/set-active-team", {
        data: { teamId: team.id },
      }),
    );
    await expectJson(
      await member.ctx.post("/api/auth/organization/set-active-team", {
        data: { teamId: null },
      }),
    );

    const removedMember = await expectJson<{ message: string }>(
      await owner.ctx.post("/api/auth/organization/remove-team-member", {
        data: {
          teamId: team.id,
          userId: member.id,
          organizationId: workspace.id,
        },
      }),
    );
    expect(removedMember.message).toMatch(/removed/i);

    const removed = await expectJson<{ message: string }>(
      await owner.ctx.post("/api/auth/organization/remove-team", {
        data: { teamId: team.id, organizationId: workspace.id },
      }),
    );
    expect(removed.message).toMatch(/removed/i);
    const after = await expectJson<Team[]>(
      await owner.ctx.get("/api/auth/organization/list-teams", {
        params: { organizationId: workspace.id },
      }),
    );
    expect(after.map((entry) => entry.id)).not.toContain(team.id);
  },
);

test(
  "rename the workspace; members leave or are removed; schedule and cancel its deletion",
  covers(
    "updateOrganization",
    "leaveOrganization",
    "removeOrganizationMember",
    "deleteOrganization",
    "getWorkspaceDeletion",
    "scheduleWorkspaceDeletion",
    "cancelWorkspaceDeletion",
  ),
  async () => {
    const name = uniqueName("E2E Org renamed");
    const updated = await expectJson<Workspace>(
      await owner.ctx.post("/api/auth/organization/update", {
        data: { organizationId: workspace.id, data: { name } },
      }),
    );
    expect(updated.name).toBe(name);

    const left = await expectJson<Member>(
      await member.ctx.post("/api/auth/organization/leave", {
        data: { organizationId: workspace.id },
      }),
    );
    expect(left.userId).toBe(member.id);
    expect((await listMembers()).map((entry) => entry.userId)).not.toContain(
      member.id,
    );
    // Gone means locked out of Margaya's routes too.
    await expectStatus(
      await member.ctx.get(`/api/workspace/${workspace.id}/members`),
      403,
    );

    await addMember(owner.ctx, workspace.id, invitee, "viewer");
    const removed = await expectJson<{ member: Member }>(
      await owner.ctx.post("/api/auth/organization/remove-member", {
        data: { memberIdOrEmail: invitee.email, organizationId: workspace.id },
      }),
    );
    expect(removed.member.userId).toBe(invitee.id);
    await expectStatus(
      await invitee.ctx.get("/api/project", {
        params: { workspaceId: workspace.id },
      }),
      403,
    );

    // Deleting goes through a grace period: Better Auth's delete answers 409
    // until a scheduled deletion is due.
    const refused = await expectStatus(
      await owner.ctx.post("/api/auth/organization/delete", {
        data: { organizationId: workspace.id },
      }),
      409,
    );
    expect(refused).toMatch(/grace period/i);

    const deletionPath = `/api/workspace/${workspace.id}/deletion`;
    const idle = await expectJson<Deletion>(await owner.ctx.get(deletionPath));
    expect(idle).toMatchObject({ pending: false, dueAt: null });

    const scheduled = await expectJson<Deletion>(
      await owner.ctx.post(deletionPath),
    );
    expect(scheduled).toMatchObject({
      pending: true,
      scheduledBy: { id: owner.id },
    });
    const due = Date.parse(scheduled.dueAt ?? "");
    expect(due - Date.now()).toBeGreaterThan(
      (scheduled.graceDays - 1) * 86_400_000,
    );
    // Scheduling again changes nothing.
    const again = await expectJson<Deletion>(
      await owner.ctx.post(deletionPath),
    );
    expect(again.dueAt).toBe(scheduled.dueAt);
    // Still not due.
    await expectStatus(
      await owner.ctx.post("/api/auth/organization/delete", {
        data: { organizationId: workspace.id },
      }),
      409,
    );

    // Read-only meanwhile: reads work, writes answer 423 Locked.
    await expectJson(
      await owner.ctx.get("/api/project", {
        params: { workspaceId: workspace.id },
      }),
    );
    await expectStatus(
      await owner.ctx.post("/api/project", {
        data: {
          name: uniqueName("Locked project"),
          slug: `lk${Date.now().toString(36).slice(-6)}`,
          icon: "Layout",
          workspaceId: workspace.id,
        },
      }),
      423,
    );
    await expectStatus(
      await owner.ctx.post("/api/auth/organization/update", {
        data: { organizationId: workspace.id, data: { name: "Locked" } },
      }),
      423,
    );

    const cancelled = await expectJson<Deletion>(
      await owner.ctx.delete(deletionPath),
    );
    expect(cancelled).toMatchObject({ pending: false, dueAt: null });
    // Writable again.
    const project = await createProject(owner.ctx, workspace.id);
    expect(project.workspaceId).toBe(workspace.id);

    // Leave this file's workspace scheduled, so the purge job removes it.
    await expectJson(await owner.ctx.post(deletionPath));
  },
);
