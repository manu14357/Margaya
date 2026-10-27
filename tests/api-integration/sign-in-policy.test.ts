import * as email from "@margaya/email";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  adminRequest,
  authPost,
  issuedCookies,
  resetInstanceState,
  signUpWithSession,
  unlockSignUpSettings,
} from "./helpers/instance-admin";

// 4.11: the sign-in policy as instance settings: allowed email domains,
// password sign-up kept for invitations, a required provider, and the
// session lifetime.

type App = ReturnType<typeof createApp>["app"];

const PASSWORD = "correct horse battery staple";

let app: App;
let admin: Awaited<ReturnType<typeof signUpWithSession>>;

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  app = createApp().app;
  admin = await signUpWithSession(app, "admin@acme.test");
  unlockSignUpSettings();
});

afterEach(() => vi.unstubAllEnvs());

async function setSettings(values: Record<string, unknown>) {
  return adminRequest(app, "PATCH", "/settings", admin.cookie, { values });
}

async function saved(values: Record<string, unknown>) {
  const response = await setSettings(values);
  expect(response.status, await response.clone().text()).toBe(200);
}

function signUp(address: string, extra: Record<string, unknown> = {}) {
  return authPost(app, "/sign-up/email", {
    name: address.split("@")[0],
    email: address,
    password: PASSWORD,
    ...extra,
  });
}

async function invite(address: string) {
  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({
      id: `ws-${address}`,
      name: "Acme",
      slug: `acme-${Date.now()}`,
      createdAt: new Date(),
    })
    .returning();
  const [invitation] = await db
    .insert(schema.invitationTable)
    .values({
      id: `inv${Date.now()}`,
      workspaceId: workspace?.id ?? "",
      email: address,
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
      inviterId: admin.user.id,
      createdAt: new Date(),
    })
    .returning();
  return invitation?.id ?? "";
}

describe("allowed email domains", () => {
  it("normalizes the list and refuses new accounts outside it", async () => {
    await saved({ "auth.allowedEmailDomains": " Acme.test, @corp.test " });
    const settings = (await (
      await adminRequest(app, "GET", "/settings", admin.cookie)
    ).json()) as { settings: { key: string; value?: unknown }[] };
    expect(
      settings.settings.find((s) => s.key === "auth.allowedEmailDomains")
        ?.value,
    ).toBe("acme.test,corp.test");

    expect((await signUp("eve@evil.test")).status).toBe(403);
    expect((await signUp("bob@corp.test")).status).toBe(200);
    // Subdomains do not count.
    expect((await signUp("mal@x.acme.test")).status).toBe(403);
  });

  it("rejects malformed domains", async () => {
    expect(
      (await setSettings({ "auth.allowedEmailDomains": "not a domain!" }))
        .status,
    ).toBe(400);
  });
});

describe("password sign-up kept for invitations", () => {
  it("lets only invited people sign up with a password", async () => {
    await saved({ "auth.emailSignUp": false });
    const invitationId = await invite("guest@acme.test");
    expect((await signUp("guest@acme.test", { invitationId })).status).toBe(
      403,
    );

    await saved({ "auth.emailSignUpForInvitations": true });
    expect((await signUp("walkin@acme.test")).status).toBe(403);
    // The invitation must be for the same address.
    expect((await signUp("other@acme.test", { invitationId })).status).toBe(
      403,
    );
    expect((await signUp("guest@acme.test", { invitationId })).status).toBe(
      200,
    );
  });
});

describe("required sign-in provider", () => {
  beforeEach(async () => {
    expect((await signUp("member@acme.test")).status).toBe(200);
  });

  it("must name a working provider", async () => {
    const response = await setSettings({ "auth.requiredProvider": "google" });
    expect(response.status).toBe(409);
  });

  it("sends everyone but instance admins to the provider", async () => {
    await saved({
      "oauth.github.clientId": "client-id",
      "oauth.github.clientSecret": "client-secret",
      "auth.requiredProvider": "github",
    });
    const sendMagicLink = vi.spyOn(email, "sendMagicLinkEmail");

    // A correct password learns the rule; a wrong one gets the usual answer.
    const refused = await authPost(app, "/sign-in/email", {
      email: "member@acme.test",
      password: PASSWORD,
    });
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain("GitHub");
    const wrong = await authPost(app, "/sign-in/email", {
      email: "member@acme.test",
      password: "not the password at all",
    });
    expect(wrong.status).toBe(401);

    // New password accounts are refused.
    expect((await signUp("late@acme.test")).status).toBe(403);

    // Email links look sent but never go out.
    const link = await authPost(app, "/sign-in/magic-link", {
      email: "member@acme.test",
    });
    expect(link.status).toBe(200);
    expect(sendMagicLink).not.toHaveBeenCalled();

    // Another provider is refused.
    const discord = await authPost(app, "/sign-in/social", {
      provider: "discord",
    });
    expect(discord.status).toBe(403);

    // Instance admins keep password sign-in as a way back in.
    const adminSignIn = await authPost(app, "/sign-in/email", {
      email: "admin@acme.test",
      password: PASSWORD,
    });
    expect(adminSignIn.status).toBe(200);
  });
});

describe("session lifetime", () => {
  it("sets how long new sessions last", async () => {
    await saved({ "auth.sessionLifetimeHours": 2 });
    const response = await authPost(app, "/sign-in/email", {
      email: "admin@acme.test",
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(issuedCookies(response)).toContain("session_token");
    const body = (await response.json()) as { token: string };
    const [session] = await db
      .select({ expiresAt: schema.sessionTable.expiresAt })
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.token, body.token));
    const hours =
      ((session?.expiresAt.getTime() ?? 0) - Date.now()) / (60 * 60 * 1000);
    expect(hours).toBeGreaterThan(1.9);
    expect(hours).toBeLessThanOrEqual(2.01);
  });

  it("rejects values out of range", async () => {
    expect((await setSettings({ "auth.sessionLifetimeHours": 0 })).status).toBe(
      400,
    );
  });
});
