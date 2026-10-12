import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { openSecret } from "../../apps/api/src/utils/secret-box";
import {
  startWebhookDispatcher,
  stopWebhookDispatcher,
} from "../../apps/api/src/webhook/dispatch/dispatcher";
import { createApiKey } from "./helpers/api-keys";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import {
  deliveryRows,
  type Receiver,
  startReceiver,
  type WebhookJson,
  webhookRow,
  webhookScene,
} from "./helpers/webhooks";

let receiver: Receiver;

beforeAll(async () => {
  receiver = await startReceiver();
});

afterAll(async () => {
  await receiver.close();
  startWebhookDispatcher();
});

beforeEach(async () => {
  // Tests drive the dispatcher explicitly.
  stopWebhookDispatcher();
  process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
  await resetTestDatabase();
});

afterEach(() => {
  delete process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
});

describe("POST /webhook", () => {
  it("returns the secret once; list and get only show a hint", async () => {
    const s = await webhookScene();
    const created = await s.createWebhook(s.ada, {
      name: "  Deploy notifier ",
      url: receiver.url(),
    });
    expect(created).toMatchObject({
      workspaceId: s.workspaceId,
      name: "Deploy notifier",
      url: receiver.url(),
      events: ["*"],
      isActive: true,
      disabledReason: null,
      secretStatus: "ok",
      previousSecretExpiresAt: null,
      health: { failureStreak: 0, lastSuccessAt: null },
      createdBy: { id: s.ada.id, name: "Ada" },
    });
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(created.secretHint).toBe(`whsec_…${created.secret?.slice(-4)}`);

    const stored = await webhookRow(created.id);
    expect(stored?.secretCiphertext.startsWith("sbx:v1:")).toBe(true);
    expect(stored?.secretCiphertext).not.toContain(created.secret);
    expect(openSecret("webhook-secret", stored?.secretCiphertext ?? "")).toBe(
      created.secret,
    );

    const list = await s.ok<WebhookJson[]>(
      s.ada,
      "GET",
      `/webhook?workspaceId=${s.workspaceId}`,
    );
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("secret");
    expect(JSON.stringify(list)).not.toContain(created.secret);

    const one = await s.ok<WebhookJson>(s.ada, "GET", `/webhook/${created.id}`);
    expect(one).not.toHaveProperty("secret");
    expect(one.pendingDeliveries).toBe(0);
    expect(one.secretHint).toBe(created.secretHint);
  });

  it("normalizes the URL and stores sorted, deduplicated events", async () => {
    const s = await webhookScene();
    const created = await s.createWebhook(s.ada, {
      url: `${receiver.origin.toUpperCase().replace("HTTP", "http")}/Hook?Token=A#frag`,
      events: ["task.*", "comment.created", "task.*"],
    });
    expect(created.url).toBe(`${receiver.origin}/Hook?Token=A`);
    expect(created.events).toEqual(["comment.created", "task.*"]);
  });

  it("refuses a duplicate URL and a 21st webhook", async () => {
    const s = await webhookScene();
    await s.createWebhook(s.ada, { url: receiver.url("/a") });
    const duplicate = await s.as(s.ada)("POST", "/webhook", {
      workspaceId: s.workspaceId,
      url: `${receiver.url("/a")}#other`,
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.text()).toBe(
      "A webhook for this URL already exists",
    );

    for (let i = 0; i < 19; i += 1) {
      await s.createWebhook(s.ada, { url: receiver.url(`/n${i}`) });
    }
    const over = await s.as(s.ada)("POST", "/webhook", {
      workspaceId: s.workspaceId,
      url: receiver.url("/too-many"),
    });
    expect(over.status).toBe(409);
    expect(await over.text()).toBe("This workspace already has 20 webhooks");
  });

  it("rejects unknown events, pings, credentials and other schemes", async () => {
    const s = await webhookScene();
    const post = (body: Record<string, unknown>) =>
      s.as(s.ada)("POST", "/webhook", {
        workspaceId: s.workspaceId,
        url: receiver.url(),
        ...body,
      });

    const unknown = await post({ events: ["task.exploded"] });
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).toBe("Unknown event: task.exploded");

    const ping = await post({ events: ["webhook.ping"] });
    expect(ping.status).toBe(400);
    expect(await ping.text()).toBe("Unknown event: webhook.ping");

    expect((await post({ events: [] })).status).toBe(400);

    const credentials = await post({
      url: receiver.url().replace("http://", "http://user:pw@"),
    });
    expect(credentials.status).toBe(400);
    expect(await credentials.text()).toBe("Remove credentials from the URL");

    const scheme = await post({ url: "ftp://example.com/hook" });
    expect(scheme.status).toBe(400);
    expect(await scheme.text()).toBe("Enter a valid http or https URL");

    const tooLong = await post({
      url: `https://example.com/${"a".repeat(2050)}`,
    });
    expect(tooLong.status).toBe(400);
  });

  it("blocks private destinations without echoing the address", async () => {
    delete process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
    const s = await webhookScene();
    for (const url of [
      "http://127.0.0.1/hook",
      "http://localhost/hook",
      "http://10.0.0.1/hook",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/hook",
    ]) {
      const response = await s.as(s.ada)("POST", "/webhook", {
        workspaceId: s.workspaceId,
        url,
      });
      expect(response.status, url).toBe(400);
      const text = await response.text();
      expect(text).toBe(
        "This URL resolves to a private or unreachable address",
      );
      expect(text).not.toMatch(/127\.0\.0\.1|10\.0\.0\.1|169\.254|::1/);
    }
  });

  it("refuses this instance's own API and web hosts", async () => {
    const s = await webhookScene();
    for (const url of [
      "http://localhost:1337/api/hook",
      "http://localhost:5173/x",
    ]) {
      const response = await s.as(s.ada)("POST", "/webhook", {
        workspaceId: s.workspaceId,
        url,
      });
      expect(response.status, url).toBe(400);
      expect(await response.text()).toBe(
        "Webhooks can't point at this Margaya instance",
      );
    }
  });
});

describe("PATCH /webhook/{id}", () => {
  it("pausing cancels pending deliveries; enabling resets health", async () => {
    const s = await webhookScene();
    const created = await s.createWebhook(s.ada, { url: receiver.url() });
    await db.insert(schema.webhookDeliveryTable).values({
      webhookId: created.id,
      workspaceId: s.workspaceId,
      event: "task.created",
      entityType: "task",
      body: "{}",
    });

    const paused = await s.ok<WebhookJson>(
      s.ada,
      "PATCH",
      `/webhook/${created.id}`,
      { isActive: false },
    );
    expect(paused).toMatchObject({ isActive: false, disabledReason: "manual" });
    expect(paused.disabledAt).not.toBeNull();
    const [cancelled] = await deliveryRows(created.id);
    expect(cancelled).toMatchObject({
      status: "cancelled",
      error: "Webhook paused",
    });

    await db
      .update(schema.workspaceWebhookTable)
      .set({ failureStreak: 4, failingSince: new Date() })
      .where(eq(schema.workspaceWebhookTable.id, created.id));
    const enabled = await s.ok<WebhookJson>(
      s.ada,
      "PATCH",
      `/webhook/${created.id}`,
      { isActive: true },
    );
    expect(enabled).toMatchObject({
      isActive: true,
      disabledReason: null,
      disabledAt: null,
      health: { failureStreak: 0, failingSince: null },
    });
    // Cancelled deliveries are not replayed.
    expect((await deliveryRows(created.id))[0]?.status).toBe("cancelled");
  });

  it("updates name, URL and events, and validates them", async () => {
    const s = await webhookScene();
    const created = await s.createWebhook(s.ada, { url: receiver.url("/a") });
    await s.createWebhook(s.ada, { url: receiver.url("/b") });

    const updated = await s.ok<WebhookJson>(
      s.ada,
      "PATCH",
      `/webhook/${created.id}`,
      { name: "", url: receiver.url("/c"), events: ["page.*"] },
    );
    expect(updated).toMatchObject({
      name: null,
      url: receiver.url("/c"),
      events: ["page.*"],
    });

    const taken = await s.as(s.ada)("PATCH", `/webhook/${created.id}`, {
      url: receiver.url("/b"),
    });
    expect(taken.status).toBe(409);
    const empty = await s.as(s.ada)("PATCH", `/webhook/${created.id}`, {});
    expect(empty.status).toBe(400);
    const extra = await s.as(s.ada)("PATCH", `/webhook/${created.id}`, {
      secret: "mine",
    });
    expect(extra.status).toBe(400);
    const self = await s.as(s.ada)("PATCH", `/webhook/${created.id}`, {
      url: "http://localhost:1337/x",
    });
    expect(self.status).toBe(400);
  });
});

describe("POST /webhook/{id}/rotate-secret", () => {
  it("keeps the previous secret for the grace period, or drops it", async () => {
    const s = await webhookScene();
    const created = await s.createWebhook(s.ada, { url: receiver.url() });
    const before = await webhookRow(created.id);

    const rotated = await s.ok<WebhookJson>(
      s.ada,
      "POST",
      `/webhook/${created.id}/rotate-secret`,
      { graceHours: 1 },
    );
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.secretRotatedAt).not.toBeNull();
    const expires = Date.parse(rotated.previousSecretExpiresAt ?? "");
    expect(expires - Date.now()).toBeGreaterThan(59 * 60 * 1000);
    expect(expires - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);
    const after = await webhookRow(created.id);
    expect(after?.previousSecretCiphertext).toBe(before?.secretCiphertext);

    const again = await s.ok<WebhookJson>(
      s.ada,
      "POST",
      `/webhook/${created.id}/rotate-secret`,
      { graceHours: 0 },
    );
    expect(again.previousSecretExpiresAt).toBeNull();
    expect((await webhookRow(created.id))?.previousSecretCiphertext).toBeNull();

    const defaulted = await s.ok<WebhookJson>(
      s.ada,
      "POST",
      `/webhook/${created.id}/rotate-secret`,
    );
    const hours =
      (Date.parse(defaulted.previousSecretExpiresAt ?? "") - Date.now()) /
      3_600_000;
    expect(hours).toBeGreaterThan(23.9);

    const invalid = await s.as(s.ada)(
      "POST",
      `/webhook/${created.id}/rotate-secret`,
      { graceHours: 73 },
    );
    expect(invalid.status).toBe(400);
  });
});

describe("DELETE /webhook/{id}", () => {
  it("deletes the webhook with its log", async () => {
    const s = await webhookScene();
    const created = await s.createWebhook(s.ada, { url: receiver.url() });
    await db.insert(schema.webhookDeliveryTable).values({
      webhookId: created.id,
      workspaceId: s.workspaceId,
      event: "task.created",
      entityType: "task",
      body: "{}",
    });
    const deleted = await s.ok<{ id: string }>(
      s.ada,
      "DELETE",
      `/webhook/${created.id}`,
    );
    expect(deleted).toEqual({ id: created.id });
    expect(await webhookRow(created.id)).toBeNull();
    expect(await deliveryRows(created.id)).toEqual([]);
    const missing = await s.as(s.ada)("GET", `/webhook/${created.id}`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Webhook not found");
  });
});

describe("GET /webhook/events", () => {
  it("lists the catalog for any signed-in user", async () => {
    const s = await webhookScene();
    const catalog = await s.ok<{
      families: { key: string; events: { name: string; entity: string }[] }[];
    }>(s.vic, "GET", "/webhook/events");
    expect(catalog.families.map((family) => family.key)).toContain("task");
    const names = catalog.families.flatMap((family) =>
      family.events.map((event) => event.name),
    );
    expect(names).toContain("task.status_changed");
    expect(names).toContain("page.content_updated");
    expect(names).not.toContain("webhook.ping");
    expect(names).not.toContain("export.status_changed");
  });
});

describe("permissions", () => {
  it("needs workspace:manage_settings", async () => {
    const s = await webhookScene();
    const created = await s.createWebhook(s.owner, { url: receiver.url() });
    for (const user of [s.mia, s.vic]) {
      const list = await s.as(user)(
        "GET",
        `/webhook?workspaceId=${s.workspaceId}`,
      );
      expect(list.status).toBe(403);
      const create = await s.as(user)("POST", "/webhook", {
        workspaceId: s.workspaceId,
        url: receiver.url("/x"),
      });
      expect(create.status).toBe(403);
      for (const [method, path] of [
        ["GET", `/webhook/${created.id}`],
        ["PATCH", `/webhook/${created.id}`],
        ["DELETE", `/webhook/${created.id}`],
        ["POST", `/webhook/${created.id}/test`],
        ["POST", `/webhook/${created.id}/rotate-secret`],
        ["GET", `/webhook/${created.id}/deliveries`],
      ] as const) {
        const response = await s.as(user)(
          method,
          path,
          method === "PATCH" ? { name: "x" } : undefined,
        );
        expect(response.status, `${method} ${path}`).toBe(403);
      }
    }
    for (const user of [s.ada, s.owner]) {
      const list = await s.as(user)(
        "GET",
        `/webhook?workspaceId=${s.workspaceId}`,
      );
      expect(list.status).toBe(200);
    }
  });

  it("keeps other workspaces' admins out", async () => {
    const s = await webhookScene();
    const created = await s.createWebhook(s.ada, { url: receiver.url() });
    const stranger = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(stranger.user);
    const get = await s.app.request(`/api/webhook/${created.id}`);
    expect([403, 404]).toContain(get.status);
    const list = await s.as(stranger.user)(
      "GET",
      `/webhook?workspaceId=${s.workspaceId}`,
    );
    expect(list.status).toBe(403);
  });

  it("applies an API key's stored scope", async () => {
    const s = await webhookScene();
    const narrow = await createApiKey(s.ada, { task: ["read"] });
    const denied = await s.app.request(
      `/api/webhook?workspaceId=${s.workspaceId}`,
      { headers: narrow.headers },
    );
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe("Insufficient API key scope");

    const wide = await createApiKey(s.ada, { workspace: ["manage_settings"] });
    const allowed = await s.app.request(
      `/api/webhook?workspaceId=${s.workspaceId}`,
      { headers: wide.headers },
    );
    expect(allowed.status).toBe(200);
  });
});

describe("entitlement", () => {
  const CLOUD_ENV = {
    MARGAYA_CLOUD: "true",
    CREEM_API_KEY: "creem_test_dummy",
    CREEM_WEBHOOK_SECRET: "whsec_dummy",
  };
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of Object.keys(CLOUD_ENV)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("blocks create without an entitlement; delete still works", async () => {
    const s = await webhookScene();
    const created = await s.createWebhook(s.ada, { url: receiver.url() });
    for (const [key, value] of Object.entries(CLOUD_ENV)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    await db.insert(schema.workspaceBillingTable).values({
      workspaceId: s.workspaceId,
      foundingFree: false,
      trialEndsAt: new Date(Date.now() - 60_000),
    });

    const blocked = await s.as(s.ada)("POST", "/webhook", {
      workspaceId: s.workspaceId,
      url: receiver.url("/other"),
    });
    expect(blocked.status).toBe(402);
    const deleted = await s.as(s.ada)("DELETE", `/webhook/${created.id}`);
    expect(deleted.status).toBe(200);
  });
});
