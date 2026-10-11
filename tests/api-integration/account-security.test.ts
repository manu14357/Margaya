import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  authPost,
  issuedCookies,
  resetInstanceState,
  signUpWithSession,
} from "./helpers/instance-admin";

const mocks = vi.hoisted(() => ({ syncWorkspaceSeats: vi.fn() }));

// Removing and leaving must run the same follow-up; the seat sync stands in
// for it here.
vi.mock("../../apps/api/src/billing/controllers/sync-seats", () => ({
  syncWorkspaceSeats: mocks.syncWorkspaceSeats,
}));

type App = ReturnType<typeof createApp>["app"];

const PASSWORD = "correct horse battery staple";

let app: App;

beforeEach(async () => {
  await resetInstanceState();
  mocks.syncWorkspaceSeats.mockReset();
  mocks.syncWorkspaceSeats.mockResolvedValue(undefined);
  app = createApp().app;
});

async function signIn(email: string, password = PASSWORD) {
  return authPost(app, "/sign-in/email", { email, password });
}

async function newSession(email: string) {
  const response = await signIn(email);
  expect(response.status).toBe(200);
  return issuedCookies(response);
}

async function sessionUser(cookie: string) {
  const response = await app.request("/api/auth/get-session", {
    headers: { cookie },
  });
  return (await response.json()) as {
    user: { id: string; emailVerified: boolean };
  } | null;
}

function security(cookie: string) {
  return app.request("/api/user/security", { headers: { cookie } });
}

function revokeSession(cookie: string, id: string) {
  return app.request(`/api/user/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { cookie },
  });
}

async function resetTokens() {
  const rows = await db
    .select({ identifier: schema.verificationTable.identifier })
    .from(schema.verificationTable)
    .where(like(schema.verificationTable.identifier, "reset-password:%"));
  return rows.map((row) => row.identifier.slice("reset-password:".length));
}

describe("forgotten password", () => {
  it("answers the same whether or not the account exists", async () => {
    await signUpWithSession(app, "known@example.com");

    const known = await authPost(app, "/request-password-reset", {
      email: "known@example.com",
    });
    const unknown = await authPost(app, "/request-password-reset", {
      email: "nobody@example.com",
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await unknown.text()).toBe(await known.text());
    // Only the real account got a reset link.
    expect(await resetTokens()).toHaveLength(1);
  });

  it("sets the new password once and signs out every session", async () => {
    const { cookie } = await signUpWithSession(app, "reset@example.com");
    await authPost(app, "/request-password-reset", {
      email: "reset@example.com",
    });
    const [token] = await resetTokens();

    const reset = await authPost(app, "/reset-password", {
      token,
      newPassword: "a brand new passphrase",
    });
    expect(reset.status).toBe(200);

    expect(await sessionUser(cookie)).toBeNull();
    expect((await signIn("reset@example.com")).status).toBe(401);
    expect(
      (await signIn("reset@example.com", "a brand new passphrase")).status,
    ).toBe(200);

    // A used link is spent.
    const again = await authPost(app, "/reset-password", {
      token,
      newPassword: "yet another passphrase",
    });
    expect(again.status).toBe(400);
    expect(await again.text()).toContain("INVALID_TOKEN");
  });

  it("refuses an unknown token and a too-short password", async () => {
    await signUpWithSession(app, "rules@example.com");
    const unknown = await authPost(app, "/reset-password", {
      token: "not-a-real-token",
      newPassword: "a brand new passphrase",
    });
    expect(unknown.status).toBe(400);

    await authPost(app, "/request-password-reset", {
      email: "rules@example.com",
    });
    const [token] = await resetTokens();
    const short = await authPost(app, "/reset-password", {
      token,
      newPassword: "short",
    });
    expect(short.status).toBe(400);
    expect(await short.text()).toContain("PASSWORD_TOO_SHORT");
  });
});

describe("change password", () => {
  it("refuses a wrong current password and keeps the old one", async () => {
    const { cookie } = await signUpWithSession(app, "change@example.com");

    const response = await authPost(
      app,
      "/change-password",
      {
        currentPassword: "not my password",
        newPassword: "a brand new passphrase",
      },
      { cookie },
    );

    expect(response.status).toBe(400);
    expect((await signIn("change@example.com")).status).toBe(200);
  });

  it("signs out the other sessions when asked", async () => {
    const { cookie } = await signUpWithSession(app, "others@example.com");
    const other = await newSession("others@example.com");

    const response = await authPost(
      app,
      "/change-password",
      {
        currentPassword: PASSWORD,
        newPassword: "a brand new passphrase",
        revokeOtherSessions: true,
      },
      { cookie },
    );

    expect(response.status).toBe(200);
    expect(await sessionUser(other)).toBeNull();
    // The session that changed it continues on a fresh cookie.
    expect(await sessionUser(issuedCookies(response))).not.toBeNull();
  });
});

describe("active sessions", () => {
  it("lists the user's sessions without their tokens", async () => {
    const { cookie, user } = await signUpWithSession(app, "list@example.com");
    await newSession("list@example.com");

    const response = await security(cookie);
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text) as {
      hasPassword: boolean;
      sessions: Array<Record<string, unknown>>;
    };

    expect(body.hasPassword).toBe(true);
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.filter((session) => session.current)).toHaveLength(1);
    const tokens = await db
      .select({ token: schema.sessionTable.token })
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, user.id));
    for (const { token } of tokens) {
      expect(text).not.toContain(token);
    }
    for (const session of body.sessions) {
      expect(Object.keys(session).sort()).toEqual([
        "createdAt",
        "current",
        "expiresAt",
        "id",
        "ipAddress",
        "lastActiveAt",
        "userAgent",
      ]);
    }
  });

  it("signs out only the caller's own other sessions", async () => {
    const { cookie } = await signUpWithSession(app, "mine@example.com");
    const second = await newSession("mine@example.com");
    const { cookie: strangerCookie } = await signUpWithSession(
      app,
      "stranger@example.com",
    );

    const mine = (await (await security(cookie)).json()) as {
      sessions: Array<{ id: string; current: boolean }>;
    };
    const current = mine.sessions.find((session) => session.current);
    const otherId = mine.sessions.find((session) => !session.current)?.id;
    expect(current && otherId).toBeTruthy();

    // Someone else cannot end it, and cannot tell it exists.
    const foreign = await revokeSession(strangerCookie, otherId ?? "");
    expect(foreign.status).toBe(404);
    expect(await sessionUser(second)).not.toBeNull();

    expect((await revokeSession(cookie, current?.id ?? "")).status).toBe(400);

    const own = await revokeSession(cookie, otherId ?? "");
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ revoked: true });
    expect(await sessionUser(second)).toBeNull();
    expect(await sessionUser(cookie)).not.toBeNull();
    expect((await revokeSession(cookie, otherId ?? "")).status).toBe(404);
  });

  it("needs a signed-in session", async () => {
    expect((await app.request("/api/user/security")).status).toBe(401);
  });
});

async function workspaceWith(ownerId: string, memberIds: string[]) {
  const workspaceId = `workspace-${randomUUID()}`;
  await db.insert(schema.workspaceTable).values({
    id: workspaceId,
    name: "Leave Test",
    slug: workspaceId,
    createdAt: new Date(),
  });
  await db.insert(schema.workspaceUserTable).values([
    { workspaceId, userId: ownerId, role: "owner", joinedAt: new Date() },
    ...memberIds.map((userId) => ({
      workspaceId,
      userId,
      role: "member",
      joinedAt: new Date(),
    })),
  ]);
  return workspaceId;
}

/** The roles still in the workspace. */
async function memberRoles(workspaceId: string) {
  return db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
}

describe("leave workspace", () => {
  it("lets a member leave, with the same follow-up as a removal", async () => {
    const owner = await signUpWithSession(app, "owner@example.com");
    const member = await signUpWithSession(app, "leaver@example.com");
    const workspaceId = await workspaceWith(owner.user.id, [member.user.id]);

    const response = await authPost(
      app,
      "/organization/leave",
      { organizationId: workspaceId },
      { cookie: member.cookie },
    );

    expect(response.status).toBe(200);
    expect(await memberRoles(workspaceId)).toEqual([{ role: "owner" }]);
    expect(mocks.syncWorkspaceSeats).toHaveBeenCalledWith(workspaceId);
  });

  it("refuses the last owner", async () => {
    const owner = await signUpWithSession(app, "sole-owner@example.com");
    const member = await signUpWithSession(app, "stays@example.com");
    const workspaceId = await workspaceWith(owner.user.id, [member.user.id]);

    const response = await authPost(
      app,
      "/organization/leave",
      { organizationId: workspaceId },
      { cookie: owner.cookie },
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
    );
    expect(await memberRoles(workspaceId)).toHaveLength(2);
    expect(mocks.syncWorkspaceSeats).not.toHaveBeenCalled();
  });
});

describe("email verification", () => {
  async function otpFor(email: string) {
    const [row] = await db
      .select({ value: schema.verificationTable.value })
      .from(schema.verificationTable)
      .where(
        eq(
          schema.verificationTable.identifier,
          `email-verification-otp-${email}`,
        ),
      );
    return row?.value.split(":")[0] ?? "";
  }

  it("shows invitations once the address is verified", async () => {
    const owner = await signUpWithSession(app, "inviter@example.com");
    const invitee = await signUpWithSession(app, "invitee@example.com");
    const workspaceId = await workspaceWith(owner.user.id, []);
    await db.insert(schema.invitationTable).values({
      workspaceId,
      email: "invitee@example.com",
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
      inviterId: owner.user.id,
    });
    const pending = () =>
      app.request("/api/invitation/pending", {
        headers: { cookie: invitee.cookie },
      });

    expect(await (await pending()).json()).toEqual([]);

    const send = await authPost(
      app,
      "/email-otp/send-verification-otp",
      { email: "invitee@example.com", type: "email-verification" },
      { cookie: invitee.cookie },
    );
    expect(send.status).toBe(200);

    const wrong = await authPost(
      app,
      "/email-otp/verify-email",
      { email: "invitee@example.com", otp: "000000" },
      { cookie: invitee.cookie },
    );
    expect(wrong.status).toBe(400);

    const verify = await authPost(
      app,
      "/email-otp/verify-email",
      {
        email: "invitee@example.com",
        otp: await otpFor("invitee@example.com"),
      },
      { cookie: invitee.cookie },
    );
    expect(verify.status).toBe(200);
    expect((await sessionUser(invitee.cookie))?.user.emailVerified).toBe(true);

    const invitations = (await (await pending()).json()) as unknown[];
    expect(invitations).toHaveLength(1);
  });

  it("sends codes only to the signed-in user's own address", async () => {
    const { cookie } = await signUpWithSession(app, "self@example.com");
    await signUpWithSession(app, "victim@example.com");

    const foreign = await authPost(
      app,
      "/email-otp/send-verification-otp",
      { email: "victim@example.com", type: "email-verification" },
      { cookie },
    );
    expect(foreign.status).toBe(403);

    const anonymous = await authPost(app, "/email-otp/send-verification-otp", {
      email: "victim@example.com",
      type: "email-verification",
    });
    expect(anonymous.status).toBe(403);
    expect(await otpFor("victim@example.com")).toBe("");
  });
});
