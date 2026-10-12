import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { publishEvent } from "../../apps/api/src/events";
import {
  claimDueDeliveries,
  startWebhookDispatcher,
  stopWebhookDispatcher,
  sweepWebhookDeliveries,
} from "../../apps/api/src/webhook/dispatch/dispatcher";
import { settleWebhookEnqueues } from "../../apps/api/src/webhook/dispatch/enqueue";
import { webhookHttpLimits } from "../../apps/api/src/webhook/dispatch/http";
import { runWebhookRetention } from "../../apps/api/src/webhook/retention";
import { resetTestDatabase } from "./helpers/database";
import {
  type DeliveryJson,
  deliveryRows,
  dispatch,
  type Receiver,
  startReceiver,
  type WebhookJson,
  type WebhookScene,
  webhookRow,
  webhookScene,
} from "./helpers/webhooks";

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock("@margaya/email", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  sendNotificationEmail: sendEmail,
}));

const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;

let receiver: Receiver;

beforeAll(async () => {
  receiver = await startReceiver();
});

afterAll(async () => {
  await receiver.close();
  startWebhookDispatcher();
});

beforeEach(async () => {
  stopWebhookDispatcher();
  process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
  receiver.reset();
  sendEmail.mockClear();
  await resetTestDatabase();
});

afterEach(() => {
  delete process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
  webhookHttpLimits.timeoutMs = 10_000;
});

/** A webhook on the receiver plus one task-title event queued for it. */
async function queued(s: WebhookScene, events: string[] = ["*"]) {
  const webhook = await s.createWebhook(s.ada, {
    url: receiver.url(),
    events,
  });
  const task = await s.createTask();
  await publishEvent("task.title_changed", {
    taskId: task.id,
    projectId: task.projectId,
    userId: s.mia.id,
    oldTitle: "Old",
    newTitle: task.title,
  });
  await dispatch();
  const [delivery] = await deliveryRows(webhook.id);
  if (!delivery) throw new Error("Nothing queued");
  return { webhook, task, delivery };
}

describe("delivering task.created", () => {
  it("sends one signed request per matching webhook, byte for byte", async () => {
    const s = await webhookScene();
    const all = await s.createWebhook(s.ada, { url: receiver.url("/all") });
    const tasks = await s.createWebhook(s.ada, {
      url: receiver.url("/tasks"),
      events: ["task.*"],
    });
    const exact = await s.createWebhook(s.ada, {
      url: receiver.url("/exact"),
      events: ["task.created"],
    });
    await s.createWebhook(s.ada, {
      url: receiver.url("/cycles"),
      events: ["cycle.*"],
    });

    const created = await s.ok<{ id: string }>(
      s.mia,
      "POST",
      `/task/${s.web.project.id}`,
      {
        title: "Fix login",
        description: "It breaks",
        priority: "high",
        status: "to-do",
        assigneeIds: [s.vic.id],
      },
    );
    expect(await dispatch()).toBe(3);

    const rows = await deliveryRows();
    expect(rows.map((row) => row.webhookId).sort()).toEqual(
      [all.id, tasks.id, exact.id].sort(),
    );
    expect(rows.every((row) => row.status === "succeeded")).toBe(true);
    expect(receiver.received.map((request) => request.path).sort()).toEqual([
      "/all",
      "/exact",
      "/tasks",
    ]);

    const request = receiver.received.find((r) => r.path === "/all");
    const row = rows.find((r) => r.webhookId === all.id);
    if (!request || !row || !all.secret) throw new Error("missing");
    expect(request.body).toBe(row.body);
    expect(request.headers).toMatchObject({
      "content-type": "application/json",
      "user-agent": "Margaya-Webhooks/1",
      "x-margaya-event": "task.created",
      "x-margaya-delivery": row.id,
      "x-margaya-webhook-id": all.id,
      "x-margaya-attempt": "1",
    });
    expect(request.headers.cookie).toBeUndefined();
    expect(request.headers.authorization).toBeUndefined();
    const timestamp = String(request.headers["x-margaya-timestamp"]);
    expect(Math.abs(Number(timestamp) - Date.now() / 1000)).toBeLessThan(60);
    const expected = createHmac("sha256", all.secret)
      .update(`${timestamp}.${request.body}`)
      .digest("hex");
    expect(request.headers["x-margaya-signature-256"]).toBe(`v1=${expected}`);

    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      id: row.id,
      event: "task.created",
      version: 1,
      webhookId: all.id,
      workspace: { id: s.workspaceId },
      project: { id: s.web.project.id, slug: "web" },
      // The creator, never the assignee, and never an email.
      actor: { id: s.mia.id, name: "Mia" },
      changes: null,
      data: {
        id: created.id,
        key: "WEB-1",
        title: "Fix login",
        description: "It breaks",
        status: "to-do",
        statusName: "To Do",
        group: "unstarted",
        priority: "high",
        assigneeIds: [s.vic.id],
        assignees: [{ id: s.vic.id, name: "Vic" }],
        createdById: s.mia.id,
        labels: [],
        moduleIds: [],
        cycleId: null,
        estimate: null,
      },
    });
    expect(body.data.url).toContain(`/task/${created.id}`);
    expect(request.body).not.toContain("@example.com");
    expect(row.summary).toBe("WEB-1 · Fix login");

    const health = await webhookRow(all.id);
    expect(health?.lastSuccessAt).not.toBeNull();
    expect(health?.failureStreak).toBe(0);
  });

  it("truncates a body over 256 KiB to identifiers", async () => {
    const s = await webhookScene();
    await s.createWebhook(s.ada, { url: receiver.url() });
    const task = await s.createTask({ description: "x".repeat(300_000) });
    await publishEvent("task.updated", {
      taskId: task.id,
      projectId: task.projectId,
      userId: s.mia.id,
    });
    await dispatch();
    const body = JSON.parse(receiver.received[0]?.body ?? "{}");
    expect(body.dataTruncated).toBe(true);
    expect(body.data).toEqual({ id: task.id, projectId: task.projectId });
  });
});

describe("retries", () => {
  it("retries a 500 after about a minute, then succeeds", async () => {
    const s = await webhookScene();
    receiver.respond({ status: 500, body: "boom" });
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const task = await s.createTask();
    await publishEvent("task.updated", {
      taskId: task.id,
      projectId: task.projectId,
      userId: s.mia.id,
    });
    await settleWebhookEnqueues();
    const now = new Date();
    await dispatch(now);

    let [row] = await deliveryRows(webhook.id);
    expect(row).toMatchObject({
      status: "pending",
      attemptCount: 1,
      responseStatus: 500,
      responseSnippet: "boom",
      error: null,
    });
    const delay = (row?.nextAttemptAt.getTime() ?? 0) - now.getTime();
    expect(delay).toBeGreaterThanOrEqual(54 * SECOND);
    expect(delay).toBeLessThanOrEqual(66 * SECOND);

    expect(await dispatch(new Date(now.getTime() + 30 * SECOND))).toBe(0);
    expect(await dispatch(new Date(now.getTime() + 70 * SECOND))).toBe(1);
    [row] = await deliveryRows(webhook.id);
    expect(row).toMatchObject({ status: "succeeded", attemptCount: 2 });
    expect(row?.attempts).toHaveLength(2);
    expect(row?.attempts.map((a) => a.responseStatus)).toEqual([500, 200]);
    expect(receiver.received[1]?.headers["x-margaya-attempt"]).toBe("2");
    expect(receiver.received[1]?.body).toBe(receiver.received[0]?.body);
  });

  it("honors Retry-After on 429", async () => {
    const s = await webhookScene();
    receiver.respond({ status: 429, headers: { "Retry-After": "120" } });
    const { webhook, now } = await queuedAt(s);
    const [row] = await deliveryRows(webhook.id);
    expect(row?.status).toBe("pending");
    expect(
      (row?.nextAttemptAt.getTime() ?? 0) - now.getTime(),
    ).toBeGreaterThanOrEqual(120 * SECOND);
  });

  it("gives up at once on a 404 and on redirects", async () => {
    const s = await webhookScene();
    receiver.respond(
      { status: 404 },
      { status: 302, headers: { Location: "http://127.0.0.1:1/x" } },
    );
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const task = await s.createTask();
    for (const title of ["A", "B"]) {
      await publishEvent("task.title_changed", {
        taskId: task.id,
        projectId: task.projectId,
        userId: s.mia.id,
        oldTitle: "x",
        newTitle: title,
      });
      await settle();
      await dispatch();
    }
    const rows = await deliveryRows(webhook.id);
    expect(
      rows.map((row) => [row.status, row.responseStatus, row.error]),
    ).toEqual([
      ["failed", 404, null],
      ["failed", 302, "Redirects are not followed"],
    ]);
    expect(rows.every((row) => row.completedAt !== null)).toBe(true);
    expect(receiver.received).toHaveLength(2);
    const health = await webhookRow(webhook.id);
    expect(health?.failureStreak).toBe(2);
    expect(health?.failingSince).not.toBeNull();
  });

  it("retries a timeout", async () => {
    const s = await webhookScene();
    webhookHttpLimits.timeoutMs = 200;
    receiver.respond({ status: 200, delayMs: 1500 });
    const { webhook } = await queuedAt(s);
    const [row] = await deliveryRows(webhook.id);
    expect(row).toMatchObject({
      status: "pending",
      attemptCount: 1,
      responseStatus: null,
      error: "Timed out after 10 seconds",
    });
  });

  it("fails after the sixth attempt", async () => {
    const s = await webhookScene();
    receiver.respond(...Array.from({ length: 6 }, () => ({ status: 503 })));
    const first = await queuedAt(s);
    const { webhook } = first;
    let now = first.now;
    for (let i = 0; i < 5; i += 1) {
      now = new Date(now.getTime() + 7 * HOUR);
      await dispatch(now);
    }
    const [row] = await deliveryRows(webhook.id);
    expect(row).toMatchObject({
      status: "failed",
      attemptCount: 6,
      maxAttempts: 6,
    });
    expect(row?.attempts).toHaveLength(6);
  });
});

/** Queues one task event and runs its first attempt; returns that time. */
async function queuedAt(s: WebhookScene) {
  const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
  const task = await s.createTask();
  await publishEvent("task.updated", {
    taskId: task.id,
    projectId: task.projectId,
    userId: s.mia.id,
  });
  await settleWebhookEnqueues();
  const now = new Date();
  await dispatch(now);
  return { webhook, task, now };
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe("auto-disable", () => {
  async function failingWebhook(s: WebhookScene, streak: number, since: Date) {
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    await db
      .update(schema.workspaceWebhookTable)
      .set({ failureStreak: streak, failingSince: since })
      .where(eq(schema.workspaceWebhookTable.id, webhook.id));
    return webhook;
  }

  async function failOnce(s: WebhookScene, webhook: WebhookJson) {
    receiver.respond({ status: 404 });
    const task = await s.createTask({
      number: Math.floor(Math.random() * 1e6),
    });
    await publishEvent("task.updated", {
      taskId: task.id,
      projectId: task.projectId,
      userId: s.mia.id,
    });
    await dispatch();
    return webhookRow(webhook.id);
  }

  it("does not disable after 4 failures", async () => {
    const s = await webhookScene();
    const now = new Date();
    const webhook = await failingWebhook(
      s,
      3,
      new Date(now.getTime() - 25 * HOUR),
    );
    const row = await failOnce(s, webhook);
    expect(row).toMatchObject({ isActive: true, failureStreak: 4 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not disable a young streak", async () => {
    const s = await webhookScene();
    const now = new Date();
    const webhook = await failingWebhook(s, 7, new Date(now.getTime() - HOUR));
    const row = await failOnce(s, webhook);
    expect(row).toMatchObject({ isActive: true, failureStreak: 8 });
  });

  it("disables on the 5th failure of a day-old streak", async () => {
    const s = await webhookScene();
    const now = new Date();
    const webhook = await failingWebhook(
      s,
      4,
      new Date(now.getTime() - 25 * HOUR),
    );
    // A later delivery waiting for its turn.
    await db.insert(schema.webhookDeliveryTable).values({
      webhookId: webhook.id,
      workspaceId: s.workspaceId,
      event: "task.updated",
      entityType: "task",
      body: "{}",
      nextAttemptAt: new Date(now.getTime() + HOUR),
    });

    const row = await failOnce(s, webhook);
    expect(row).toMatchObject({
      isActive: false,
      disabledReason: "failures",
      failureStreak: 5,
    });
    const statuses = (await deliveryRows(webhook.id)).map((d) => [
      d.status,
      d.error,
    ]);
    expect(statuses).toContainEqual([
      "cancelled",
      "Webhook disabled after repeated failures",
    ]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [to, subject, data] = sendEmail.mock.calls[0] as unknown as [
      string,
      string,
      { title: string; message: string; actionUrl: string },
    ];
    expect(to).toBe(s.ada.email);
    expect(subject).toBe("A Margaya webhook was disabled");
    expect(data.title).toBe("Webhook disabled");
    expect(data.message).toContain("127.0.0.1");
    expect(data.actionUrl).toContain(`/webhooks/${webhook.id}`);

    const detail = await s.ok<WebhookJson>(
      s.ada,
      "GET",
      `/webhook/${webhook.id}`,
    );
    expect(detail.disabledReason).toBe("failures");

    // Enabling again resets the counters.
    const enabled = await s.ok<WebhookJson>(
      s.ada,
      "PATCH",
      `/webhook/${webhook.id}`,
      { isActive: true },
    );
    expect(enabled.health.failureStreak).toBe(0);
  });

  it("resets the streak on a success", async () => {
    const s = await webhookScene();
    const now = new Date();
    const webhook = await failingWebhook(
      s,
      4,
      new Date(now.getTime() - 25 * HOUR),
    );
    receiver.respond({ status: 200 });
    const task = await s.createTask();
    await publishEvent("task.updated", {
      taskId: task.id,
      projectId: task.projectId,
      userId: s.mia.id,
    });
    await dispatch();
    const row = await webhookRow(webhook.id);
    expect(row).toMatchObject({
      isActive: true,
      failureStreak: 0,
      failingSince: null,
    });
    expect(row?.lastSuccessAt).not.toBeNull();
  });
});

describe("secrets", () => {
  function signatures(request: Receiver["received"][number] | undefined) {
    return String(request?.headers["x-margaya-signature-256"] ?? "").split(",");
  }

  function sign(secret: string, request: Receiver["received"][number]) {
    const timestamp = String(request.headers["x-margaya-timestamp"]);
    return `v1=${createHmac("sha256", secret)
      .update(`${timestamp}.${request.body}`)
      .digest("hex")}`;
  }

  it("signs with both secrets during the grace period only", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const rotated = await s.ok<WebhookJson>(
      s.ada,
      "POST",
      `/webhook/${webhook.id}/rotate-secret`,
      { graceHours: 1 },
    );
    const task = await s.createTask();
    const publish = () =>
      publishEvent("task.updated", {
        taskId: task.id,
        projectId: task.projectId,
        userId: s.mia.id,
      });

    await publish();
    await dispatch();
    const first = receiver.received[0];
    if (!first || !rotated.secret || !webhook.secret) throw new Error("x");
    expect(signatures(first)).toEqual([
      sign(rotated.secret, first),
      sign(webhook.secret, first),
    ]);

    await db
      .update(schema.workspaceWebhookTable)
      .set({ previousSecretExpiresAt: new Date(Date.now() - SECOND) })
      .where(eq(schema.workspaceWebhookTable.id, webhook.id));
    await publish();
    await dispatch();
    const second = receiver.received[1];
    if (!second) throw new Error("x");
    expect(signatures(second)).toEqual([sign(rotated.secret, second)]);

    // Retention clears the expired previous secret.
    await runWebhookRetention();
    expect((await webhookRow(webhook.id))?.previousSecretCiphertext).toBeNull();
  });

  it("fails deliveries for good when AUTH_SECRET changed", async () => {
    const s = await webhookScene();
    const original = process.env.AUTH_SECRET;
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const task = await s.createTask();
    try {
      process.env.AUTH_SECRET = "a-completely-different-secret-of-40-chars!";
      await publishEvent("task.updated", {
        taskId: task.id,
        projectId: task.projectId,
        userId: s.mia.id,
      });
      await dispatch();
      const [row] = await deliveryRows(webhook.id);
      expect(row).toMatchObject({
        status: "failed",
        error: "Signing secret unavailable",
        attemptCount: 1,
      });
      expect(receiver.received).toHaveLength(0);
      const detail = await s.ok<WebhookJson>(
        s.ada,
        "GET",
        `/webhook/${webhook.id}`,
      );
      expect(detail.secretStatus).toBe("unreadable");

      // Rotating recovers.
      const rotated = await s.ok<WebhookJson>(
        s.ada,
        "POST",
        `/webhook/${webhook.id}/rotate-secret`,
        { graceHours: 0 },
      );
      expect(rotated.secretStatus).toBe("ok");
    } finally {
      process.env.AUTH_SECRET = original;
    }
  });
});

describe("redeliver", () => {
  it("queues a linked copy with a new id", async () => {
    const s = await webhookScene();
    const { webhook, delivery } = await queued(s);
    expect(delivery.status).toBe("succeeded");

    const copy = await s.ok<DeliveryJson>(
      s.ada,
      "POST",
      `/webhook/${webhook.id}/deliveries/${delivery.id}/redeliver`,
    );
    expect(copy).toMatchObject({
      status: "pending",
      trigger: "redelivery",
      redeliveryOf: delivery.id,
      event: delivery.event,
      attemptCount: 0,
    });
    expect(copy.id).not.toBe(delivery.id);

    await dispatch();
    const sent = JSON.parse(receiver.received.at(-1)?.body ?? "{}");
    const original = JSON.parse(delivery.body);
    expect(sent.id).toBe(copy.id);
    expect(sent.redelivery).toBe(true);
    expect(sent.data).toEqual(original.data);
    expect(receiver.received.at(-1)?.headers["x-margaya-delivery"]).toBe(
      copy.id,
    );
    // History is untouched.
    const [first] = await deliveryRows(webhook.id);
    expect(first?.body).toBe(delivery.body);
  });

  it("refuses deliveries in progress, tests and inactive webhooks", async () => {
    const s = await webhookScene();
    const { webhook, delivery } = await queued(s);
    const [pending] = await db
      .insert(schema.webhookDeliveryTable)
      .values({
        webhookId: webhook.id,
        workspaceId: s.workspaceId,
        event: "task.updated",
        entityType: "task",
        body: "{}",
        nextAttemptAt: new Date(Date.now() + HOUR),
      })
      .returning();
    const redeliver = (id: string) =>
      s.as(s.ada)("POST", `/webhook/${webhook.id}/deliveries/${id}/redeliver`);

    const inProgress = await redeliver(pending?.id ?? "");
    expect(inProgress.status).toBe(409);
    expect(await inProgress.text()).toBe("This delivery is still in progress");

    const ping = await s.ok<DeliveryJson>(
      s.ada,
      "POST",
      `/webhook/${webhook.id}/test`,
    );
    const pingAgain = await redeliver(ping.id);
    expect(pingAgain.status).toBe(409);
    expect(await pingAgain.text()).toBe("Send a new test instead");

    await s.ok(s.ada, "PATCH", `/webhook/${webhook.id}`, { isActive: false });
    const inactive = await redeliver(delivery.id);
    expect(inactive.status).toBe(409);
    expect(await inactive.text()).toBe(
      "Enable the webhook before redelivering",
    );

    const other = await s.createWebhook(s.ada, { url: receiver.url("/other") });
    const foreign = await s.as(s.ada)(
      "POST",
      `/webhook/${other.id}/deliveries/${delivery.id}/redeliver`,
    );
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe("Delivery not found");
  });
});

describe("send test", () => {
  it("pings synchronously without touching health, even while paused", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, {
      url: receiver.url(),
      isActive: false,
    });
    receiver.respond({ status: 204 });
    const result = await s.ok<DeliveryJson>(
      s.ada,
      "POST",
      `/webhook/${webhook.id}/test`,
    );
    expect(result).toMatchObject({
      event: "webhook.ping",
      trigger: "ping",
      status: "succeeded",
      maxAttempts: 1,
      attemptCount: 1,
      responseStatus: 204,
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.requestHeaders?.["X-Margaya-Signature-256"]).toBe("v1=…");
    expect(result.requestBody).toMatchObject({
      event: "webhook.ping",
      actor: { id: s.ada.id, name: "Ada" },
    });
    expect(receiver.received[0]?.headers["x-margaya-event"]).toBe(
      "webhook.ping",
    );
    const row = await webhookRow(webhook.id);
    expect(row).toMatchObject({
      isActive: false,
      lastSuccessAt: null,
      failureStreak: 0,
    });

    receiver.respond({ status: 500 });
    const failed = await s.ok<DeliveryJson>(
      s.ada,
      "POST",
      `/webhook/${webhook.id}/test`,
    );
    expect(failed).toMatchObject({ status: "failed", responseStatus: 500 });
    expect((await webhookRow(webhook.id))?.failureStreak).toBe(0);
  });
});

describe("the outbox", () => {
  it("gives concurrent claims disjoint rows", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    await db.insert(schema.webhookDeliveryTable).values(
      Array.from({ length: 10 }, () => ({
        webhookId: webhook.id,
        workspaceId: s.workspaceId,
        event: "task.updated",
        entityType: "task" as const,
        body: "{}",
      })),
    );
    const now = new Date(Date.now() + SECOND);
    const [a, b] = await Promise.all([
      claimDueDeliveries(now, 6),
      claimDueDeliveries(now, 6),
    ]);
    const ids = [...a, ...b].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(10);
    expect([...a, ...b].every((row) => row.status === "sending")).toBe(true);
  });

  it("sweeps expired claims back and cancels inactive webhooks' rows", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const paused = await s.createWebhook(s.ada, { url: receiver.url("/p") });
    const now = new Date();
    const [stuck] = await db
      .insert(schema.webhookDeliveryTable)
      .values({
        webhookId: webhook.id,
        workspaceId: s.workspaceId,
        event: "task.updated",
        entityType: "task",
        body: "{}",
        status: "sending",
        attemptCount: 2,
        lockedUntil: new Date(now.getTime() - SECOND),
      })
      .returning();
    await db
      .update(schema.workspaceWebhookTable)
      .set({ isActive: false, disabledReason: "manual" })
      .where(eq(schema.workspaceWebhookTable.id, paused.id));
    await db.insert(schema.webhookDeliveryTable).values({
      webhookId: paused.id,
      workspaceId: s.workspaceId,
      event: "task.updated",
      entityType: "task",
      body: "{}",
    });

    const outcome = await sweepWebhookDeliveries(now);
    expect(outcome).toMatchObject({ requeued: 1, cancelled: 1 });
    const [requeued] = await deliveryRows(webhook.id);
    expect(requeued).toMatchObject({
      id: stuck?.id,
      status: "pending",
      attemptCount: 2,
      lockedUntil: null,
    });
    const [cancelled] = await deliveryRows(paused.id);
    expect(cancelled).toMatchObject({
      status: "cancelled",
      error: "Webhook paused",
    });
  });

  it("deletes deliveries older than the retention period", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const now = new Date();
    await db.insert(schema.webhookDeliveryTable).values([
      {
        webhookId: webhook.id,
        workspaceId: s.workspaceId,
        event: "task.updated",
        entityType: "task",
        body: "{}",
        status: "succeeded",
        createdAt: new Date(now.getTime() - 15 * 24 * HOUR),
      },
      {
        webhookId: webhook.id,
        workspaceId: s.workspaceId,
        event: "task.created",
        entityType: "task",
        body: "{}",
        status: "succeeded",
        createdAt: new Date(now.getTime() - 13 * 24 * HOUR),
      },
    ]);
    const outcome = await runWebhookRetention(now);
    expect(outcome.deleted).toBe(1);
    const left = await deliveryRows(webhook.id);
    expect(left.map((row) => row.event)).toEqual(["task.created"]);
  });
});

describe("the delivery log", () => {
  it("pages newest first, filters, and shows one delivery", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const base = Date.now() - HOUR;
    await db.insert(schema.webhookDeliveryTable).values(
      Array.from({ length: 5 }, (_, i) => ({
        webhookId: webhook.id,
        workspaceId: s.workspaceId,
        event: i % 2 === 0 ? "task.created" : "task.updated",
        entityType: "task" as const,
        body: JSON.stringify({ n: i }),
        status: i === 4 ? ("failed" as const) : ("succeeded" as const),
        createdAt: new Date(base + i * SECOND),
      })),
    );

    type Page = { items: DeliveryJson[]; nextCursor: string | null };
    const first = await s.ok<Page>(
      s.ada,
      "GET",
      `/webhook/${webhook.id}/deliveries?limit=2`,
    );
    expect(first.items).toHaveLength(2);
    expect(first.items[0]?.status).toBe("failed");
    expect(first.nextCursor).not.toBeNull();
    const second = await s.ok<Page>(
      s.ada,
      "GET",
      `/webhook/${webhook.id}/deliveries?limit=2&cursor=${first.nextCursor}`,
    );
    const third = await s.ok<Page>(
      s.ada,
      "GET",
      `/webhook/${webhook.id}/deliveries?limit=2&cursor=${second.nextCursor}`,
    );
    expect(third.items).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
    const seen = [...first.items, ...second.items, ...third.items].map(
      (item) => item.id,
    );
    expect(new Set(seen).size).toBe(5);

    const failed = await s.ok<Page>(
      s.ada,
      "GET",
      `/webhook/${webhook.id}/deliveries?status=failed,cancelled`,
    );
    expect(failed.items).toHaveLength(1);
    const created = await s.ok<Page>(
      s.ada,
      "GET",
      `/webhook/${webhook.id}/deliveries?event=task.created`,
    );
    expect(created.items).toHaveLength(3);

    const bad = await s.as(s.ada)(
      "GET",
      `/webhook/${webhook.id}/deliveries?status=lost`,
    );
    expect(bad.status).toBe(400);
    const badCursor = await s.as(s.ada)(
      "GET",
      `/webhook/${webhook.id}/deliveries?cursor=nope`,
    );
    expect(badCursor.status).toBe(400);

    const id = first.items[0]?.id ?? "";
    const detail = await s.ok<DeliveryJson>(
      s.ada,
      "GET",
      `/webhook/${webhook.id}/deliveries/${id}`,
    );
    expect(detail.requestBody).toEqual({ n: 4 });
    expect(detail.requestHeaders).toMatchObject({
      "X-Margaya-Delivery": id,
      "X-Margaya-Signature-256": "v1=…",
    });
    const other = await s.createWebhook(s.ada, { url: receiver.url("/o") });
    const foreign = await s.as(s.ada)(
      "GET",
      `/webhook/${other.id}/deliveries/${id}`,
    );
    expect(foreign.status).toBe(404);
  });
});
