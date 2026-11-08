import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { generateVapidKeys } from "../../apps/api/src/notification-preferences/web-push";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { clearTwoFactor } from "../../apps/api/src/utils/two-factor-reset";
import { endMemberAccess } from "../../apps/api/src/workspace/end-member-access";
import { createWorkspaceMember } from "./helpers/fixtures";
import {
  adminRequest,
  authPost,
  issuedCookies,
  resetInstanceState,
  signUpWithSession,
} from "./helpers/instance-admin";

// Whoever ends an account's sessions also ends push to its devices: otherwise
// a lost laptop keeps showing alerts after it was signed out. An ordinary sign
// out stays the browser's own job (use-push-subscription.ts), and turning a
// device off stays a person's choice.

type App = ReturnType<typeof createApp>["app"];

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new passphrase";

let app: App;
let admin: Awaited<ReturnType<typeof signUpWithSession>>;
let member: Awaited<ReturnType<typeof signUpWithSession>>;
let bystander: Awaited<ReturnType<typeof signUpWithSession>>;

async function addDevice(userId: string) {
  await db.insert(schema.pushSubscriptionTable).values({
    userId,
    endpoint: `https://push.example.com/send/${randomUUID()}`,
    p256dh: "p256dh",
    auth: "auth",
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY as string,
  });
}

async function deviceCount(userId: string) {
  const rows = await db
    .select({ id: schema.pushSubscriptionTable.id })
    .from(schema.pushSubscriptionTable)
    .where(eq(schema.pushSubscriptionTable.userId, userId));
  return rows.length;
}

async function resetTokens() {
  const rows = await db
    .select({ identifier: schema.verificationTable.identifier })
    .from(schema.verificationTable)
    .where(like(schema.verificationTable.identifier, "reset-password:%"));
  return rows.map((row) => row.identifier.slice("reset-password:".length));
}

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  const keys = generateVapidKeys();
  vi.stubEnv("VAPID_PUBLIC_KEY", keys.publicKey);
  vi.stubEnv("VAPID_PRIVATE_KEY", keys.privateKey);
  vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.com");
  vi.stubEnv("MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
  app = createApp().app;
  admin = await signUpWithSession(app, "admin@example.com");
  member = await signUpWithSession(app, "member@example.com");
  bystander = await signUpWithSession(app, "bystander@example.com");
  await addDevice(member.user.id);
  await addDevice(member.user.id);
  await addDevice(bystander.user.id);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function expectOnlyMembersDevicesGone() {
  expect(await deviceCount(member.user.id)).toBe(0);
  expect(await deviceCount(bystander.user.id)).toBe(1);
}

describe("when an administrator ends someone's sessions", () => {
  it("removes their devices on revoke-sessions", async () => {
    const response = await adminRequest(
      app,
      "POST",
      `/users/${member.user.id}/revoke-sessions`,
      admin.cookie,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await expectOnlyMembersDevicesGone();
  });

  it("removes their devices on a ban, so an unban doesn't bring them back", async () => {
    const response = await adminRequest(
      app,
      "POST",
      `/users/${member.user.id}/ban`,
      admin.cookie,
      {},
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await expectOnlyMembersDevicesGone();
  });

  it("removes their devices when setting a new password", async () => {
    const response = await adminRequest(
      app,
      "POST",
      `/users/${member.user.id}/reset-password`,
      admin.cookie,
      { password: NEW_PASSWORD },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await expectOnlyMembersDevicesGone();
  });
});

describe("when two-factor is reset", () => {
  it("removes the devices along with the sessions", async () => {
    await db
      .update(schema.userTable)
      .set({ twoFactorEnabled: true })
      .where(eq(schema.userTable.id, member.user.id));
    expect(await clearTwoFactor(member.user.id)).toBe(true);
    await expectOnlyMembersDevicesGone();
  });

  it("leaves them when two-factor wasn't on and nobody was signed out", async () => {
    expect(await clearTwoFactor(member.user.id)).toBe(false);
    expect(await deviceCount(member.user.id)).toBe(2);
  });
});

describe("when the password is reset through a link", () => {
  it("removes the devices", async () => {
    await authPost(app, "/request-password-reset", {
      email: "member@example.com",
    });
    const [token] = await resetTokens();
    const response = await authPost(app, "/reset-password", {
      token,
      newPassword: NEW_PASSWORD,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    await expectOnlyMembersDevicesGone();
  });

  it("removes the devices when the token comes in the query string", async () => {
    await authPost(app, "/request-password-reset", {
      email: "member@example.com",
    });
    const [token] = await resetTokens();
    const response = await authPost(app, `/reset-password?token=${token}`, {
      newPassword: NEW_PASSWORD,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    await expectOnlyMembersDevicesGone();
  });

  it("applies the email rule when the token comes in the query string", async () => {
    await authPost(app, "/request-password-reset", {
      email: "member@example.com",
    });
    const [token] = await resetTokens();
    const response = await authPost(app, `/reset-password?token=${token}`, {
      newPassword: "member@example.com",
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("PASSWORD_MATCHES_EMAIL");
    expect(await deviceCount(member.user.id)).toBe(2);
  });

  it("leaves them when the link is refused", async () => {
    const response = await authPost(app, "/reset-password", {
      token: "not-a-token",
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(400);
    expect(await deviceCount(member.user.id)).toBe(2);
  });
});

describe("through the auth endpoints that end sessions directly", () => {
  it("removes their devices on an admin's ban-user", async () => {
    const response = await authPost(
      app,
      "/admin/ban-user",
      { userId: member.user.id },
      { cookie: admin.cookie },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await expectOnlyMembersDevicesGone();
  });

  it("removes their devices on an admin's revoke-user-sessions", async () => {
    const response = await authPost(
      app,
      "/admin/revoke-user-sessions",
      { userId: member.user.id },
      { cookie: admin.cookie },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await expectOnlyMembersDevicesGone();
  });

  it("leaves them when an admin endpoint refuses", async () => {
    const response = await authPost(
      app,
      "/admin/ban-user",
      { userId: member.user.id },
      { cookie: bystander.cookie },
    );
    expect(response.status).toBe(403);
    expect(await deviceCount(member.user.id)).toBe(2);
  });

  it("removes the devices when someone ends all their own sessions", async () => {
    const response = await authPost(
      app,
      "/revoke-sessions",
      {},
      { cookie: member.cookie },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await expectOnlyMembersDevicesGone();
  });

  describe("with a password reset code", () => {
    // Nothing mails this kind of code yet (auth.ts sends sign-in, verification
    // and email-change codes), so the test stores one the way the plugin does.
    async function storeResetCode(otp: string) {
      await db.insert(schema.verificationTable).values({
        identifier: "forget-password-otp-member@example.com",
        value: `${otp}:0`,
        expiresAt: new Date(Date.now() + 60_000),
      });
    }

    it("removes the devices", async () => {
      await storeResetCode("123456");
      const response = await authPost(app, "/email-otp/reset-password", {
        email: "member@example.com",
        otp: "123456",
        password: NEW_PASSWORD,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      await expectOnlyMembersDevicesGone();
    });

    it("leaves them when the code is wrong", async () => {
      await storeResetCode("123456");
      const response = await authPost(app, "/email-otp/reset-password", {
        email: "member@example.com",
        otp: "654321",
        password: NEW_PASSWORD,
      });
      expect(response.status).toBe(400);
      expect(await deviceCount(member.user.id)).toBe(2);
    });
  });
});

describe("when someone is removed from a workspace", () => {
  it("removes the devices once nothing is left and the sessions end", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    await endMemberAccess({
      workspaceId: workspace.id,
      userId: member.user.id,
      byThemselves: false,
    });
    await expectOnlyMembersDevicesGone();
  });

  it("keeps them while another workspace still holds the account", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    const { workspace: other } = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: other.id,
      userId: member.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await endMemberAccess({
      workspaceId: workspace.id,
      userId: member.user.id,
      byThemselves: false,
    });
    expect(await deviceCount(member.user.id)).toBe(2);
  });
});

describe("when people act on their own account", () => {
  const changePassword = (revokeOtherSessions: boolean, current = PASSWORD) =>
    authPost(
      app,
      "/change-password",
      {
        currentPassword: current,
        newPassword: NEW_PASSWORD,
        revokeOtherSessions,
      },
      { cookie: member.cookie },
    );

  it("removes the devices when a password change signs out the others", async () => {
    const response = await changePassword(true);
    expect(response.status, await response.clone().text()).toBe(200);
    await expectOnlyMembersDevicesGone();
  });

  it("lets this browser put itself back on the new session", async () => {
    const response = await changePassword(true);
    expect(response.status).toBe(200);
    const back = await app.request(
      "/api/notification-preferences/push/subscriptions",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: issuedCookies(response),
        },
        body: JSON.stringify({
          endpoint: "https://push.example.com/send/this-browser",
          keys: {
            p256dh:
              "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
            auth: "tBHItJI5svbpez7KI4CCXg",
          },
        }),
      },
    );
    expect(back.status, await back.clone().text()).toBe(200);
    expect(await deviceCount(member.user.id)).toBe(1);
  });

  it("keeps the devices when a password change signs nobody out", async () => {
    const response = await changePassword(false);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await deviceCount(member.user.id)).toBe(2);
  });

  it("keeps the devices when a password change is refused", async () => {
    const response = await changePassword(true, "not the current password");
    expect(response.status).toBe(400);
    expect(await deviceCount(member.user.id)).toBe(2);
  });

  it("removes the devices on signing out every other session", async () => {
    const response = await authPost(
      app,
      "/revoke-other-sessions",
      {},
      { cookie: member.cookie },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await expectOnlyMembersDevicesGone();
  });

  it("leaves an ordinary sign-out to the browser, as before", async () => {
    const response = await authPost(
      app,
      "/sign-out",
      {},
      { cookie: member.cookie },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await deviceCount(member.user.id)).toBe(2);
  });

  it("can't tell which device one signed-out session was, so keeps them", async () => {
    const signedIn = await authPost(app, "/sign-in/email", {
      email: "member@example.com",
      password: PASSWORD,
    });
    const other = issuedCookies(signedIn);
    const [session] = await db
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, member.user.id))
      .limit(1);
    const response = await app.request(
      `/api/user/sessions/${encodeURIComponent(session?.id ?? "")}`,
      { method: "DELETE", headers: { cookie: other } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await deviceCount(member.user.id)).toBe(2);
  });
});
