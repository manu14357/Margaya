import { beforeEach, describe, expect, it } from "vitest";
import { auditEntry, auditRows, authClient } from "./helpers/audit-log";
import { resetTestDatabase } from "./helpers/database";

beforeEach(() => resetTestDatabase());

type Invitation = { id: string; email: string; organizationId: string };
type Member = { id: string; userId: string; role: string };

async function workspaceScene() {
  const client = authClient();
  const owner = await client.signup("Owen");
  const workspace = await client.ok<{ id: string; name: string }>(
    "/organization/create",
    { name: "Audit Co", slug: `audit-${owner.id.slice(0, 8).toLowerCase()}` },
    owner.cookie,
  );
  const workspaceId = workspace.id;

  /** Invites and accepts; returns the new member. */
  const join = async (name: string, role = "member") => {
    const user = await client.signup(name);
    const invitation = await client.ok<Invitation>(
      "/organization/invite-member",
      { email: user.email, role, organizationId: workspaceId },
      owner.cookie,
    );
    const accepted = await client.ok<{ member: Member }>(
      "/organization/accept-invitation",
      { invitationId: invitation.id },
      user.cookie,
    );
    return { ...user, memberId: accepted.member.id, invitation };
  };

  return { ...client, owner, workspaceId, join };
}

describe("audit log: membership and workspace (Better Auth routes)", () => {
  it("records the workspace creation by its creator", async () => {
    const s = await workspaceScene();
    const entry = await auditEntry(s.workspaceId, "workspace.created");
    expect(entry).toMatchObject({
      actorType: "user",
      actorUserId: s.owner.id,
      actorName: "Owen",
      targetType: "workspace",
      targetId: s.workspaceId,
      targetLabel: "Audit Co",
    });
  });

  it("records invitations sent, revoked and accepted with the right actor", async () => {
    const s = await workspaceScene();
    const carol = await s.ok<Invitation>(
      "/organization/invite-member",
      {
        email: "carol@example.com",
        role: "admin",
        organizationId: s.workspaceId,
      },
      s.owner.cookie,
    );
    await s.ok(
      "/organization/cancel-invitation",
      { invitationId: carol.id },
      s.owner.cookie,
    );
    const bob = await s.join("Bob");

    const invited = await auditRows(s.workspaceId, "member.invited");
    expect(invited.map((row) => row.targetLabel).sort()).toEqual(
      ["carol@example.com", bob.email].sort(),
    );
    const carolInvite = invited.find((row) => row.targetId === carol.id);
    expect(carolInvite).toMatchObject({
      actorUserId: s.owner.id,
      targetType: "invitation",
      metadata: { role: "admin" },
      userAgent: "AuditTest/1.0",
    });

    expect(
      await auditEntry(s.workspaceId, "member.invitation_revoked"),
    ).toMatchObject({
      actorUserId: s.owner.id,
      targetId: carol.id,
      targetLabel: "carol@example.com",
    });
    expect(
      await auditEntry(s.workspaceId, "member.invitation_accepted"),
    ).toMatchObject({
      actorType: "user",
      actorUserId: bob.id,
      actorName: "Bob",
      targetId: bob.invitation.id,
      metadata: { role: "member" },
    });
  });

  it("records role changes, ownership transfer, removal and leaving", async () => {
    const s = await workspaceScene();
    const bob = await s.join("Bob");
    const dave = await s.join("Dave");

    await s.ok(
      "/organization/update-member-role",
      { memberId: bob.memberId, role: "admin", organizationId: s.workspaceId },
      s.owner.cookie,
    );
    expect(
      await auditEntry(s.workspaceId, "member.role_changed"),
    ).toMatchObject({
      actorUserId: s.owner.id,
      targetType: "user",
      targetId: bob.id,
      targetLabel: "Bob",
      metadata: { changes: { role: { before: "member", after: "admin" } } },
    });

    await s.ok(
      "/organization/update-member-role",
      { memberId: bob.memberId, role: "owner", organizationId: s.workspaceId },
      s.owner.cookie,
    );
    expect(
      await auditEntry(s.workspaceId, "workspace.ownership_transferred"),
    ).toMatchObject({
      actorUserId: s.owner.id,
      targetId: bob.id,
      metadata: { changes: { role: { before: "admin", after: "owner" } } },
    });

    await s.ok(
      "/organization/remove-member",
      { memberIdOrEmail: dave.memberId, organizationId: s.workspaceId },
      bob.cookie,
    );
    expect(await auditEntry(s.workspaceId, "member.removed")).toMatchObject({
      actorUserId: bob.id,
      targetId: dave.id,
      targetLabel: "Dave",
      metadata: { role: "member" },
    });

    await s.ok(
      "/organization/leave",
      { organizationId: s.workspaceId },
      s.owner.cookie,
    );
    expect(await auditEntry(s.workspaceId, "member.left")).toMatchObject({
      actorUserId: s.owner.id,
      targetId: s.owner.id,
      targetLabel: "Owen",
    });
  });

  it("records custom roles created, updated and deleted with permission changes", async () => {
    const s = await workspaceScene();
    const created = await s.ok<{ roleData: { id: string } }>(
      "/organization/create-role",
      {
        role: "auditor",
        permission: { audit_log: ["read"], project: ["read"] },
        organizationId: s.workspaceId,
      },
      s.owner.cookie,
    );
    expect(await auditEntry(s.workspaceId, "role.created")).toMatchObject({
      targetType: "role",
      targetId: created.roleData.id,
      targetLabel: "auditor",
      metadata: { permissions: ["audit_log:read", "project:read"] },
    });

    await s.ok(
      "/organization/update-role",
      {
        roleName: "auditor",
        organizationId: s.workspaceId,
        data: { permission: { audit_log: ["read"], task: ["read"] } },
      },
      s.owner.cookie,
    );
    expect(await auditEntry(s.workspaceId, "role.updated")).toMatchObject({
      targetId: created.roleData.id,
      metadata: { added: ["task:read"], removed: ["project:read"] },
    });

    await s.ok(
      "/organization/delete-role",
      { roleName: "auditor", organizationId: s.workspaceId },
      s.owner.cookie,
    );
    expect(await auditEntry(s.workspaceId, "role.deleted")).toMatchObject({
      actorUserId: s.owner.id,
      targetId: created.roleData.id,
      targetLabel: "auditor",
    });
  });

  it("records workspace settings changes as a before/after diff", async () => {
    const s = await workspaceScene();
    await s.ok(
      "/organization/update",
      { organizationId: s.workspaceId, data: { name: "Renamed Co" } },
      s.owner.cookie,
    );
    const entry = await auditEntry(s.workspaceId, "workspace.updated");
    expect(entry).toMatchObject({
      actorUserId: s.owner.id,
      targetLabel: "Renamed Co",
      metadata: {
        changes: { name: { before: "Audit Co", after: "Renamed Co" } },
      },
    });

    // Saving the same values changes nothing and records nothing.
    await s.ok(
      "/organization/update",
      { organizationId: s.workspaceId, data: { name: "Renamed Co" } },
      s.owner.cookie,
    );
    expect(await auditRows(s.workspaceId, "workspace.updated")).toHaveLength(1);
  });

  it("records API keys created and revoked in the owner's workspaces without the key", async () => {
    const s = await workspaceScene();
    const created = await s.ok<{ id: string; key: string }>(
      "/api-key/create",
      { name: "CI deploys" },
      s.owner.cookie,
    );
    expect(created.key).toBeTruthy();
    expect(await auditEntry(s.workspaceId, "api_key.created")).toMatchObject({
      actorType: "user",
      actorUserId: s.owner.id,
      targetType: "api_key",
      targetId: created.id,
      targetLabel: "CI deploys",
    });

    // The key acts on a Better Auth route: the entry names the key.
    const viaKey = await s.call(
      "/organization/invite-member",
      {
        email: "keyed@example.com",
        role: "member",
        organizationId: s.workspaceId,
      },
      "",
      { "x-api-key": created.key },
    );
    expect(viaKey.status, await viaKey.clone().text()).toBe(200);
    const keyed = (await auditRows(s.workspaceId, "member.invited")).find(
      (row) => row.targetLabel === "keyed@example.com",
    );
    expect(keyed).toMatchObject({
      actorType: "api_key",
      actorUserId: s.owner.id,
      apiKeyId: created.id,
      actorName: "CI deploys",
    });

    await s.ok("/api-key/delete", { keyId: created.id }, s.owner.cookie);
    expect(await auditEntry(s.workspaceId, "api_key.revoked")).toMatchObject({
      actorUserId: s.owner.id,
      targetId: created.id,
      targetLabel: "CI deploys",
    });

    const everything = JSON.stringify(await auditRows(s.workspaceId));
    expect(everything).not.toContain(created.key);
    expect(everything).not.toContain(created.key.slice(-12));
  });
});
