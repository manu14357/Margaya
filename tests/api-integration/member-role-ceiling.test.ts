import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { defaultRolePayloads } from "../../packages/permissions/src";
import { authClient } from "./helpers/audit-log";
import { resetTestDatabase } from "./helpers/database";

// /organization/update-member-role is capped like invitations: nobody grants
// a role above their own, raises their own role, or changes the role of a
// member above them. Owners (and instance admins) have no ceiling.

beforeEach(() => resetTestDatabase());

type Invitation = { id: string };

async function scene() {
  const client = authClient();
  const owner = await client.signup("Olive");
  const workspace = await client.ok<{ id: string }>(
    "/organization/create",
    { name: "Ceiling Co", slug: `role-${owner.id.slice(0, 8).toLowerCase()}` },
    owner.cookie,
  );
  const workspaceId = workspace.id;

  // May change member roles but otherwise holds a member's permissions, so
  // the ceiling (not a missing permission) is what refuses admin.
  await client.ok(
    "/organization/create-role",
    {
      role: "manager",
      permission: { ...defaultRolePayloads.member, member: ["update"] },
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
    const [row] = await db
      .select({ id: schema.workspaceUserTable.id })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, user.id),
        ),
      );
    if (!row) throw new Error("membership missing");
    return { ...user, memberId: row.id };
  };

  const setRole = (cookie: string, memberId: string, role: string) =>
    client.call(
      "/organization/update-member-role",
      { memberId, role, organizationId: workspaceId },
      cookie,
    );

  return { ...client, owner, workspaceId, join, setRole };
}

async function roleOf(memberId: string) {
  const [row] = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.id, memberId));
  return row?.role;
}

describe("changing a member's role is capped at the caller's own", () => {
  it("refuses granting a role above the caller", async () => {
    const s = await scene();
    const manager = await s.join("Mona", "manager");
    const milo = await s.join("Milo", "member");

    const response = await s.setRole(manager.cookie, milo.memberId, "admin");
    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/beyond your own/);
    expect(await roleOf(milo.memberId)).toBe("member");
  });

  it("refuses raising your own role", async () => {
    const s = await scene();
    const manager = await s.join("Mona", "manager");

    const response = await s.setRole(manager.cookie, manager.memberId, "admin");
    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/raise your own role/);
    expect(await roleOf(manager.memberId)).toBe("manager");
  });

  it("refuses changing the role of a member above the caller", async () => {
    const s = await scene();
    const manager = await s.join("Mona", "manager");
    const ada = await s.join("Ada", "admin");

    const response = await s.setRole(manager.cookie, ada.memberId, "viewer");
    expect(response.status).toBe(403);
    expect(await roleOf(ada.memberId)).toBe("admin");
  });

  it("allows changes within the caller's own role", async () => {
    const s = await scene();
    const manager = await s.join("Mona", "manager");
    const milo = await s.join("Milo", "member");

    const response = await s.setRole(manager.cookie, milo.memberId, "viewer");
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await roleOf(milo.memberId)).toBe("viewer");
  });

  it("lets an owner promote anyone, and refuses unknown roles", async () => {
    const s = await scene();
    const milo = await s.join("Milo", "member");

    const promoted = await s.setRole(s.owner.cookie, milo.memberId, "admin");
    expect(promoted.status, await promoted.clone().text()).toBe(200);
    expect(await roleOf(milo.memberId)).toBe("admin");

    const unknown = await s.setRole(s.owner.cookie, milo.memberId, "ghost");
    expect(unknown.status).toBe(400);
  });
});
