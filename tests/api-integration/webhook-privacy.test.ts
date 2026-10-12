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
import { publishEvent } from "../../apps/api/src/events";
import {
  startWebhookDispatcher,
  stopWebhookDispatcher,
} from "../../apps/api/src/webhook/dispatch/dispatcher";
import { settleWebhookEnqueues } from "../../apps/api/src/webhook/dispatch/enqueue";
import { resetTestDatabase } from "./helpers/database";
import {
  deliveryRows,
  dispatch,
  type Receiver,
  startReceiver,
  type WebhookScene,
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
  stopWebhookDispatcher();
  process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
  receiver.reset();
  await resetTestDatabase();
});

afterEach(() => {
  delete process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
});

type Body = {
  event: string;
  data: Record<string, unknown>;
  changes: Record<string, unknown>;
  [key: string]: unknown;
};

async function bodies(webhookId: string): Promise<Body[]> {
  await settleWebhookEnqueues();
  return (await deliveryRows(webhookId)).map(
    (row) => JSON.parse(row.body) as Body,
  );
}

async function insertPage(
  s: WebhookScene,
  values: Partial<typeof schema.pageTable.$inferInsert> = {},
) {
  const [page] = await db
    .insert(schema.pageTable)
    .values({
      workspaceId: s.workspaceId,
      projectId: s.web.project.id,
      title: "Runbook",
      access: "public",
      ownerId: s.ada.id,
      contentMarkdown: "# Secret plans",
      contentText: "Secret plans",
      ...values,
    })
    .returning();
  if (!page) throw new Error("Failed to create page");
  return page;
}

function pagePayload(
  s: WebhookScene,
  page: { id: string; projectId: string | null },
) {
  return {
    pageId: page.id,
    projectId: page.projectId,
    workspaceId: s.workspaceId,
    userId: s.ada.id,
  };
}

describe("pattern matching", () => {
  it("delivers to *, family and exact subscribers only", async () => {
    const s = await webhookScene();
    const all = await s.createWebhook(s.ada, { url: receiver.url("/1") });
    const family = await s.createWebhook(s.ada, {
      url: receiver.url("/2"),
      events: ["task.*"],
    });
    const exact = await s.createWebhook(s.ada, {
      url: receiver.url("/3"),
      events: ["task.priority_changed"],
    });
    const cycles = await s.createWebhook(s.ada, {
      url: receiver.url("/4"),
      events: ["cycle.*"],
    });
    const paused = await s.createWebhook(s.ada, {
      url: receiver.url("/5"),
      isActive: false,
    });
    const task = await s.createTask();
    await publishEvent("task.priority_changed", {
      taskId: task.id,
      projectId: task.projectId,
      userId: s.mia.id,
      oldPriority: "low",
      newPriority: "urgent",
    });
    await settleWebhookEnqueues();
    for (const webhook of [all, family, exact]) {
      const [body] = await bodies(webhook.id);
      expect(body?.event).toBe("task.priority_changed");
      expect(body?.changes).toEqual({
        priority: { old: "low", new: "urgent" },
      });
    }
    expect(await deliveryRows(cycles.id)).toEqual([]);
    expect(await deliveryRows(paused.id)).toEqual([]);
  });

  it("does nothing for other workspaces", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const [foreign] = await db
      .insert(schema.projectTable)
      .values({
        workspaceId: s.outsiderWorkspaceId,
        name: "Elsewhere",
        slug: "else",
      })
      .returning();
    await publishEvent("project.archived", {
      projectId: foreign?.id,
      workspaceId: s.outsiderWorkspaceId,
      userId: s.outsider.id,
    });
    expect(await bodies(webhook.id)).toEqual([]);
  });
});

describe("pages (P1)", () => {
  it("never sends private pages, nor page content", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const secret = await insertPage(s, { access: "private" });
    const shared = await insertPage(s, {
      title: "Handbook",
      contentVersion: 3,
    });

    await publishEvent("page.updated", {
      ...pagePayload(s, secret),
      changed: ["title"],
    });
    await publishEvent("page.updated", {
      ...pagePayload(s, shared),
      changed: ["title"],
    });
    const sent = await bodies(webhook.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      event: "page.updated",
      changes: { title: null },
      data: {
        id: shared.id,
        title: "Handbook",
        access: "public",
        contentVersion: 3,
      },
    });
    expect(sent[0]?.data).not.toHaveProperty("capabilities");
    expect(JSON.stringify(sent[0])).not.toContain("Secret plans");
  });

  it("tells consumers to drop a page that became private, by id only", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const page = await insertPage(s, { access: "private", title: "Hidden" });
    await publishEvent("page.access_changed", {
      ...pagePayload(s, page),
      access: "private",
      affectedPageIds: [page.id],
    });
    const [body] = await bodies(webhook.id);
    expect(body).toMatchObject({
      event: "page.access_changed",
      changes: { access: { old: "public", new: "private" } },
      data: {
        id: page.id,
        projectId: page.projectId,
        access: "private",
        affectedPageIds: [page.id],
      },
    });
    expect(JSON.stringify(body)).not.toContain("Hidden");
  });

  it("filters archived subtrees to public pages and skips private deletions", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const root = await insertPage(s);
    const child = await insertPage(s, { parentId: root.id });
    const hidden = await insertPage(s, {
      parentId: root.id,
      access: "private",
    });
    await publishEvent("page.archived", {
      ...pagePayload(s, root),
      affectedPageIds: [root.id, child.id, hidden.id],
    });
    await publishEvent("page.deleted", {
      ...pagePayload(s, hidden),
      access: "private",
      title: "Hidden",
    });
    await publishEvent("page.deleted", {
      ...pagePayload(s, child),
      access: "public",
      title: "Child",
    });
    const sent = await bodies(webhook.id);
    expect(sent.map((body) => body.event).sort()).toEqual([
      "page.archived",
      "page.deleted",
    ]);
    const archived = sent.find((body) => body.event === "page.archived");
    const deleted = sent.find((body) => body.event === "page.deleted");
    expect(archived?.changes.affectedPageIds).toEqual([root.id, child.id]);
    expect(deleted?.data).toEqual({
      id: child.id,
      projectId: child.projectId,
      title: "Child",
    });
  });

  it("coalesces content updates into the first waiting delivery", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const page = await insertPage(s);
    for (const version of [1, 2, 3]) {
      await db
        .update(schema.pageTable)
        .set({ contentVersion: version })
        .where(eq(schema.pageTable.id, page.id));
      await publishEvent("page.content_updated", {
        ...pagePayload(s, page),
        contentVersion: version,
      });
      await settleWebhookEnqueues();
    }
    const rows = await deliveryRows(webhook.id);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    const body = JSON.parse(row?.body ?? "{}");
    expect(body.id).toBe(row?.id);
    expect(body.data.contentVersion).toBe(3);
    expect(row?.coalesceKey).toBe(`page:${page.id}`);
    const wait =
      (row?.nextAttemptAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0);
    expect(wait).toBeGreaterThanOrEqual(59_000);
    expect(wait).toBeLessThanOrEqual(61_000);

    // Not due yet; due a minute later.
    expect(await dispatch()).toBe(0);
    expect(await dispatch(new Date(Date.now() + 61_000))).toBe(1);
    expect(receiver.received).toHaveLength(1);

    // After an attempt, the next edit starts a new delivery.
    await publishEvent("page.content_updated", {
      ...pagePayload(s, page),
      contentVersion: 4,
    });
    expect(await bodies(webhook.id)).toHaveLength(2);
  });
});

describe("views (P2)", () => {
  async function insertView(s: WebhookScene, access: "private" | "workspace") {
    const [view] = await db
      .insert(schema.savedViewTable)
      .values({
        workspaceId: s.workspaceId,
        projectId: s.web.project.id,
        name: access === "private" ? "Mine" : "Shared",
        access,
        ownerId: s.mia.id,
      })
      .returning();
    if (!view) throw new Error("Failed to create view");
    return view;
  }

  function viewPayload(
    s: WebhookScene,
    view: { id: string; projectId: string | null; access: string },
  ) {
    return {
      viewId: view.id,
      workspaceId: s.workspaceId,
      projectId: view.projectId,
      userId: s.mia.id,
      access: view.access,
    };
  }

  it("sends shared views only, and private turns as ids", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const mine = await insertView(s, "private");
    const shared = await insertView(s, "workspace");

    await publishEvent("view.created", viewPayload(s, mine));
    await publishEvent("view.updated", {
      ...viewPayload(s, mine),
      changes: ["name"],
    });
    await publishEvent("view.deleted", viewPayload(s, mine));
    await publishEvent("view.created", viewPayload(s, shared));
    await publishEvent("view.updated", {
      ...viewPayload(s, { ...shared, access: "private" }),
      changes: ["access"],
    });

    // Delivery order is not guaranteed.
    const sent = await bodies(webhook.id);
    expect(sent.map((body) => body.event).sort()).toEqual([
      "view.created",
      "view.updated",
    ]);
    const created = sent.find((body) => body.event === "view.created");
    const updated = sent.find((body) => body.event === "view.updated");
    expect(created?.data).toMatchObject({
      id: shared.id,
      name: "Shared",
      access: "workspace",
    });
    expect(created?.data).not.toHaveProperty("canEdit");
    expect(updated?.data).toEqual({
      id: shared.id,
      projectId: shared.projectId,
      access: "private",
    });
  });
});

describe("triage (no fan-out until accepted)", () => {
  it("skips tasks waiting in intake, then delivers once they are on the board", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    await db.insert(schema.columnTable).values({
      projectId: s.web.project.id,
      name: "Triage",
      slug: "triage",
      group: "triage",
    });
    const task = await s.createTask({ status: "triage" });
    const event = {
      taskId: task.id,
      projectId: task.projectId,
      userId: s.mia.id,
    };
    await publishEvent("task.title_changed", {
      ...event,
      oldTitle: "a",
      newTitle: "b",
    });
    await publishEvent("comment.created", {
      ...event,
      id: "comment-1",
      content: "looks risky",
    });
    await publishEvent("task.deleted", {
      ...event,
      title: task.title,
      status: "triage",
    });
    await publishEvent("intake.item_created", {
      intakeItemId: "intake-1",
      taskId: task.id,
      projectId: task.projectId,
      workspaceId: s.workspaceId,
      userId: s.mia.id,
    });
    const sent = await bodies(webhook.id);
    expect(sent.map((body) => body.event)).toEqual(["intake.item_created"]);

    await db
      .update(schema.taskTable)
      .set({ status: "to-do" })
      .where(eq(schema.taskTable.id, task.id));
    await publishEvent("task.title_changed", {
      ...event,
      oldTitle: "b",
      newTitle: "c",
    });
    expect((await bodies(webhook.id)).map((body) => body.event)).toEqual([
      "intake.item_created",
      "task.title_changed",
    ]);
  });
});

describe("time tracking (P4)", () => {
  it("sends time entries only while time tracking is on", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const task = await s.createTask();
    const [entry] = await db
      .insert(schema.timeEntryTable)
      .values({
        taskId: task.id,
        userId: s.mia.id,
        startTime: new Date("2026-10-06T08:00:00Z"),
        endTime: new Date("2026-10-06T09:00:00Z"),
        duration: 3600,
      })
      .returning();
    const payload = {
      timeEntryId: entry?.id,
      taskId: task.id,
      userId: s.mia.id,
    };

    await db
      .update(schema.projectTable)
      .set({ timeTrackingEnabled: false })
      .where(eq(schema.projectTable.id, s.web.project.id));
    await publishEvent("time-entry.created", payload);
    expect(await bodies(webhook.id)).toEqual([]);

    await db
      .update(schema.projectTable)
      .set({ timeTrackingEnabled: true })
      .where(eq(schema.projectTable.id, s.web.project.id));
    await publishEvent("time-entry.created", payload);
    const [body] = await bodies(webhook.id);
    expect(body).toMatchObject({
      event: "time_entry.created",
      project: { id: s.web.project.id },
      data: {
        id: entry?.id,
        taskId: task.id,
        taskKey: "WEB-1",
        user: { id: s.mia.id, name: "Mia" },
        durationSeconds: 3600,
      },
    });
  });
});

describe("actors", () => {
  it("has no actor for automation", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    await publishEvent("task.automation_applied", {
      projectId: s.web.project.id,
      workspaceId: s.workspaceId,
      rule: "auto_archive",
      taskIds: ["t1", "t2"],
      count: 2,
    });
    const [body] = await bodies(webhook.id);
    expect(body).toMatchObject({
      event: "task.automation_applied",
      actor: null,
      data: {
        projectId: s.web.project.id,
        rule: "auto_archive",
        taskIds: ["t1", "t2"],
        count: 2,
      },
    });
  });
});

describe("comments (B12 visibility)", () => {
  it("labels public-board feedback and internal discussion", async () => {
    const s = await webhookScene();
    const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
    const task = await s.createTask();
    const [comment] = await db
      .insert(schema.activityTable)
      .values({
        taskId: task.id,
        type: "comment",
        userId: s.vic.id,
        content: "Please add dark mode",
        visibility: "public",
      })
      .returning();
    await publishEvent("comment.created", {
      ...comment,
      projectId: task.projectId,
      visibility: "public",
      origin: "public_board",
    });
    const [body] = await bodies(webhook.id);
    expect(body?.data).toMatchObject({
      id: comment?.id,
      visibility: "public",
      origin: "public_board",
      author: { id: s.vic.id, name: "Vic" },
    });
    expect(JSON.stringify(body)).not.toContain("@example.com");
  });
});
