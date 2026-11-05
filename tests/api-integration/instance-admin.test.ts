import * as email from "@margaya/email";
import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  adminRequest,
  authPost,
  resetInstanceState,
  signUpWithSession,
  unlockSignUpSettings,
} from "./helpers/instance-admin";
import { setTestEmailResult } from "./mocks/email";

type App = ReturnType<typeof createApp>["app"];

const events: Array<{ type: string; data: Record<string, unknown> }> = [];

beforeAll(async () => {
  for (const type of ["instance.admin_added", "instance.admin_removed"]) {
    await subscribeToEvent<Record<string, unknown>>(type, async (data) => {
      events.push({ type, data });
    });
  }
});

let app: App;
let admin: Awaited<ReturnType<typeof signUpWithSession>>;

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  events.length = 0;
  app = createApp().app;
  admin = await signUpWithSession(app, "admin@example.com");
  unlockSignUpSettings();
});

afterEach(() => vi.unstubAllEnvs());

async function ok<T>(response: Response): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as T;
}

describe("A1 overview", () => {
  it("counts accounts, guests, workspaces, projects and published boards", async () => {
    const owner = await createWorkspaceMember();
    const project = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await createProjectFixture({
      workspaceId: owner.workspace.id,
      slug: "second",
    });
    await db.insert(schema.projectPublicationTable).values([
      {
        projectId: project.project.id,
        linkToken: "published-board-token-1",
        publishedAt: new Date(),
      },
    ]);
    expect((await authPost(app, "/sign-in/anonymous", {})).status).toBe(200);

    const overview = await ok<Record<string, unknown>>(
      await adminRequest(app, "GET", "/overview", admin.cookie),
    );
    expect(overview).toMatchObject({
      instanceName: "Margaya",
      counts: {
        accounts: 2,
        guests: 1,
        workspaces: 1,
        projects: 2,
        publishedBoards: 1,
      },
      server: {
        realtime: "memory",
        email: false,
        cloudMode: false,
        demoMode: false,
      },
      settingsLocked: false,
    });
    expect(typeof overview.version).toBe("string");
  });
});

describe("recent delivery failures", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function seedDeliveries() {
    const owner = await createWorkspaceMember();
    const [webhook] = await db
      .insert(schema.workspaceWebhookTable)
      .values({
        workspaceId: owner.workspace.id,
        name: "Billing hook",
        url: "https://hooks.example.com/secret-token",
        secretCiphertext: "sealed",
        secretLast4: "abcd",
      })
      .returning();
    if (!webhook) throw new Error("webhook was not created");
    const delivery = {
      webhookId: webhook.id,
      workspaceId: owner.workspace.id,
      event: "task.created",
      entityType: "task" as const,
      body: '{"private":"task body"}',
    };
    const completedAt = new Date(Date.now() - DAY);
    await db.insert(schema.webhookDeliveryTable).values([
      {
        ...delivery,
        status: "failed",
        responseStatus: 500,
        responseSnippet: "private response",
        attemptCount: 6,
        completedAt,
      },
      { ...delivery, event: "task.updated", status: "succeeded" },
      {
        ...delivery,
        event: "task.deleted",
        status: "failed",
        createdAt: new Date(Date.now() - 8 * DAY),
      },
    ]);
    return { owner, completedAt };
  }

  it("lists only recent failures, without the URL, body or response", async () => {
    const { owner, completedAt } = await seedDeliveries();

    const response = await adminRequest(
      app,
      "GET",
      "/delivery-failures",
      admin.cookie,
    );
    const text = await response.clone().text();
    const { items } = await ok<{ items: Array<Record<string, unknown>> }>(
      response,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      workspaceName: owner.workspace.name,
      webhookName: "Billing hook",
      event: "task.created",
      responseStatus: 500,
      attemptCount: 6,
      failedAt: completedAt.toISOString(),
    });
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("task body");
    expect(text).not.toContain("private response");
  });

  it("is refused for someone who isn't an instance admin", async () => {
    const member = await signUpWithSession(app, "member@example.com");

    const response = await adminRequest(
      app,
      "GET",
      "/delivery-failures",
      member.cookie,
    );

    expect(response.status).toBe(403);
  });
});

describe("A4 workspaces", () => {
  it("searches and pages newest first with owner and counts", async () => {
    const workspaces = [];
    for (const [index, name] of ["Alpha", "Beta", "Gamma"].entries()) {
      const member = await createWorkspaceMember({
        workspaceName: name,
        role: "owner",
      });
      await db
        .update(schema.workspaceTable)
        .set({ createdAt: new Date(Date.UTC(2026, 0, index + 1)) })
        .where(eq(schema.workspaceTable.id, member.workspace.id));
      workspaces.push(member);
    }
    const gamma = workspaces[2];
    if (!gamma) throw new Error("fixture");
    await createProjectFixture({ workspaceId: gamma.workspace.id });

    const first = await ok<{
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    }>(await adminRequest(app, "GET", "/workspaces?limit=2", admin.cookie));
    expect(first.items.map((item) => item.name)).toEqual(["Gamma", "Beta"]);
    expect(first.items[0]).toMatchObject({
      owner: { id: gamma.user.id, email: gamma.user.email },
      memberCount: 1,
      projectCount: 1,
    });
    expect(first.nextCursor).toBeTruthy();

    const second = await ok<{
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    }>(
      await adminRequest(
        app,
        "GET",
        `/workspaces?limit=2&cursor=${first.nextCursor}`,
        admin.cookie,
      ),
    );
    expect(second.items.map((item) => item.name)).toEqual(["Alpha"]);
    expect(second.nextCursor).toBeNull();

    const search = await ok<{ items: Array<Record<string, unknown>> }>(
      await adminRequest(app, "GET", "/workspaces?search=bet", admin.cookie),
    );
    expect(search.items.map((item) => item.name)).toEqual(["Beta"]);
    expect(
      (await adminRequest(app, "GET", "/workspaces?cursor=nope", admin.cookie))
        .status,
    ).toBe(400);
  });
});

describe("A5 test email", () => {
  it("needs email set up, then passes the classified result through", async () => {
    const notSetUp = await adminRequest(
      app,
      "POST",
      "/email/test",
      admin.cookie,
      {},
    );
    expect(notSetUp.status).toBe(409);
    expect(await notSetUp.text()).toBe("Set up email first");

    await ok(
      await adminRequest(app, "PATCH", "/settings", admin.cookie, {
        values: {
          "smtp.host": "smtp.example.test",
          "smtp.from": "Margaya <no-reply@example.test>",
        },
      }),
    );
    const send = vi.spyOn(email, "sendTestEmail");
    setTestEmailResult({
      sent: true,
      code: "ok",
      message: "The test email was sent.",
    });
    expect(
      await ok(
        await adminRequest(app, "POST", "/email/test", admin.cookie, {}),
      ),
    ).toEqual({ sent: true, code: "ok", message: "The test email was sent." });
    expect(send).toHaveBeenLastCalledWith("admin@example.com", {
      instanceName: "Margaya",
      locale: null,
    });

    for (const code of [
      "auth",
      "connection",
      "tls",
      "timeout",
      "sender",
      "recipient",
      "unknown",
    ] as const) {
      resetRateLimitMemory();
      setTestEmailResult(
        email.classifySmtpError(
          Object.assign(new Error("x"), {
            code: {
              auth: "EAUTH",
              connection: "ECONNECTION",
              tls: "ETLS",
              timeout: "ETIMEDOUT",
              sender: "EENVELOPE",
              recipient: "EENVELOPE",
              unknown: "EPROTOCOL",
            }[code],
            command:
              code === "sender"
                ? "MAIL FROM"
                : code === "recipient"
                  ? "RCPT TO"
                  : undefined,
          }),
        ),
      );
      const result = await ok<{ code: string; sent: boolean }>(
        await adminRequest(app, "POST", "/email/test", admin.cookie, {
          to: "someone@example.test",
        }),
      );
      expect(result).toMatchObject({ sent: false, code });
    }
    expect(send).toHaveBeenLastCalledWith("someone@example.test", {
      instanceName: "Margaya",
      locale: null,
    });
  });

  it("validates the recipient and limits each admin to 5 a minute", async () => {
    const invalid = await adminRequest(
      app,
      "POST",
      "/email/test",
      admin.cookie,
      {
        to: "not-an-email",
      },
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toBe("Enter a valid email address");

    await ok(
      await adminRequest(app, "PATCH", "/settings", admin.cookie, {
        values: {
          "smtp.host": "smtp.example.test",
          "smtp.from": "a@example.test",
        },
      }),
    );
    setTestEmailResult({
      sent: true,
      code: "ok",
      message: "The test email was sent.",
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await ok(
        await adminRequest(app, "POST", "/email/test", admin.cookie, {}),
      );
    }
    const limited = await adminRequest(
      app,
      "POST",
      "/email/test",
      admin.cookie,
      {},
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});

describe("A6-A8 admins", () => {
  it("lists, adds and removes admins with the guards", async () => {
    const member = await signUpWithSession(app, "member@example.com");
    const list = await ok<Array<Record<string, unknown>>>(
      await adminRequest(app, "GET", "/admins", admin.cookie),
    );
    expect(list).toEqual([
      expect.objectContaining({
        id: admin.user.id,
        email: "admin@example.com",
        isYou: true,
      }),
    ]);

    const unknown = await adminRequest(app, "POST", "/admins", admin.cookie, {
      email: "nobody@example.com",
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe("No account uses this email");

    expect((await authPost(app, "/sign-in/anonymous", {})).status).toBe(200);
    const [guest] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.isAnonymous, true));
    const guestResponse = await adminRequest(
      app,
      "POST",
      "/admins",
      admin.cookie,
      {
        email: guest?.email,
      },
    );
    expect(guestResponse.status).toBe(400);
    expect(await guestResponse.text()).toBe(
      "Guest accounts can't be instance admins",
    );

    const banned = await signUpWithSession(app, "banned@example.com");
    await db
      .update(schema.userTable)
      .set({ banned: true })
      .where(eq(schema.userTable.id, banned.user.id));
    const bannedResponse = await adminRequest(
      app,
      "POST",
      "/admins",
      admin.cookie,
      {
        email: "banned@example.com",
      },
    );
    expect(bannedResponse.status).toBe(400);
    expect(await bannedResponse.text()).toBe("This account is banned");

    const added = await ok(
      await adminRequest(app, "POST", "/admins", admin.cookie, {
        email: "MEMBER@example.com",
      }),
    );
    expect(added).toMatchObject({ id: member.user.id, isYou: false });
    expect(events).toEqual([
      {
        type: "instance.admin_added",
        data: expect.objectContaining({
          targetUserId: member.user.id,
          userId: admin.user.id,
        }),
      },
    ]);
    await ok(
      await adminRequest(app, "POST", "/admins", admin.cookie, {
        email: "member@example.com",
      }),
    );
    expect(events).toHaveLength(1);

    const notAdmin = await adminRequest(
      app,
      "DELETE",
      `/admins/${banned.user.id}`,
      admin.cookie,
    );
    expect(notAdmin.status).toBe(404);
    expect(await notAdmin.text()).toBe("This person isn't an instance admin");

    // Removing myself while another admin exists works, and then I'm out.
    expect(
      await ok(
        await adminRequest(
          app,
          "DELETE",
          `/admins/${admin.user.id}`,
          admin.cookie,
        ),
      ),
    ).toEqual({ userId: admin.user.id });
    expect(
      (await adminRequest(app, "GET", "/admins", admin.cookie)).status,
    ).toBe(403);
    expect(events.at(-1)).toMatchObject({ type: "instance.admin_removed" });

    const last = await adminRequest(
      app,
      "DELETE",
      `/admins/${member.user.id}`,
      member.cookie,
    );
    expect(last.status).toBe(409);
    expect(await last.text()).toBe("There must be at least one instance admin");
  });

  it("keeps one admin when the last two remove each other at once", async () => {
    const member = await signUpWithSession(app, "member@example.com");
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, member.user.id));
    const responses = await Promise.all([
      adminRequest(app, "DELETE", `/admins/${member.user.id}`, admin.cookie),
      adminRequest(app, "DELETE", `/admins/${admin.user.id}`, member.cookie),
    ]);
    // The loser sees 409 (the last-admin guard) or 403 (no longer an
    // admin), depending on which request takes the lock first.
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const admins = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.role, "admin"));
    expect(admins).toHaveLength(1);
  });
});

describe("A9 public boards", () => {
  it("lists published boards only, newest first, with features", async () => {
    const owner = await createWorkspaceMember({ workspaceName: "Acme" });
    const live = await createProjectFixture({
      workspaceId: owner.workspace.id,
      name: "Roadmap",
    });
    const older = await createProjectFixture({
      workspaceId: owner.workspace.id,
      name: "Changelog",
      slug: "changelog",
    });
    const hidden = await createProjectFixture({
      workspaceId: owner.workspace.id,
      name: "Private",
      slug: "private",
    });
    await db.insert(schema.projectPublicationTable).values([
      {
        projectId: live.project.id,
        linkToken: "roadmap-token-0000000001",
        publishedAt: new Date(Date.UTC(2026, 5, 2)),
        commentsEnabled: true,
        votesEnabled: true,
      },
      {
        projectId: older.project.id,
        linkToken: "changelog-token-00000001",
        publishedAt: new Date(Date.UTC(2026, 5, 1)),
      },
      {
        projectId: hidden.project.id,
        linkToken: "private-token-0000000001",
        publishedAt: null,
      },
    ]);

    const page = await ok<{
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    }>(await adminRequest(app, "GET", "/public-boards?limit=1", admin.cookie));
    expect(page.items).toEqual([
      expect.objectContaining({
        projectId: live.project.id,
        projectName: "Roadmap",
        workspaceName: "Acme",
        path: "/public-project/roadmap-token-0000000001",
        features: {
          comments: true,
          reactions: false,
          votes: true,
          requests: false,
          guests: false,
        },
      }),
    ]);
    const next = await ok<{
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    }>(
      await adminRequest(
        app,
        "GET",
        `/public-boards?limit=1&cursor=${page.nextCursor}`,
        admin.cookie,
      ),
    );
    expect(next.items.map((item) => item.projectName)).toEqual(["Changelog"]);
    expect(next.nextCursor).toBeNull();
    const search = await ok<{ items: Array<Record<string, unknown>> }>(
      await adminRequest(
        app,
        "GET",
        "/public-boards?search=change",
        admin.cookie,
      ),
    );
    expect(search.items.map((item) => item.projectName)).toEqual(["Changelog"]);
  });
});
