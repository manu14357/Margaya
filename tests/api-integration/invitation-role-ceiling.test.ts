import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { defaultRolePayloads } from "../../packages/permissions/src";
import { auditEntry, authClient, ORIGIN } from "./helpers/audit-log";
import { resetTestDatabase } from "./helpers/database";

beforeEach(() => resetTestDatabase());

type Invitation = { id: string; role: string };

async function scene() {
  const client = authClient();
  const owner = await client.signup("Olive");
  const workspace = await client.ok<{ id: string }>(
    "/organization/create",
    { name: "Ceiling Co", slug: `ceil-${owner.id.slice(0, 8).toLowerCase()}` },
    owner.cookie,
  );
  const workspaceId = workspace.id;

  // A role that may invite but holds a member's other permissions, so the
  // ceiling (not a missing invitation permission) is what refuses admin.
  await client.ok(
    "/organization/create-role",
    {
      role: "recruiter",
      permission: {
        ...defaultRolePayloads.member,
        invitation: ["create", "cancel"],
      },
      organizationId: workspaceId,
    },
    owner.cookie,
  );

  const join = async (name: string, role: string) => {
    const user = await client.signup(name);
    const invitation = await client.ok<Invitation>(
      "/organization/invite-member",
      { email: user.email, role, organizationId: workspaceId },
      owner.cookie,
    );
    await client.ok(
      "/organization/accept-invitation",
      { invitationId: invitation.id },
      user.cookie,
    );
    return user;
  };

  const invite = (cookie: string, email: string, role: string) =>
    client.call(
      "/organization/invite-member",
      { email, role, organizationId: workspaceId },
      cookie,
    );

  const changeRole = (cookie: string, invitationId: string, role: string) =>
    client.app.request(`/api/invitation/${invitationId}/role`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        Origin: ORIGIN,
        Cookie: cookie,
      },
      body: JSON.stringify({ role }),
    });

  return { ...client, owner, workspaceId, join, invite, changeRole };
}

async function storedRole(invitationId: string) {
  const [row] = await db
    .select({ role: schema.invitationTable.role })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId));
  return row?.role;
}

describe("inviting with a role is capped at the inviter's own", () => {
  it("refuses a member inviting an admin", async () => {
    const s = await scene();
    const member = await s.join("Milo", "member");
    const response = await s.invite(member.cookie, "boss@example.com", "admin");
    expect(response.status).toBe(403);
  });

  it("refuses a role above the inviter even when they may invite", async () => {
    const s = await scene();
    const recruiter = await s.join("Rita", "recruiter");

    const above = await s.invite(recruiter.cookie, "a@example.com", "admin");
    expect(above.status).toBe(403);
    expect(await above.text()).toMatch(/beyond your own/);

    for (const role of ["member", "viewer"]) {
      const ok = await s.invite(recruiter.cookie, `${role}@example.com`, role);
      expect(ok.status, await ok.clone().text()).toBe(200);
    }
  });

  it("lets an admin invite members and viewers, and refuses unknown roles", async () => {
    const s = await scene();
    const admin = await s.join("Ada", "admin");
    for (const role of ["member", "viewer", "recruiter"]) {
      const ok = await s.invite(admin.cookie, `${role}@example.com`, role);
      expect(ok.status, await ok.clone().text()).toBe(200);
    }
    const unknown = await s.invite(admin.cookie, "x@example.com", "ghost");
    expect(unknown.status).toBe(400);
  });
});

describe("PATCH /api/invitation/:id/role", () => {
  it("persists a change within the caller's role and records it", async () => {
    const s = await scene();
    const admin = await s.join("Ada", "admin");
    const invitation = (await (
      await s.invite(admin.cookie, "new@example.com", "viewer")
    ).json()) as Invitation;

    const response = await s.changeRole(admin.cookie, invitation.id, "member");
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      id: invitation.id,
      role: "member",
      workspaceId: s.workspaceId,
      status: "pending",
    });
    expect(await storedRole(invitation.id)).toBe("member");

    expect(
      await auditEntry(s.workspaceId, "member.invitation_role_changed"),
    ).toMatchObject({
      targetType: "invitation",
      targetId: invitation.id,
      targetLabel: "new@example.com",
      metadata: { changes: { role: { before: "viewer", after: "member" } } },
    });
  });

  it("refuses raising an invitation above the caller's own role", async () => {
    const s = await scene();
    const recruiter = await s.join("Rita", "recruiter");
    const invitation = (await (
      await s.invite(recruiter.cookie, "new@example.com", "member")
    ).json()) as Invitation;

    const response = await s.changeRole(
      recruiter.cookie,
      invitation.id,
      "admin",
    );
    expect(response.status).toBe(403);
    expect(await storedRole(invitation.id)).toBe("member");
  });

  it("refuses rewriting an invitation that was sent above the caller", async () => {
    const s = await scene();
    const recruiter = await s.join("Rita", "recruiter");
    const adminInvite = (await (
      await s.invite(s.owner.cookie, "lead@example.com", "admin")
    ).json()) as Invitation;

    const response = await s.changeRole(
      recruiter.cookie,
      adminInvite.id,
      "viewer",
    );
    expect(response.status).toBe(403);
    expect(await storedRole(adminInvite.id)).toBe("admin");
  });

  it("needs invitation permissions and a known role", async () => {
    const s = await scene();
    const member = await s.join("Milo", "member");
    const invitation = (await (
      await s.invite(s.owner.cookie, "new@example.com", "viewer")
    ).json()) as Invitation;

    expect(
      (await s.changeRole(member.cookie, invitation.id, "viewer")).status,
    ).toBe(403);
    expect(
      (await s.changeRole(s.owner.cookie, invitation.id, "ghost")).status,
    ).toBe(400);
    expect(
      (await s.changeRole(s.owner.cookie, "missing", "member")).status,
    ).toBe(404);
  });

  it("refuses a canceled invitation", async () => {
    const s = await scene();
    const invitation = (await (
      await s.invite(s.owner.cookie, "new@example.com", "viewer")
    ).json()) as Invitation;
    await s.ok(
      "/organization/cancel-invitation",
      { invitationId: invitation.id },
      s.owner.cookie,
    );
    expect(
      (await s.changeRole(s.owner.cookie, invitation.id, "member")).status,
    ).toBe(409);
  });
});
