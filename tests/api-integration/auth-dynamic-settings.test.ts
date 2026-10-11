import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth, authInstanceGeneration } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import type { SettingValue } from "../../apps/api/src/instance-settings/catalog";
import { refreshInstanceSettings } from "../../apps/api/src/instance-settings/snapshot";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { createWorkspaceMember } from "./helpers/fixtures";
import {
  adminRequest,
  authPost,
  issuedCookies,
  resetInstanceState,
  signUpWithSession,
  unlockSignUpSettings,
} from "./helpers/instance-admin";

type App = ReturnType<typeof createApp>["app"];

let app: App;

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  app = createApp().app;
  unlockSignUpSettings();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Stores a value as the panel would, without the PATCH guards. */
async function saveDirect(values: Record<string, SettingValue>) {
  await db
    .insert(schema.instanceSettingTable)
    .values(Object.entries(values).map(([key, value]) => ({ key, value })));
  await refreshInstanceSettings();
}

function signUp(email: string, headers: Record<string, string> = {}) {
  return authPost(
    app,
    "/sign-up/email",
    { name: "Someone", email, password: "correct horse battery staple" },
    headers,
  );
}

async function getSession(cookie: string) {
  const response = await app.request("/api/auth/get-session", {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { user: { id: string } } | null;
}

const GITHUB = {
  "oauth.github.clientId": "github-client-id",
  "oauth.github.clientSecret": "github-client-secret",
};

describe("D20: environment wins over the database", () => {
  it("lets a set variable override a saved value", async () => {
    await createWorkspaceMember();
    await saveDirect({ "auth.inviteOnly": true });
    vi.stubEnv("DISABLE_REGISTRATION", "false");
    expect((await signUp("env-wins@example.com")).status).toBe(200);
    expect(
      (
        (await (await app.request("/api/config")).json()) as Record<
          string,
          unknown
        >
      ).disableRegistration,
    ).toBe(false);

    vi.stubEnv("DISABLE_REGISTRATION", "");
    const refused = await signUp("db-applies@example.com");
    expect(refused.status).toBe(403);
  });

  it("locks the panel when the variable is set", async () => {
    const admin = await signUpWithSession(app, "admin@example.com");
    vi.stubEnv("DISABLE_PASSWORD_REGISTRATION", "true");
    const response = await adminRequest(
      app,
      "PATCH",
      "/settings",
      admin.cookie,
      {
        values: { "auth.emailSignUp": true },
      },
    );
    expect(response.status).toBe(409);
    const settings = (await (
      await adminRequest(app, "GET", "/settings", admin.cookie)
    ).json()) as {
      settings: Array<{ key: string; locked: boolean; envVar: string }>;
    };
    expect(
      settings.settings.find((entry) => entry.key === "auth.emailSignUp"),
    ).toMatchObject({ locked: true, envVar: "DISABLE_PASSWORD_REGISTRATION" });
  });
});

describe("D20: environment-only answers are unchanged", () => {
  it("leaves provider sign-in to Better Auth when nothing is saved", async () => {
    await signUpWithSession(app, "admin@example.com");
    // Unconfigured: Better Auth's own answer, never the panel's kill switch.
    const unconfigured = await authPost(app, "/sign-in/social", {
      provider: "google",
      callbackURL: "/",
    });
    expect(unconfigured.status).not.toBe(403);
    expect(await unconfigured.text()).not.toContain(
      "This sign-in method is turned off.",
    );
    // Configured through the environment: the sign-in starts as before.
    vi.stubEnv("GITHUB_OAUTH_CLIENT_ID", "env-github-id");
    vi.stubEnv("GITHUB_OAUTH_CLIENT_SECRET", "env-github-secret");
    const started = await authPost(app, "/sign-in/social", {
      provider: "github",
      callbackURL: "/",
    });
    expect(started.status).toBe(200);
    expect(((await started.json()) as { url: string }).url).toContain(
      "client_id=env-github-id",
    );
  });

  it("serves email codes without SMTP, as before (the sign-in screen gates on hasSmtp)", async () => {
    const admin = await signUpWithSession(app, "admin@example.com");
    const config = (await (await app.request("/api/config")).json()) as Record<
      string,
      unknown
    >;
    expect(config).toMatchObject({
      hasSmtp: false,
      disableEmailOtpSignIn: false,
    });
    const send = await authPost(app, "/email-otp/send-verification-otp", {
      email: admin.user.email,
      type: "sign-in",
    });
    expect(send.status).toBe(200);
    expect(await send.json()).toEqual({ success: true });
  });
});

describe("D20: the auth facade", () => {
  it("never rebuilds on an environment-only configuration", async () => {
    const api = auth.api;
    const generation = authInstanceGeneration();
    const admin = await signUpWithSession(app, "admin@example.com");
    await getSession(admin.cookie);
    await app.request("/api/config");
    expect(auth.api).toBe(api);
    expect(authInstanceGeneration()).toBe(generation);
  });

  it("rebuilds when OAuth credentials change, and only then", async () => {
    const admin = await signUpWithSession(app, "admin@example.com");
    const before = auth.api;
    const generation = authInstanceGeneration();

    const toggled = await adminRequest(
      app,
      "PATCH",
      "/settings",
      admin.cookie,
      {
        values: {
          "oauth.discord.enabled": false,
          "general.instanceName": "Acme",
        },
      },
    );
    expect(toggled.status).toBe(200);
    expect(auth.api).toBe(before);

    const saved = await adminRequest(app, "PATCH", "/settings", admin.cookie, {
      values: GITHUB,
    });
    expect(saved.status).toBe(200);
    const after = auth.api;
    expect(after).not.toBe(before);
    expect(authInstanceGeneration()).toBe(generation + 1);
    expect(auth.api).toBe(after);
    expect((await getSession(admin.cookie))?.user.id).toBe(admin.user.id);
  });

  it("keeps sessions and in-flight requests working across a rebuild", async () => {
    const admin = await signUpWithSession(app, "admin@example.com");
    const member = await signUpWithSession(app, "member@example.com");
    const oldApi = auth.api;

    const saved = await adminRequest(app, "PATCH", "/settings", admin.cookie, {
      values: GITHUB,
    });
    expect(saved.status).toBe(200);
    expect(auth.api).not.toBe(oldApi);

    // A request that started on the old instance finishes there.
    const viaOld = await oldApi.getSession({
      headers: new Headers({ cookie: member.cookie }),
    });
    expect(viaOld?.user.id).toBe(member.user.id);

    // Sessions issued before the rebuild still work on the new instance,
    // on Better Auth's routes and on Margaya's.
    expect((await getSession(member.cookie))?.user.id).toBe(member.user.id);
    expect(
      (
        await app.request("/api/invitation/pending", {
          headers: { cookie: member.cookie },
        })
      ).status,
    ).toBe(200);

    // Signing in after the rebuild works too.
    const signIn = await authPost(app, "/sign-in/email", {
      email: "member@example.com",
      password: "correct horse battery staple",
    });
    expect(signIn.status).toBe(200);
    expect((await getSession(issuedCookies(signIn)))?.user.id).toBe(
      member.user.id,
    );
  });
});

describe("per-request rules from saved settings", () => {
  it("invite-only blocks sign-up without an invitation and allows it with one", async () => {
    const inviter = await createWorkspaceMember({ role: "owner" });
    await saveDirect({ "auth.inviteOnly": true });
    const blocked = await signUp("invitee@example.com");
    expect(blocked.status).toBe(403);

    const [invite] = await db
      .insert(schema.invitationTable)
      .values({
        email: "invitee@example.com",
        workspaceId: inviter.workspace.id,
        inviterId: inviter.user.id,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    const allowed = await signUp("invitee@example.com", {
      "x-invitation-id": invite?.id ?? "",
    });
    expect(allowed.status).toBe(200);
  });

  it("email sign-up off blocks sign-up but not the first-admin setup", async () => {
    await saveDirect({ "auth.emailSignUp": false });
    expect((await signUp("first@example.com")).status).toBe(200);
    const second = await signUp("second@example.com");
    expect(second.status).toBe(403);
    expect(await second.text()).toContain(
      "Password registration is currently disabled",
    );
  });

  it("email sign-in off blocks password and email-code sign-in", async () => {
    await signUpWithSession(app, "admin@example.com");
    await saveDirect({ "auth.emailSignIn": false });
    const password = await authPost(app, "/sign-in/email", {
      email: "admin@example.com",
      password: "correct horse battery staple",
    });
    expect(password.status).toBe(403);
    expect(await password.text()).toContain("Local sign-in is disabled");
    const code = await authPost(app, "/email-otp/send-verification-otp", {
      email: "admin@example.com",
      type: "sign-in",
    });
    expect(code.status).toBe(403);
  });

  it("email codes off blocks only the code paths", async () => {
    await signUpWithSession(app, "admin@example.com");
    await saveDirect({ "auth.emailCodeSignIn": false });
    const code = await authPost(app, "/email-otp/send-verification-otp", {
      email: "admin@example.com",
      type: "sign-in",
    });
    expect(code.status).toBe(403);
    expect(await code.text()).toContain(
      "Email codes are turned off on this server.",
    );
    const password = await authPost(app, "/sign-in/email", {
      email: "admin@example.com",
      password: "correct horse battery staple",
    });
    expect(password.status).toBe(200);
  });

  it("guest access off blocks guest sign-in", async () => {
    await signUpWithSession(app, "admin@example.com");
    expect((await authPost(app, "/sign-in/anonymous", {})).status).toBe(200);
    await saveDirect({ "auth.guestAccess": false });
    const guest = await authPost(app, "/sign-in/anonymous", {});
    expect(guest.status).toBe(403);
    expect(
      (
        (await (await app.request("/api/config")).json()) as Record<
          string,
          unknown
        >
      ).hasGuestAccess,
    ).toBe(false);
  });

  it("a configured provider an admin turned off can't start a sign-in", async () => {
    const admin = await signUpWithSession(app, "admin@example.com");
    expect(
      (
        await adminRequest(app, "PATCH", "/settings", admin.cookie, {
          values: { ...GITHUB, "oauth.github.enabled": false },
        })
      ).status,
    ).toBe(200);
    const refused = await authPost(app, "/sign-in/social", {
      provider: "github",
      callbackURL: "/",
    });
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain(
      "This sign-in method is turned off.",
    );

    await adminRequest(app, "PATCH", "/settings", admin.cookie, {
      values: { "oauth.github.enabled": true },
    });
    const started = await authPost(app, "/sign-in/social", {
      provider: "github",
      callbackURL: "/",
    });
    expect(started.status).toBe(200);
    expect(((await started.json()) as { url: string }).url).toContain(
      "client_id=github-client-id",
    );
    expect(
      (
        (await (await app.request("/api/config")).json()) as Record<
          string,
          unknown
        >
      ).hasGithubSignIn,
    ).toBe(true);
  });

  it("a provider turned off in the panel refuses even when unconfigured", async () => {
    await signUpWithSession(app, "admin@example.com");
    await saveDirect({ "oauth.google.enabled": false });
    const refused = await authPost(app, "/sign-in/social", {
      provider: "google",
      callbackURL: "/",
    });
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain(
      "This sign-in method is turned off.",
    );
  });

  it("restricted workspace creation allows admins only", async () => {
    const admin = await signUpWithSession(app, "admin@example.com");
    const member = await signUpWithSession(app, "member@example.com");
    await saveDirect({ "workspaces.restrictCreation": true });
    const create = (cookie: string, slug: string) =>
      authPost(
        app,
        "/organization/create",
        { name: "Team Space", slug },
        { cookie },
      );
    expect((await create(member.cookie, "member-space")).status).toBe(403);
    expect((await create(admin.cookie, "admin-space")).status).toBe(200);
  });
});

describe("last-admin guard on Better Auth's admin endpoints", () => {
  it("refuses demoting, banning or removing the last admin", async () => {
    const admin = await signUpWithSession(app, "admin@example.com");
    const member = await signUpWithSession(app, "member@example.com");
    for (const [path, body] of [
      ["/admin/set-role", { userId: admin.user.id, role: "user" }],
      ["/admin/ban-user", { userId: admin.user.id }],
      ["/admin/remove-user", { userId: admin.user.id }],
    ] as const) {
      const response = await authPost(app, path, body, {
        cookie: admin.cookie,
      });
      expect(response.status, path).toBe(409);
      expect(await response.text()).toContain(
        "There must be at least one instance admin",
      );
    }

    // With a second admin the demotion goes through.
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, member.user.id));
    const demoted = await authPost(
      app,
      "/admin/set-role",
      { userId: admin.user.id, role: "user" },
      { cookie: member.cookie },
    );
    expect(demoted.status).toBe(200);
  });
});
