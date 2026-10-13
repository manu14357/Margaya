import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  eventually,
  expectJson,
  expectStatus,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Workspace webhooks (Settings > Workspace > Webhooks): the event catalog,
// CRUD with a once-shown secret, a signed test delivery to a local sink,
// delivery history, redelivery and secret rotation.

type Webhook = {
  id: string;
  workspaceId: string;
  name: string | null;
  url: string;
  events: string[];
  isActive: boolean;
  secretHint: string;
  secret?: string;
};
type Delivery = {
  id: string;
  webhookId: string;
  event: string;
  status: string;
  responseStatus: number | null;
};

let world: World;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Hooks");
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "a workspace webhook is created, tested, redelivered, rotated and deleted",
  covers(
    "listWebhookEvents",
    "listWebhooks",
    "createWebhook",
    "getWebhook",
    "updateWebhook",
    "testWebhook",
    "listWebhookDeliveries",
    "getWebhookDelivery",
    "redeliverWebhookDelivery",
    "rotateWebhookSecret",
    "deleteWebhook",
  ),
  async ({ webhookSink }) => {
    const owner = world.as("owner");
    const workspaceId = world.workspace.id;

    const catalog = await expectJson<{
      families: { key: string; events: { name: string }[] }[];
    }>(await owner.get("/api/webhook/events"));
    const names = catalog.families.flatMap((family) =>
      family.events.map((event) => event.name),
    );
    expect(names.length).toBeGreaterThan(0);

    const url = `${webhookSink.url}/workspace-hook`;
    const created = await expectJson<Webhook>(
      await owner.post("/api/webhook", {
        data: {
          workspaceId,
          name: uniqueName("Hook"),
          url,
          events: ["task.*"],
        },
      }),
    );
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.isActive).toBe(true);

    // The secret is shown once; reads only carry its hint.
    const read = await expectJson<Webhook>(
      await owner.get(`/api/webhook/${created.id}`),
    );
    expect(read.secret).toBeUndefined();
    expect(JSON.stringify(read)).not.toContain(created.secret ?? "-");
    const listed = await expectJson<Webhook[] | { items: Webhook[] }>(
      await owner.get("/api/webhook", { params: { workspaceId } }),
    );
    const items = Array.isArray(listed) ? listed : listed.items;
    expect(items.map((hook) => hook.id)).toContain(created.id);

    // Members cannot manage webhooks.
    await expectStatus(
      await world.as("member").get("/api/webhook", { params: { workspaceId } }),
      403,
    );

    const updated = await expectJson<Webhook>(
      await owner.patch(`/api/webhook/${created.id}`, {
        data: { events: ["task.*", "comment.*"] },
      }),
    );
    expect(updated.events).toEqual(["comment.*", "task.*"]);

    const since = webhookSink.requests.length;
    const test1 = await expectJson<Delivery>(
      await owner.post(`/api/webhook/${created.id}/test`),
    );
    expect(test1.webhookId).toBe(created.id);
    expect(test1.event).toBe("webhook.ping");
    const received = await webhookSink.waitForRequest((request) =>
      request.path.startsWith("/workspace-hook"),
    );
    expect(webhookSink.requests.length).toBeGreaterThan(since);
    expect(JSON.stringify(received.headers).toLowerCase()).toContain(
      "signature",
    );

    const deliveries = await expectJson<{ items: Delivery[] }>(
      await owner.get(`/api/webhook/${created.id}/deliveries`),
    );
    expect(deliveries.items.map((item) => item.id)).toContain(test1.id);
    const detail = await expectJson<Delivery>(
      await owner.get(`/api/webhook/${created.id}/deliveries/${test1.id}`),
    );
    expect(detail.id).toBe(test1.id);

    // A test ping is never redelivered; a real event is.
    await expectStatus(
      await owner.post(
        `/api/webhook/${created.id}/deliveries/${test1.id}/redeliver`,
      ),
      409,
    );
    const project = await createProject(owner, workspaceId);
    await createTask(owner, project.id);
    const taskDelivery = await eventually(
      async () =>
        (
          await expectJson<{ items: Delivery[] }>(
            await owner.get(`/api/webhook/${created.id}/deliveries`),
          )
        ).items.find(
          (item) => item.event.startsWith("task.") && item.status !== "pending",
        ),
      { timeoutMs: 30_000, what: "a task delivery" },
    );
    const redelivery = await expectJson<Delivery>(
      await owner.post(
        `/api/webhook/${created.id}/deliveries/${taskDelivery.id}/redeliver`,
      ),
    );
    expect(redelivery.id).not.toBe(taskDelivery.id);
    expect(redelivery.event).toBe(taskDelivery.event);

    const rotated = await expectJson<Webhook>(
      await owner.post(`/api/webhook/${created.id}/rotate-secret`, {
        data: { graceHours: 0 },
      }),
    );
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(created.secret);

    await expectJson(await owner.delete(`/api/webhook/${created.id}`));
    await expectStatus(await owner.get(`/api/webhook/${created.id}`), 404);
  },
);
