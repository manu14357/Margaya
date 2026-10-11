import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
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
import { auditWriter } from "../../apps/api/src/audit-log/record";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  startExportRunner,
  stopExportRunner,
} from "../../apps/api/src/task-export/runner";
import {
  startWebhookDispatcher,
  stopWebhookDispatcher,
} from "../../apps/api/src/webhook/dispatch/dispatcher";
import { createApiKey } from "./helpers/api-keys";
import { auditEntry, auditRows } from "./helpers/audit-log";
import { resetTestDatabase } from "./helpers/database";
import { exportScene } from "./helpers/task-exports";
import {
  type Receiver,
  startReceiver,
  type WebhookJson,
  webhookScene,
} from "./helpers/webhooks";

let receiver: Receiver;

beforeAll(async () => {
  receiver = await startReceiver();
});

afterAll(async () => {
  await receiver.close();
  startWebhookDispatcher();
  startExportRunner();
});

beforeEach(async () => {
  stopWebhookDispatcher();
  stopExportRunner();
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
  await resetTestDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
});

describe("audit log: webhooks", () => {
  it("records create, update, secret rotation and delete without the secret", async () => {
    const s = await webhookScene();
    const created = await s.createWebhook(s.ada, {
      name: "Deploys",
      url: receiver.url("/hook?token=abc123"),
      events: ["task.*"],
    });
    expect(created.secret).toBeTruthy();

    expect(await auditEntry(s.workspaceId, "webhook.created")).toMatchObject({
      actorType: "user",
      actorUserId: s.ada.id,
      actorName: "Ada",
      targetType: "webhook",
      targetId: created.id,
      targetLabel: "Deploys",
      metadata: { events: ["task.*"] },
    });

    await s.ok(s.ada, "PATCH", `/webhook/${created.id}`, {
      name: "Deploy events",
    });
    expect(await auditEntry(s.workspaceId, "webhook.updated")).toMatchObject({
      metadata: {
        changes: { name: { before: "Deploys", after: "Deploy events" } },
      },
    });

    const rotated = await s.ok<WebhookJson>(
      s.owner,
      "POST",
      `/webhook/${created.id}/rotate-secret`,
      { graceHours: 2 },
    );
    expect(rotated.secret).toBeTruthy();
    expect(
      await auditEntry(s.workspaceId, "webhook.secret_rotated"),
    ).toMatchObject({
      actorUserId: s.owner.id,
      targetId: created.id,
      metadata: { graceHours: 2 },
    });

    await s.ok(s.ada, "DELETE", `/webhook/${created.id}`);
    expect(await auditEntry(s.workspaceId, "webhook.deleted")).toMatchObject({
      targetId: created.id,
      targetLabel: "Deploy events",
    });

    const stored = JSON.stringify(await auditRows(s.workspaceId));
    for (const secret of [created.secret, rotated.secret]) {
      expect(stored).not.toContain(secret as string);
    }
    // The endpoint's path and query (a token here) are not kept either.
    expect(stored).not.toContain("abc123");
  });

  it("names the API key when one made the change", async () => {
    const s = await webhookScene();
    const key = await createApiKey(s.owner);
    const response = await s.app.request("/api/webhook", {
      method: "POST",
      headers: { ...key.headers, "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: s.workspaceId,
        url: receiver.url("/keyed"),
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await auditEntry(s.workspaceId, "webhook.created")).toMatchObject({
      actorType: "api_key",
      actorUserId: s.owner.id,
      apiKeyId: key.id,
      actorName: "test key",
    });
  });

  it("records the client IP and user agent", async () => {
    const s = await webhookScene();
    const key = await createApiKey(s.ada);
    const { app } = createApp();
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
    await once(server, "listening");
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/webhook`, {
        method: "POST",
        headers: {
          ...key.headers,
          "content-type": "application/json",
          "user-agent": "AuditProbe/2.0",
          // The loopback peer is a trusted proxy by default.
          "x-forwarded-for": "203.0.113.7",
        },
        body: JSON.stringify({
          workspaceId: s.workspaceId,
          url: receiver.url("/ip"),
        }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await auditEntry(s.workspaceId, "webhook.created")).toMatchObject({
      ipAddress: "203.0.113.7",
      userAgent: "AuditProbe/2.0",
    });
  });

  it("never fails the action when the audit write fails", async () => {
    const s = await webhookScene();
    const spy = vi
      .spyOn(auditWriter, "insert")
      .mockRejectedValue(new Error("audit store down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const created = await s.createWebhook(s.ada, { url: receiver.url() });
    expect(created.id).toBeTruthy();
    expect(spy).toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
    spy.mockRestore();
    expect(await auditRows(s.workspaceId)).toHaveLength(0);
  });
});

describe("audit log: integrations", () => {
  it("records connect, update and disconnect with a redacted diff", async () => {
    const s = await webhookScene();
    const projectId = s.web.project.id;
    const hook = "https://hooks.slack.com/services/T000/B000/SecretPart1";
    await s.ok(s.owner, "POST", `/slack-integration/project/${projectId}`, {
      webhookUrl: hook,
      channelName: "#ops",
    });
    await s.ok(s.owner, "PATCH", `/slack-integration/project/${projectId}`, {
      channelName: "#deploys",
      webhookUrl: "https://hooks.slack.com/services/T000/B000/SecretPart2",
    });
    await s.ok(s.owner, "DELETE", `/slack-integration/project/${projectId}`);

    const connected = await auditEntry(s.workspaceId, "integration.connected");
    expect(connected).toMatchObject({
      actorUserId: s.owner.id,
      targetType: "integration",
      targetLabel: s.web.project.name,
      metadata: { provider: "slack", projectId },
    });
    const updated = await auditEntry(s.workspaceId, "integration.updated");
    expect(updated.metadata).toMatchObject({
      changes: {
        channelName: { before: "#ops", after: "#deploys" },
        // A secret field only says that it changed.
        webhookUrl: "[redacted]",
      },
    });
    expect(
      await auditEntry(s.workspaceId, "integration.disconnected"),
    ).toMatchObject({ targetId: connected.targetId });

    const stored = JSON.stringify(await auditRows(s.workspaceId));
    expect(stored).not.toContain("SecretPart");
  });
});

describe("audit log: workspace settings", () => {
  it("records a time zone change as a before/after diff", async () => {
    const s = await webhookScene();
    await s.ok(s.owner, "PATCH", `/workspace/${s.workspaceId}/settings`, {
      timezone: "Europe/Berlin",
    });
    expect(await auditEntry(s.workspaceId, "workspace.updated")).toMatchObject({
      actorUserId: s.owner.id,
      targetType: "workspace",
      metadata: {
        changes: { timezone: { before: "UTC", after: "Europe/Berlin" } },
      },
    });
  });
});

describe("audit log: projects and public boards (events)", () => {
  it("records the project lifecycle and settings, not routine task edits", async () => {
    const s = await webhookScene();
    const project = await s.ok<{ id: string }>(s.ada, "POST", "/project", {
      name: "Launch",
      workspaceId: s.workspaceId,
      icon: "Rocket",
      slug: "LCH",
    });
    await s.ok(s.ada, "PATCH", `/project/${project.id}/features`, {
      cyclesEnabled: false,
    });
    await s.ok(s.ada, "PUT", `/project/${project.id}/archive`);
    await s.ok(s.ada, "PUT", `/project/${project.id}/unarchive`);
    await s.ok(s.ada, "POST", `/publication/project/${project.id}/publish`, {});
    await s.ok(s.ada, "POST", `/publication/project/${project.id}/rotate-link`);
    await s.ok(s.ada, "POST", `/publication/project/${project.id}/unpublish`);
    await s.ok(s.ada, "DELETE", `/project/${project.id}`);
    await s.ok(s.ada, "POST", `/trash/projects/${project.id}/restore`);

    const task = await s.createTask({ projectId: project.id });
    await s.ok(s.ada, "PUT", `/task/title/${task.id}`, { title: "Renamed" });

    const actions = (await auditRows(s.workspaceId)).map((row) => row.action);
    for (const action of [
      "project.created",
      "project.feature_toggled",
      "project.archived",
      "project.unarchived",
      "public_board.published",
      "public_board.link_rotated",
      "public_board.unpublished",
      "project.trashed",
      "project.restored",
    ]) {
      expect(actions, action).toContain(action);
    }
    expect(actions.some((action) => action.startsWith("task."))).toBe(false);

    expect(
      await auditEntry(s.workspaceId, "project.feature_toggled"),
    ).toMatchObject({
      actorUserId: s.ada.id,
      targetId: project.id,
      targetLabel: "Launch",
      metadata: { enabled: [], disabled: ["cycles"] },
    });
  });

  it("records a permanent purge and an emptied trash as one entry each", async () => {
    const s = await webhookScene();
    const projectId = s.web.project.id;
    const one = await s.createTask({ title: "One", number: 1 });
    const two = await s.createTask({ title: "Two", number: 2 });
    const three = await s.createTask({ title: "Three", number: 3 });
    for (const task of [one, two, three]) {
      await s.ok(s.owner, "DELETE", `/task/${task.id}`);
    }
    await s.ok(s.owner, "DELETE", `/trash/task/${one.id}`);
    await s.ok(s.owner, "POST", `/trash/project/${projectId}/empty`);

    expect(await auditEntry(s.workspaceId, "trash.purged")).toMatchObject({
      actorUserId: s.owner.id,
      targetId: projectId,
      metadata: { count: 1, tasks: ["One"] },
    });
    const emptied = await auditEntry(s.workspaceId, "trash.emptied");
    expect(emptied.metadata).toMatchObject({ count: 2 });
  });
});

describe("audit log: exports and imports", () => {
  it("records an export created and downloaded", async () => {
    const s = await exportScene();
    await s.createTask();
    const row = await s.runExport(s.owner, { format: "csv" });
    await s.download(s.owner, row.id);
    expect(await auditEntry(s.workspaceId, "export.created")).toMatchObject({
      actorUserId: s.owner.id,
      targetType: "export",
      targetId: row.id,
      metadata: { format: "csv" },
    });
    expect(await auditEntry(s.workspaceId, "export.downloaded")).toMatchObject({
      actorUserId: s.owner.id,
      targetId: row.id,
    });
  });

  it("records a task import with its counts", async () => {
    const s = await webhookScene();
    await s.ok(s.ada, "POST", `/task/import/${s.web.project.id}`, {
      tasks: [
        { title: "Imported one", status: "to-do" },
        { title: "Imported two", status: "to-do" },
      ],
    });
    expect(await auditEntry(s.workspaceId, "import.run")).toMatchObject({
      actorUserId: s.ada.id,
      targetId: s.web.project.id,
      metadata: { source: "file", total: 2, successful: 2, failed: 0 },
    });
    const [project] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, s.web.project.id));
    expect(project).toBeTruthy();
  });
});
