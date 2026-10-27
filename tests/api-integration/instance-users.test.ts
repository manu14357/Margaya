import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { instanceAuditLogTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { runInstanceAuditRetention } from "../../apps/api/src/instance-admin/audit-retention";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { createApiKey } from "./helpers/api-keys";
import { createWorkspaceMember } from "./helpers/fixtures";
import {
  adminRequest,
  authPost,
  resetInstanceState,
  signUpWithSession,
} from "./helpers/instance-admin";

// 4.12: instance user management, behind the recent sign-in and recorded in
// the instance audit trail; plus the instance audit retention job.

type App = ReturnType<typeof createApp>["app"];

const PASSWORD = "correct horse battery staple";

let app: App;
let admin: Awaited<ReturnType<typeof signUpWithSession>>;
let member: Awaited<ReturnType<typeof signUpWithSession>>;

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  app = createApp().app;
  admin = await signUpWithSession(app, "admin@example.com");
  member = await signUpWithSession(app, "member@example.com");
});

afterEach(() => vi.unstubAllEnvs());

async function json<T>(response: Response): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as T;
}

async function auditActions() {
  const rows = await db
    .select({ action: instanceAuditLogTable.action })
    .from(instanceAuditLogTable);
  return rows.map((row) => row.action);
}

/** Ages every session of the admin past the recent sign-in window. */
async function makeAdminSessionStale() {
  await db
    .update(schema.sessionTable)
    .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
    .where(eq(schema.sessionTable.userId, admin.user.id));
}

describe("listing users", () => {
  it("lists and searches accounts with their workspaces", async () => {
    const { workspace } = await createWorkspaceMember();
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: member.user.id,
      role: "admin",
      joinedAt: new Date(),
    });

    const page = await json<{
      items: {
        id: string;
        email: string;
        isAdmin: boolean;
        workspaceCount: number;
      }[];
    }>(await adminRequest(app, "GET", "/users?search=member", admin.cookie));
    expect(page.items).toEqual([
      expect.objectContaining({
        email: "member@example.com",
        isAdmin: false,
        workspaceCount: 1,
      }),
    ]);

    const admins = await json<{ items: { email: string }[] }>(
      await adminRequest(app, "GET", "/users?status=admins", admin.cookie),
    );
    expect(admins.items.map((item) => item.email)).toEqual([
      "admin@example.com",
    ]);

    const detail = await json<{
      workspaces: { id: string; role: string }[];
      activeSessions: number;
      hasPassword: boolean;
    }>(
      await adminRequest(app, "GET", `/users/${member.user.id}`, admin.cookie),
    );
    expect(detail.workspaces).toEqual([
      expect.objectContaining({ id: workspace.id, role: "admin" }),
    ]);
    expect(detail.activeSessions).toBe(1);
    expect(detail.hasPassword).toBe(true);
  });

  it("is for instance admins only", async () => {
    const response = await adminRequest(app, "GET", "/users", member.cookie);
    expect(response.status).toBe(403);
  });
});

describe("account actions", () => {
  it("need a recent sign-in", async () => {
    await makeAdminSessionStale();
    const response = await adminRequest(
      app,
      "POST",
      `/users/${member.user.id}/ban`,
      admin.cookie,
      {},
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "REAUTH_REQUIRED" });

    // Confirming the password opens the window again.
    await json(
      await adminRequest(app, "POST", "/reauth", admin.cookie, {
        password: PASSWORD,
      }),
    );
    await json(
      await adminRequest(
        app,
        "POST",
        `/users/${member.user.id}/ban`,
        admin.cookie,
        {},
      ),
    );
  });

  it("bans, signs out and unbans, with audit entries", async () => {
    const key = await createApiKey({ id: member.user.id });
    await json(
      await adminRequest(
        app,
        "POST",
        `/users/${member.user.id}/ban`,
        admin.cookie,
        {
          reason: "Left the company",
          expiresInDays: 30,
        },
      ),
    );
    const [banned] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, member.user.id));
    expect(banned?.banned).toBe(true);
    expect(banned?.banReason).toBe("Left the company");
    expect(
      await db
        .select()
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, member.user.id)),
    ).toHaveLength(0);

    const signIn = await authPost(app, "/sign-in/email", {
      email: "member@example.com",
      password: PASSWORD,
    });
    expect(signIn.status).toBe(403);
    // A banned owner's API keys stop working too.
    const viaKey = await app.request("/api/project?workspaceId=x", {
      headers: key.headers,
    });
    expect(viaKey.status).toBe(401);

    await json(
      await adminRequest(
        app,
        "POST",
        `/users/${member.user.id}/unban`,
        admin.cookie,
      ),
    );
    const again = await authPost(app, "/sign-in/email", {
      email: "member@example.com",
      password: PASSWORD,
    });
    expect(again.status).toBe(200);
    expect(await auditActions()).toEqual(
      expect.arrayContaining(["user.banned", "user.unbanned"]),
    );
  });

  it("never bans yourself or the last admin", async () => {
    const self = await adminRequest(
      app,
      "POST",
      `/users/${admin.user.id}/ban`,
      admin.cookie,
      {},
    );
    expect(self.status).toBe(400);
  });

  it("signs a user out everywhere", async () => {
    const result = await json<{ revoked: number }>(
      await adminRequest(
        app,
        "POST",
        `/users/${member.user.id}/revoke-sessions`,
        admin.cookie,
      ),
    );
    expect(result.revoked).toBe(1);
    const me = await app.request("/api/user/security", {
      headers: { cookie: member.cookie },
    });
    expect(me.status).toBe(401);
    expect(await auditActions()).toContain("user.sessions_revoked");
  });

  it("sets a new password under the password rules", async () => {
    const weak = await adminRequest(
      app,
      "POST",
      `/users/${member.user.id}/reset-password`,
      admin.cookie,
      { password: "password" },
    );
    expect(weak.status).toBe(400);

    await json(
      await adminRequest(
        app,
        "POST",
        `/users/${member.user.id}/reset-password`,
        admin.cookie,
        { password: "a brand new passphrase" },
      ),
    );
    const signIn = await authPost(app, "/sign-in/email", {
      email: "member@example.com",
      password: "a brand new passphrase",
    });
    expect(signIn.status).toBe(200);
    expect(await auditActions()).toContain("user.password_set");
  });

  it("needs email for a reset link", async () => {
    const response = await adminRequest(
      app,
      "POST",
      `/users/${member.user.id}/reset-password`,
      admin.cookie,
      {},
    );
    expect(response.status).toBe(409);
  });
});

describe("instance audit retention", () => {
  it("drops entries older than the window and keeps newer ones", async () => {
    await db.insert(instanceAuditLogTable).values([
      {
        actorType: "system",
        action: "cli.password_reset",
        createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
      },
      { actorType: "system", action: "cli.admin_promoted" },
    ]);
    const outcome = await runInstanceAuditRetention();
    expect(outcome.deleted).toBe(1);
    expect(await auditActions()).toContain("cli.admin_promoted");

    vi.stubEnv("INSTANCE_AUDIT_LOG_RETENTION_DAYS", "0");
    await db.insert(instanceAuditLogTable).values({
      actorType: "system",
      action: "cli.user_unbanned",
      createdAt: new Date(Date.now() - 4000 * 24 * 60 * 60 * 1000),
    });
    expect((await runInstanceAuditRetention()).deleted).toBe(0);
  });
});
