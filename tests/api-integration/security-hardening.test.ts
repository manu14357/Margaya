import * as email from "@margaya/email";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAdminCli } from "../../apps/api/src/cli/admin";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { createApiKey } from "./helpers/api-keys";
import { createWorkspaceMember } from "./helpers/fixtures";
import {
  adminRequest,
  authPost,
  issuedCookies,
  resetInstanceState,
  signUpWithSession,
  unlockSignUpSettings,
} from "./helpers/instance-admin";

// Phase 0 hardening: the password policy (0.3), the verified email change
// (0.3) and instance-admin re-authentication, audit trail, recovery CLI and
// API-key limits (0.2).

type App = ReturnType<typeof createApp>["app"];

const PASSWORD = "correct horse battery staple";

let app: App;

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  app = createApp().app;
});

afterEach(() => vi.unstubAllEnvs());

/** Makes every session of the user look an hour old. */
async function ageSessions(userId: string) {
  await db
    .update(schema.sessionTable)
    .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
    .where(eq(schema.sessionTable.userId, userId));
}

async function auditActions() {
  const response = await app.request("/api/instance-admin/audit-log");
  return response;
}

async function auditEntries(cookie: string) {
  const response = await adminRequest(app, "GET", "/audit-log", cookie);
  expect(response.status, await response.clone().text()).toBe(200);
  return (
    (await response.json()) as {
      items: Array<{
        action: string;
        actorName: string | null;
        actorType: string;
        targetLabel: string | null;
        metadata: Record<string, unknown> | null;
      }>;
    }
  ).items;
}

describe("password policy", () => {
  async function signUp(emailAddress: string, password: string) {
    const response = await authPost(app, "/sign-up/email", {
      name: "Policy",
      email: emailAddress,
      password,
    });
    return { status: response.status, body: await response.text() };
  }

  it("refuses short, common and email-equal passwords at sign-up", async () => {
    const short = await signUp("short@example.com", "Tr0ub4dor");
    expect(short.status).toBe(400);
    expect(short.body).toContain("PASSWORD_TOO_SHORT");

    const common = await signUp("common@example.com", "Password2024!");
    expect(common.status).toBe(400);
    expect(common.body).toContain("PASSWORD_TOO_COMMON");

    const sameAsEmail = await signUp(
      "jordan.lee@example.com",
      "jordan.lee@example.com",
    );
    expect(sameAsEmail.status).toBe(400);
    expect(sameAsEmail.body).toContain("PASSWORD_MATCHES_EMAIL");

    expect((await signUp("fine@example.com", PASSWORD)).status).toBe(200);
  });

  it("applies to a password change", async () => {
    const { cookie } = await signUpWithSession(app, "change@example.com");
    const response = await authPost(
      app,
      "/change-password",
      { currentPassword: PASSWORD, newPassword: "qwertyuiop123" },
      { cookie },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("PASSWORD_TOO_COMMON");
  });
});

describe("verified email change", () => {
  it("changes the address only with the code sent to it, then signs out other sessions", async () => {
    const sendOtp = vi.spyOn(email, "sendOtpEmail");
    const notice = vi.spyOn(email, "sendEmailChangedEmail");
    const { cookie, user } = await signUpWithSession(app, "old@example.com");
    const other = await authPost(app, "/sign-in/email", {
      email: "old@example.com",
      password: PASSWORD,
    });
    const otherCookie = issuedCookies(other);

    const request = await authPost(
      app,
      "/email-otp/request-email-change",
      { newEmail: "new@example.com" },
      { cookie },
    );
    expect(request.status, await request.clone().text()).toBe(200);
    expect(sendOtp).toHaveBeenCalledWith(
      "new@example.com",
      expect.any(String),
      expect.objectContaining({ purpose: "email-change" }),
    );
    const otp = (sendOtp.mock.calls.at(-1)?.[2] as { otp: string } | undefined)
      ?.otp as string;

    const wrong = await authPost(
      app,
      "/email-otp/change-email",
      {
        newEmail: "new@example.com",
        otp: otp === "000000" ? "111111" : "000000",
      },
      { cookie },
    );
    expect(wrong.status).toBe(400);
    const [unchanged] = await db
      .select({ email: schema.userTable.email })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, user.id));
    expect(unchanged?.email).toBe("old@example.com");

    const change = await authPost(
      app,
      "/email-otp/change-email",
      { newEmail: "new@example.com", otp },
      { cookie },
    );
    expect(change.status, await change.clone().text()).toBe(200);
    const [changed] = await db
      .select({ email: schema.userTable.email })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, user.id));
    expect(changed?.email).toBe("new@example.com");

    // The old address hears about it, without the full new address.
    expect(notice).toHaveBeenCalledWith(
      "old@example.com",
      expect.any(String),
      expect.objectContaining({ newEmail: "n***@example.com" }),
    );

    // The other session ended; the one that made the change still works.
    const otherSession = await app.request("/api/auth/get-session", {
      headers: { cookie: otherCookie },
    });
    expect(await otherSession.json()).toBeNull();
    const current = await app.request("/api/user/security", {
      headers: { cookie: issuedCookies(change) || cookie },
    });
    expect(current.status).toBe(200);
  });

  it("refuses guests", async () => {
    await signUpWithSession(app, "owner@example.com");
    unlockSignUpSettings();
    const guest = await authPost(app, "/sign-in/anonymous", {});
    expect(guest.status).toBe(200);
    const response = await authPost(
      app,
      "/email-otp/request-email-change",
      { newEmail: "guest@example.com" },
      { cookie: issuedCookies(guest) },
    );
    expect(response.status).toBe(403);
  });
});

describe("instance admin re-authentication and audit trail", () => {
  let admin: Awaited<ReturnType<typeof signUpWithSession>>;

  beforeEach(async () => {
    admin = await signUpWithSession(app, "admin@example.com");
    unlockSignUpSettings();
  });

  it("asks a stale session to confirm the password before changing settings", async () => {
    await ageSessions(admin.user.id);
    const patch = () =>
      adminRequest(app, "PATCH", "/settings", admin.cookie, {
        values: { "auth.inviteOnly": true },
      });

    const stale = await patch();
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ code: "REAUTH_REQUIRED" });

    const wrong = await adminRequest(app, "POST", "/reauth", admin.cookie, {
      password: "not the password at all",
    });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ code: "INVALID_PASSWORD" });

    const confirmed = await adminRequest(app, "POST", "/reauth", admin.cookie, {
      password: PASSWORD,
    });
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);

    expect((await patch()).status).toBe(200);
  });

  it("lets a freshly signed-in admin change things without asking", async () => {
    const response = await adminRequest(
      app,
      "PATCH",
      "/settings",
      admin.cookie,
      {
        values: { "auth.inviteOnly": true },
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
  });

  it("records instance changes without secret values", async () => {
    await signUpWithSession(app, "second@example.com");
    expect(
      (
        await adminRequest(app, "PATCH", "/settings", admin.cookie, {
          values: {
            "smtp.host": "smtp.example.test",
            "smtp.password": "super-secret-smtp-password",
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await adminRequest(app, "POST", "/admins", admin.cookie, {
          email: "second@example.com",
        })
      ).status,
    ).toBe(200);

    const entries = await auditEntries(admin.cookie);
    expect(entries.map((entry) => entry.action)).toEqual([
      "instance.admin_added",
      "instance.settings_updated",
    ]);
    expect(entries[0]).toMatchObject({
      actorType: "user",
      targetLabel: "second@example.com",
    });
    expect(entries[1]?.metadata).toEqual({
      keys: ["smtp.host", "smtp.password"],
    });
    expect(JSON.stringify(entries)).not.toContain("super-secret-smtp-password");
  });

  it("keeps the trail for instance admins only", async () => {
    const member = await signUpWithSession(app, "member@example.com");
    const response = await adminRequest(
      app,
      "GET",
      "/audit-log",
      member.cookie,
    );
    expect(response.status).toBe(403);
    expect((await auditActions()).status).toBe(401);
  });

  it("guards the admin endpoints: recent sign-in, no API keys, audited", async () => {
    const target = await signUpWithSession(app, "target@example.com");

    const key = await createApiKey({ id: admin.user.id });
    const viaKey = await app.request("/api/auth/admin/list-users", {
      headers: { "x-api-key": key.key },
    });
    expect(viaKey.status).toBe(403);

    await ageSessions(admin.user.id);
    const stale = await authPost(
      app,
      "/admin/ban-user",
      { userId: target.user.id },
      { cookie: admin.cookie },
    );
    expect(stale.status).toBe(403);
    expect(await stale.text()).toContain("REAUTH_REQUIRED");

    await adminRequest(app, "POST", "/reauth", admin.cookie, {
      password: PASSWORD,
    });
    const banned = await authPost(
      app,
      "/admin/ban-user",
      { userId: target.user.id, banReason: "Spam" },
      { cookie: admin.cookie },
    );
    expect(banned.status, await banned.clone().text()).toBe(200);

    const entries = await auditEntries(admin.cookie);
    expect(entries[0]).toMatchObject({
      action: "user.banned",
      targetLabel: "target@example.com",
      metadata: { reason: "Spam", expiresInSeconds: null },
    });
  });

  it("refuses an admin's API key instance-wide reach unless allowed", async () => {
    const outsider = await createWorkspaceMember();
    const key = await createApiKey({ id: admin.user.id });
    const list = () =>
      app.request(`/api/project?workspaceId=${outsider.workspace.id}`, {
        headers: key.headers,
      });

    expect((await list()).status).toBe(403);

    vi.stubEnv("ALLOW_INSTANCE_ADMIN_API_KEYS", "true");
    const allowed = await list();
    expect(allowed.status, await allowed.clone().text()).toBe(200);

    // The admin's own session keeps its reach.
    const session = await app.request(
      `/api/project?workspaceId=${outsider.workspace.id}`,
      { headers: { cookie: admin.cookie } },
    );
    expect(session.status).toBe(200);
  });
});

describe("recovery CLI", () => {
  it("promotes, refuses to demote the last admin, resets a password and records it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await signUpWithSession(app, "first@example.com");
    const helper = await signUpWithSession(app, "helper@example.com");

    expect(await runAdminCli(["promote-admin", "HELPER@example.com"])).toBe(0);
    const [promoted] = await db
      .select({ role: schema.userTable.role })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, helper.user.id));
    expect(promoted?.role).toBe("admin");

    expect(await runAdminCli(["demote-admin", "first@example.com"])).toBe(0);
    expect(await runAdminCli(["demote-admin", "helper@example.com"])).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "There must be at least one instance admin.",
    );

    vi.stubEnv("MARGAYA_NEW_PASSWORD", "password");
    expect(await runAdminCli(["reset-password", "first@example.com"])).toBe(1);
    vi.stubEnv("MARGAYA_NEW_PASSWORD", "a recovered long passphrase");
    expect(await runAdminCli(["reset-password", "first@example.com"])).toBe(0);
    const stale = await app.request("/api/auth/get-session", {
      headers: { cookie: first.cookie },
    });
    expect(await stale.json()).toBeNull();
    const signIn = await authPost(app, "/sign-in/email", {
      email: "first@example.com",
      password: "a recovered long passphrase",
    });
    expect(signIn.status).toBe(200);

    expect(await runAdminCli(["promote-admin", "nobody@example.com"])).toBe(1);
    expect(await runAdminCli(["unknown-command"])).toBe(1);

    const helperSession = await authPost(app, "/sign-in/email", {
      email: "helper@example.com",
      password: PASSWORD,
    });
    const entries = await auditEntries(issuedCookies(helperSession));
    expect(entries.map((entry) => entry.action)).toEqual([
      "cli.password_reset",
      "cli.admin_demoted",
      "cli.admin_promoted",
    ]);
    expect(entries[0]).toMatchObject({
      actorType: "system",
      actorName: "Recovery CLI",
    });
    expect(log).toHaveBeenCalled();
  });
});
