import * as email from "@margaya/email";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAdminCli } from "../../apps/api/src/cli/admin";
import db, { schema } from "../../apps/api/src/database";
import {
  instanceAuditLogTable,
  ssoProviderTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import {
  getInstanceSettings,
  refreshInstanceSettings,
} from "../../apps/api/src/instance-settings/snapshot";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  mustSetUpTwoFactor,
  twoFactorApplies,
} from "../../apps/api/src/utils/two-factor-policy";
import { createApiKey } from "./helpers/api-keys";
import {
  adminRequest,
  authPost,
  issuedCookies,
  resetInstanceState,
  signUpWithSession,
  unlockSignUpSettings,
} from "./helpers/instance-admin";
import { codeFor, enrol } from "./helpers/two-factor";

// The instance setting that requires two-factor: who it covers, what it
// stops, and the ways back in for someone who lost their authenticator.

type App = ReturnType<typeof createApp>["app"];

const PASSWORD = "correct horse battery staple";

let app: App;
let admin: Awaited<ReturnType<typeof signUpWithSession>>;
let member: Awaited<ReturnType<typeof signUpWithSession>>;

function get(path: string, headers: Record<string, string>) {
  return app.request(path, { headers });
}

async function codeOf(response: Response) {
  return ((await response.clone().json()) as { code?: string }).code;
}

/** Enrols the admin (required to turn it on) and turns the setting on. */
async function requireTwoFactor() {
  const enrolled = await enrol(app, admin.cookie);
  admin.cookie = enrolled.cookie;
  const saved = await adminRequest(app, "PATCH", "/settings", admin.cookie, {
    values: { "auth.requireTwoFactor": true },
  });
  expect(saved.status, await saved.clone().text()).toBe(200);
  return enrolled;
}

async function userRow(userId: string) {
  const [row] = await db
    .select({ on: schema.userTable.twoFactorEnabled })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId));
  return row;
}

async function auditActions() {
  const rows = await db
    .select({ action: instanceAuditLogTable.action })
    .from(instanceAuditLogTable);
  return rows.map((row) => row.action);
}

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  unlockSignUpSettings();
  app = createApp().app;
  admin = await signUpWithSession(app, "admin@example.com");
  member = await signUpWithSession(app, "member@example.com");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await refreshInstanceSettings();
});

describe("turning it on", () => {
  it("is off by default and changes nothing", async () => {
    const config = (await (await app.request("/api/config")).json()) as {
      requireTwoFactor: boolean;
    };
    expect(config.requireTwoFactor).toBe(false);
    const security = await get("/api/user/security", {
      cookie: member.cookie,
    });
    expect(await security.json()).toMatchObject({
      twoFactorEnabled: false,
      twoFactorRequired: false,
    });
    const projects = await get("/api/project/", { cookie: member.cookie });
    expect(await projects.text()).not.toContain("TWO_FACTOR_REQUIRED");
  });

  it("is refused until the admin turning it on has two-factor themselves", async () => {
    const refused = await adminRequest(
      app,
      "PATCH",
      "/settings",
      admin.cookie,
      { values: { "auth.requireTwoFactor": true } },
    );
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("Turn on two-factor");
    expect(getInstanceSettings().effective.requireTwoFactor).toBe(false);

    await requireTwoFactor();
    expect(getInstanceSettings().effective.requireTwoFactor).toBe(true);
    // The admin keeps working, and can turn it off again.
    const off = await adminRequest(app, "PATCH", "/settings", admin.cookie, {
      values: { "auth.requireTwoFactor": null },
    });
    expect(off.status).toBe(200);
    expect(getInstanceSettings().effective.requireTwoFactor).toBe(false);
  });

  it("tells the sign-in screen to leave out email codes", async () => {
    await requireTwoFactor();
    const config = (await (await app.request("/api/config")).json()) as Record<
      string,
      unknown
    >;
    expect(config).toMatchObject({
      requireTwoFactor: true,
      disableEmailOtpSignIn: true,
    });
  });
});

describe("while it is on", () => {
  it("stops an account until it sets two-factor up, then lets it through", async () => {
    const key = await createApiKey(member.user);
    await requireTwoFactor();

    const cookie = { cookie: member.cookie };
    const rest = await get("/api/project/", cookie);
    expect(rest.status).toBe(403);
    expect(await codeOf(rest)).toBe("TWO_FACTOR_REQUIRED");

    const viaAuth = await authPost(
      app,
      "/organization/create",
      { name: "Blocked", slug: "blocked-workspace" },
      cookie,
    );
    expect(viaAuth.status).toBe(403);
    expect(await codeOf(viaAuth)).toBe("TWO_FACTOR_REQUIRED");

    const viaKey = await get("/api/project/", key.headers);
    expect(viaKey.status).toBe(403);
    expect(await codeOf(viaKey)).toBe("TWO_FACTOR_REQUIRED");

    // What setting it up needs stays open.
    const security = await get("/api/user/security", cookie);
    expect(security.status).toBe(200);
    expect(await security.json()).toMatchObject({
      twoFactorEnabled: false,
      twoFactorRequired: true,
    });
    const session = await get("/api/auth/get-session", cookie);
    expect(await session.json()).toMatchObject({
      user: { id: member.user.id },
    });
    expect((await app.request("/api/config")).status).toBe(200);

    const enrolled = await enrol(app, member.cookie);
    const after = { cookie: enrolled.cookie };
    expect(
      await codeOf(await get("/api/user/security", after)),
    ).toBeUndefined();
    expect(
      (
        await authPost(
          app,
          "/organization/create",
          { name: "Allowed", slug: "allowed-workspace" },
          after,
        )
      ).status,
    ).toBe(200);
    const keyAfter = await get("/api/project/", key.headers);
    expect(keyAfter.status).not.toBe(401);
    expect(await keyAfter.clone().text()).not.toContain("TWO_FACTOR_REQUIRED");
  });

  it("sends a new account to set up, and sign-in still reaches the challenge", async () => {
    await requireTwoFactor();
    const fresh = await signUpWithSession(app, "fresh@example.com");
    const blocked = await get("/api/project/", { cookie: fresh.cookie });
    expect(await codeOf(blocked)).toBe("TWO_FACTOR_REQUIRED");
    const { secret } = await enrol(app, fresh.cookie);

    const signIn = await authPost(app, "/sign-in/email", {
      email: "fresh@example.com",
      password: PASSWORD,
    });
    expect(await signIn.clone().json()).toMatchObject({
      twoFactorRedirect: true,
    });
    const verified = await authPost(
      app,
      "/two-factor/verify-totp",
      { code: codeFor(secret) },
      { cookie: issuedCookies(signIn) },
    );
    expect(verified.status).toBe(200);
    expect(issuedCookies(verified)).toContain("session_token");
  });

  it("doesn't let anyone turn two-factor off", async () => {
    await requireTwoFactor();
    const enrolled = await enrol(app, member.cookie);
    const refused = await authPost(
      app,
      "/two-factor/disable",
      { password: PASSWORD },
      { cookie: enrolled.cookie },
    );
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe("TWO_FACTOR_LOCKED");
    expect((await userRow(member.user.id))?.on).toBe(true);
  });

  it("refuses email links and codes, even for accounts without two-factor", async () => {
    await requireTwoFactor();
    const sendMagicLink = vi.spyOn(email, "sendMagicLinkEmail");
    const sendOtp = vi.spyOn(email, "sendOtpEmail");

    const link = await authPost(app, "/sign-in/magic-link", {
      email: "member@example.com",
    });
    expect(link.status).toBe(200);
    expect(sendMagicLink).not.toHaveBeenCalled();

    const code = await authPost(app, "/email-otp/send-verification-otp", {
      email: "member@example.com",
      type: "sign-in",
    });
    expect(code.status).toBe(200);
    expect(sendOtp).not.toHaveBeenCalled();

    const otpSignIn = await authPost(app, "/sign-in/email-otp", {
      email: "member@example.com",
      otp: "123456",
    });
    expect(otpSignIn.status).toBe(400);

    const verify = await app.request(
      "/api/auth/magic-link/verify?token=whatever",
    );
    expect(verify.status).toBe(403);
  });

  it("leaves out accounts that have no password, and AI agents' keys", async () => {
    await db
      .delete(schema.accountTable)
      .where(
        and(
          eq(schema.accountTable.userId, member.user.id),
          eq(schema.accountTable.providerId, "credential"),
        ),
      );
    const providerKey = await createApiKey(member.user);
    const [agent] = await db
      .insert(schema.userTable)
      .values({
        id: "agent-user",
        email: "agent@agents.example.com",
        emailVerified: true,
        name: "Agent",
        kind: "agent",
      })
      .returning();
    const agentKey = await createApiKey(agent as { id: string });
    await requireTwoFactor();

    const cookie = { cookie: member.cookie };
    const security = await get("/api/user/security", cookie);
    expect(await security.json()).toMatchObject({ twoFactorRequired: false });
    for (const headers of [cookie, providerKey.headers, agentKey.headers]) {
      const response = await get("/api/project/", headers);
      expect(await response.text()).not.toContain("TWO_FACTOR_REQUIRED");
    }
  });

  it("leaves out guests", async () => {
    await requireTwoFactor();
    const guest = await authPost(app, "/sign-in/anonymous", {});
    expect(guest.status, await guest.clone().text()).toBe(200);
    const response = await get("/api/user/security", {
      cookie: issuedCookies(guest),
    });
    expect(await response.json()).toMatchObject({ twoFactorRequired: false });
    const project = await get("/api/project/", {
      cookie: issuedCookies(guest),
    });
    expect(await project.text()).not.toContain("TWO_FACTOR_REQUIRED");
  });

  it("covers only those who can sign in with a password", async () => {
    const on = {
      ...getInstanceSettings().effective,
      requireTwoFactor: true,
    };
    const user = { id: member.user.id, role: "user" };
    const adminUser = { id: member.user.id, role: "admin" };
    expect(await twoFactorApplies(user, on)).toBe(true);
    expect(await twoFactorApplies({ ...user, isAnonymous: true }, on)).toBe(
      false,
    );
    // A required provider keeps password sign-in for instance admins only.
    const provider = { ...on, requiredProvider: "github" as const };
    expect(await twoFactorApplies(user, provider)).toBe(false);
    expect(await twoFactorApplies(adminUser, provider)).toBe(true);
    // Password sign-in turned off for everyone.
    expect(await twoFactorApplies(user, { ...on, emailSignIn: false })).toBe(
      false,
    );
    // Off, and already enrolled.
    expect(
      await mustSetUpTwoFactor(user, { ...on, requireTwoFactor: false }),
    ).toBe(false);
    expect(
      await mustSetUpTwoFactor({ ...user, twoFactorEnabled: true }, on),
    ).toBe(false);
    expect(await mustSetUpTwoFactor(user, on)).toBe(true);
  });
});

describe("an account that only used email codes", () => {
  /** Such an account has a session but never had a password. */
  async function removePassword(userId: string) {
    await db
      .delete(schema.accountTable)
      .where(
        and(
          eq(schema.accountTable.userId, userId),
          eq(schema.accountTable.providerId, "credential"),
        ),
      );
  }

  function emailIsSetUp() {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_FROM", "margaya@example.com");
  }

  async function config() {
    return (await (await app.request("/api/config")).json()) as {
      passwordResetEnabled: boolean;
    };
  }

  /** Signs in with the password, must set up two-factor, then gets through. */
  async function expectSetUpThenThrough(address: string) {
    const signIn = await authPost(app, "/sign-in/email", {
      email: address,
      password: PASSWORD,
    });
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    const cookie = issuedCookies(signIn);
    expect(await codeOf(await get("/api/project/", { cookie }))).toBe(
      "TWO_FACTOR_REQUIRED",
    );
    const enrolled = await enrol(app, cookie);
    const through = await get("/api/project/", { cookie: enrolled.cookie });
    expect(await through.text()).not.toContain("TWO_FACTOR_REQUIRED");
  }

  async function expectEmailSignInRefused(address: string) {
    const sendOtp = vi.spyOn(email, "sendOtpEmail");
    await authPost(app, "/email-otp/send-verification-otp", {
      email: address,
      type: "sign-in",
    });
    expect(sendOtp).not.toHaveBeenCalled();
    const code = await authPost(app, "/sign-in/email-otp", {
      email: address,
      otp: "123456",
    });
    expect(code.status).toBe(400);
    const password = await authPost(app, "/sign-in/email", {
      email: address,
      password: PASSWORD,
    });
    expect(password.status).toBe(401);
  }

  it("sets a password through Forgot password, then has to set up two-factor", async () => {
    emailIsSetUp();
    await removePassword(member.user.id);
    await requireTwoFactor();
    await expectEmailSignInRefused("member@example.com");
    expect(await config()).toMatchObject({ passwordResetEnabled: true });

    const sendReset = vi.spyOn(email, "sendPasswordResetEmail");
    const requested = await authPost(app, "/request-password-reset", {
      email: "member@example.com",
    });
    expect(requested.status).toBe(200);
    expect(sendReset).toHaveBeenCalledTimes(1);
    const sent = sendReset.mock.calls[0]?.[2] as { resetLink: string };
    const token = new URL(sent.resetLink).searchParams.get("token");
    const reset = await authPost(app, "/reset-password", {
      token,
      newPassword: PASSWORD,
    });
    expect(reset.status, await reset.clone().text()).toBe(200);

    await expectSetUpThenThrough("member@example.com");
  });

  it("without email, nothing goes out, and an instance admin sets a password instead", async () => {
    await removePassword(member.user.id);
    await requireTwoFactor();
    await expectEmailSignInRefused("member@example.com");
    expect(await config()).toMatchObject({ passwordResetEnabled: false });

    const sendReset = vi.spyOn(email, "sendPasswordResetEmail");
    const requested = await authPost(app, "/request-password-reset", {
      email: "member@example.com",
    });
    expect(requested.status).toBe(200);
    expect(sendReset).not.toHaveBeenCalled();
    const link = await adminRequest(
      app,
      "POST",
      `/users/${member.user.id}/reset-password`,
      admin.cookie,
      {},
    );
    expect(link.status).toBe(409);

    const set = await adminRequest(
      app,
      "POST",
      `/users/${member.user.id}/reset-password`,
      admin.cookie,
      { password: PASSWORD },
    );
    expect(set.status, await set.clone().text()).toBe(200);

    await expectSetUpThenThrough("member@example.com");
  });

  describe("when it's the admin turning it on", () => {
    const turnOn = () =>
      adminRequest(app, "PATCH", "/settings", admin.cookie, {
        values: { "auth.requireTwoFactor": true },
      });

    async function expectRefused() {
      const refused = await turnOn();
      expect(refused.status).toBe(409);
      expect(await refused.text()).toContain("Set a password");
      expect(getInstanceSettings().effective.requireTwoFactor).toBe(false);
    }

    it("is refused, whether or not email is set up: nothing else would get them back in", async () => {
      await removePassword(admin.user.id);
      await expectRefused();
      emailIsSetUp();
      await expectRefused();
    });

    it("can go ahead once the admin has a password and two-factor, without email", async () => {
      await removePassword(admin.user.id);
      const set = await adminRequest(
        app,
        "POST",
        `/users/${admin.user.id}/reset-password`,
        admin.cookie,
        { password: PASSWORD },
      );
      expect(set.status, await set.clone().text()).toBe(200);
      const signIn = await authPost(app, "/sign-in/email", {
        email: "admin@example.com",
        password: PASSWORD,
      });
      admin.cookie = issuedCookies(signIn);
      await requireTwoFactor();
      expect(getInstanceSettings().effective.requireTwoFactor).toBe(true);
    });

    async function linkAccount(providerId: string) {
      await db.insert(schema.accountTable).values({
        accountId: `${providerId}-account`,
        providerId,
        userId: admin.user.id,
        updatedAt: new Date(),
      });
    }

    it("is allowed through a provider that works, not one that's gone", async () => {
      await removePassword(admin.user.id);
      await linkAccount("github");
      await expectRefused();

      vi.stubEnv("GITHUB_OAUTH_CLIENT_ID", "github-id");
      vi.stubEnv("GITHUB_OAUTH_CLIENT_SECRET", "github-secret");
      const allowed = await turnOn();
      expect(allowed.status, await allowed.clone().text()).toBe(200);
      expect(getInstanceSettings().effective.requireTwoFactor).toBe(true);
    });

    it("counts a SAML connection, not a provisioning link", async () => {
      await removePassword(admin.user.id);
      await linkAccount("scim_connection");
      await expectRefused();

      await db.insert(ssoProviderTable).values({
        providerId: "saml_connection",
        issuer: "https://idp.example.com",
        domain: "example.com",
        name: "Company sign-in",
      });
      await linkAccount("saml_connection");
      const allowed = await turnOn();
      expect(allowed.status, await allowed.clone().text()).toBe(200);
    });

    it("doesn't apply while password sign-in is off, since it changes nothing then", async () => {
      await removePassword(admin.user.id);
      vi.stubEnv("DISABLE_LOGIN_FORM", "true");
      const allowed = await turnOn();
      expect(allowed.status, await allowed.clone().text()).toBe(200);
    });
  });

  it("gets the only admin back through the recovery CLI, without email", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("REQUIRE_TWO_FACTOR", "true");
    vi.stubEnv("MARGAYA_NEW_PASSWORD", PASSWORD);
    await removePassword(admin.user.id);
    await expectEmailSignInRefused("admin@example.com");
    expect(await config()).toMatchObject({ passwordResetEnabled: false });

    expect(await runAdminCli(["reset-password", "admin@example.com"])).toBe(0);

    await expectSetUpThenThrough("admin@example.com");
  });
});

describe("the environment variable", () => {
  it("turns it on, and locks the panel", async () => {
    vi.stubEnv("REQUIRE_TWO_FACTOR", "true");
    const blocked = await get("/api/project/", { cookie: member.cookie });
    expect(await codeOf(blocked)).toBe("TWO_FACTOR_REQUIRED");
    const enrolled = await enrol(app, admin.cookie);
    const locked = await adminRequest(
      app,
      "PATCH",
      "/settings",
      enrolled.cookie,
      { values: { "auth.requireTwoFactor": false } },
    );
    expect(locked.status).toBe(409);
  });

  it("turned off from the server, it overrides a saved setting", async () => {
    await requireTwoFactor();
    vi.stubEnv("REQUIRE_TWO_FACTOR", "false");
    const response = await get("/api/project/", { cookie: member.cookie });
    expect(await response.text()).not.toContain("TWO_FACTOR_REQUIRED");
  });
});

describe("resetting a lost authenticator", () => {
  it("lets another admin reset it, signing the account out", async () => {
    await requireTwoFactor();
    const enrolled = await enrol(app, member.cookie);
    await db.insert(schema.verificationTable).values({
      identifier: "trust-device-test",
      value: member.user.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const reset = await adminRequest(
      app,
      "POST",
      `/users/${member.user.id}/reset-two-factor`,
      admin.cookie,
    );
    expect(reset.status, await reset.clone().text()).toBe(200);

    expect((await userRow(member.user.id))?.on).toBe(false);
    const secrets = await db
      .select()
      .from(schema.twoFactorTable)
      .where(eq(schema.twoFactorTable.userId, member.user.id));
    expect(secrets).toHaveLength(0);
    const trusted = await db
      .select()
      .from(schema.verificationTable)
      .where(eq(schema.verificationTable.identifier, "trust-device-test"));
    expect(trusted).toHaveLength(0);
    const stale = await get("/api/auth/get-session", {
      cookie: enrolled.cookie,
    });
    expect(await stale.json()).toBeNull();
    expect(await auditActions()).toContain("user.two_factor_reset");

    // Password alone again, and then straight to setting it up.
    const signIn = await authPost(app, "/sign-in/email", {
      email: "member@example.com",
      password: PASSWORD,
    });
    expect(signIn.status).toBe(200);
    const cookie = issuedCookies(signIn);
    expect(cookie).toContain("session_token");
    expect(await codeOf(await get("/api/project/", { cookie }))).toBe(
      "TWO_FACTOR_REQUIRED",
    );
    await enrol(app, cookie);
  });

  it("is for other accounts, by admins, with a recent sign-in", async () => {
    const own = await adminRequest(
      app,
      "POST",
      `/users/${admin.user.id}/reset-two-factor`,
      admin.cookie,
    );
    expect(own.status).toBe(400);

    const notAdmin = await adminRequest(
      app,
      "POST",
      `/users/${admin.user.id}/reset-two-factor`,
      member.cookie,
    );
    expect(notAdmin.status).toBe(403);

    await db
      .update(schema.sessionTable)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(schema.sessionTable.userId, admin.user.id));
    const stale = await adminRequest(
      app,
      "POST",
      `/users/${member.user.id}/reset-two-factor`,
      admin.cookie,
    );
    expect(stale.status).toBe(403);
    expect(await codeOf(stale)).toBe("REAUTH_REQUIRED");
  });

  it("changes nothing for an account without two-factor", async () => {
    const reset = await adminRequest(
      app,
      "POST",
      `/users/${member.user.id}/reset-two-factor`,
      admin.cookie,
    );
    expect(reset.status).toBe(200);
    const still = await get("/api/auth/get-session", {
      cookie: member.cookie,
    });
    expect(await still.json()).toMatchObject({ user: { id: member.user.id } });
    expect(await auditActions()).not.toContain("user.two_factor_reset");
  });

  it("gets the only admin back in through the recovery CLI", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await requireTwoFactor();

    expect(await runAdminCli(["reset-two-factor", "ADMIN@example.com"])).toBe(
      0,
    );
    expect((await userRow(admin.user.id))?.on).toBe(false);
    expect(await auditActions()).toContain("cli.two_factor_reset");

    const signIn = await authPost(app, "/sign-in/email", {
      email: "admin@example.com",
      password: PASSWORD,
    });
    const cookie = issuedCookies(signIn);
    expect(cookie).toContain("session_token");
    // The admin can't skip setting it up again, but nothing stops them doing so.
    const blocked = await adminRequest(app, "GET", "/settings", cookie);
    expect(await codeOf(blocked)).toBe("TWO_FACTOR_REQUIRED");
    const { cookie: enrolled } = await enrol(app, cookie);
    const panel = await adminRequest(app, "GET", "/settings", enrolled);
    expect(panel.status).toBe(200);

    expect(await runAdminCli(["reset-two-factor", "member@example.com"])).toBe(
      0,
    );
    expect(await runAdminCli(["reset-two-factor", "nobody@example.com"])).toBe(
      1,
    );
    expect(log).toHaveBeenCalledWith(
      "member@example.com doesn't use two-factor.",
    );
    expect(error).toHaveBeenCalledWith("No account uses nobody@example.com.");
  });
});
