import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { notificationEmailQueueTable } from "../../apps/api/src/database/schema";
import { notifyTaskEvent } from "../../apps/api/src/notification/recipients";
import { flushNotificationEmails } from "../../apps/api/src/notification-email/flush";
import { subscribeUsers } from "../../apps/api/src/subscription/service";
import { resetTestDatabase } from "./helpers/database";
import { inboxScene } from "./helpers/inbox";

const { sendEmail, sendBatch } = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ success: true })),
  sendBatch: vi.fn(async () => ({ success: true })),
}));
vi.mock("@margaya/email", async (original) => ({
  ...(await original<object>()),
  sendNotificationEmail: sendEmail,
  sendNotificationBatchEmail: sendBatch,
}));

const WINDOW = "300";
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);

beforeEach(async () => {
  await resetTestDatabase();
  sendEmail.mockClear();
  sendBatch.mockClear();
  process.env.EMAIL_NOTIFICATION_BATCH_WINDOW_SECONDS = WINDOW;
});

afterEach(() => {
  process.env.EMAIL_NOTIFICATION_BATCH_WINDOW_SECONDS = "0";
});

async function queuedRows() {
  return db.select().from(notificationEmailQueueTable);
}

async function waitForQueued(count: number) {
  await vi.waitFor(async () => expect(await queuedRows()).toHaveLength(count), {
    timeout: 5000,
    interval: 25,
  });
}

/** Cid watches a task Ada works on, with email on globally and for the workspace. */
async function watcherScene() {
  const scene = await inboxScene();
  const target = await scene.task([scene.ada.id]);
  await subscribeUsers(target.id, [scene.cid.id], "manual");
  await db
    .insert(schema.userNotificationPreferenceTable)
    .values({ userId: scene.cid.id, emailEnabled: true });
  await db.insert(schema.userNotificationWorkspaceRuleTable).values({
    userId: scene.cid.id,
    workspaceId: scene.workspace.id,
    isActive: true,
    emailEnabled: true,
  });
  return { ...scene, target };
}

async function threeChanges(scene: Awaited<ReturnType<typeof watcherScene>>) {
  await notifyTaskEvent({
    taskId: scene.target.id,
    kind: "statusChanged",
    actorId: scene.ada.id,
    eventData: { oldStatus: "to-do", newStatus: "in-progress" },
  });
  await notifyTaskEvent({
    taskId: scene.target.id,
    kind: "comment",
    actorId: scene.ada.id,
    eventData: { commentPreview: "Ship it" },
  });
  await notifyTaskEvent({
    taskId: scene.target.id,
    kind: "updated",
    actorId: scene.ada.id,
    eventData: { field: "priority", oldValue: "low", newValue: "urgent" },
  });
  await waitForQueued(3);
}

describe("batched notification emails", () => {
  it("coalesces several notifications into one email after the window", async () => {
    const scene = await watcherScene();
    await threeChanges(scene);
    expect(sendEmail).not.toHaveBeenCalled();

    // Still inside the window: nothing goes out.
    expect((await flushNotificationEmails(later(60))).emails).toBe(0);
    expect(sendBatch).not.toHaveBeenCalled();

    expect((await flushNotificationEmails(later(301))).emails).toBe(1);
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendBatch).toHaveBeenCalledWith(
      scene.cid.email,
      `3 updates on ${scene.target.title}`,
      expect.objectContaining({
        groups: [
          expect.objectContaining({
            id: scene.target.id,
            title: scene.target.title,
            changes: [
              expect.objectContaining({
                detail: `${scene.target.title} moved from to-do to in-progress.`,
                actorName: "Ada",
              }),
              expect.objectContaining({
                detail: `New comment on ${scene.target.title}: Ship it`,
              }),
              expect.objectContaining({
                detail: `Priority of ${scene.target.title} changed from low to urgent.`,
              }),
            ],
          }),
        ],
        settingsUrl: expect.stringContaining(
          "/dashboard/settings/account/notifications",
        ),
      }),
    );
    expect(await queuedRows()).toHaveLength(0);

    // Idempotent: a second run has nothing left to send.
    await flushNotificationEmails(later(400));
    expect(sendBatch).toHaveBeenCalledTimes(1);
  });

  it("words a batch in a German recipient's language", async () => {
    const scene = await watcherScene();
    await db
      .update(schema.userTable)
      .set({ locale: "de-DE" })
      .where(eq(schema.userTable.id, scene.cid.id));
    await threeChanges(scene);

    await flushNotificationEmails(later(301));
    expect(sendBatch).toHaveBeenCalledWith(
      scene.cid.email,
      `3 Aktualisierungen zu ${scene.target.title}`,
      expect.objectContaining({
        locale: "de-DE",
        groups: [
          expect.objectContaining({
            changes: [
              expect.objectContaining({
                summary: "Aufgabenstatus geändert",
                detail: `Der Status der Aufgabe "${scene.target.title}" wurde von "Zu erledigen" zu "In Bearbeitung" geändert`,
              }),
              expect.objectContaining({
                summary: "Ada hat deine Aufgabe kommentiert",
                detail: `Neuer Kommentar zu „${scene.target.title}“: Ship it`,
              }),
              expect.objectContaining({
                summary: "Aufgabe aktualisiert",
                detail: `Priorität von „${scene.target.title}“ von Niedrig auf Dringend geändert`,
              }),
            ],
          }),
        ],
      }),
    );
  });

  it("words a single queued email in a Russian recipient's language", async () => {
    const scene = await watcherScene();
    await db
      .update(schema.userTable)
      .set({ locale: "ru-RU" })
      .where(eq(schema.userTable.id, scene.cid.id));
    await notifyTaskEvent({
      taskId: scene.target.id,
      kind: "statusChanged",
      actorId: scene.ada.id,
      eventData: { oldStatus: "to-do", newStatus: "done" },
    });
    await waitForQueued(1);

    await flushNotificationEmails(later(301));
    expect(sendBatch).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(
      scene.cid.email,
      "Статус задачи изменён",
      expect.objectContaining({
        title: "Статус задачи изменён",
        message: `Статус задачи «${scene.target.title}» изменён с «К выполнению» на «Готово»`,
        locale: "ru-RU",
      }),
    );
  });

  it("leaves rows claimed by another sender alone", async () => {
    const scene = await watcherScene();
    await threeChanges(scene);
    await db.update(notificationEmailQueueTable).set({ claimedAt: new Date() });
    await flushNotificationEmails(later(301));
    expect(sendBatch).not.toHaveBeenCalled();
    expect(await queuedRows()).toHaveLength(3);
  });

  it("sends immediately with a window of 0", async () => {
    process.env.EMAIL_NOTIFICATION_BATCH_WINDOW_SECONDS = "0";
    const scene = await watcherScene();
    await notifyTaskEvent({
      taskId: scene.target.id,
      kind: "statusChanged",
      actorId: scene.ada.id,
      eventData: { oldStatus: "to-do", newStatus: "done" },
    });
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    expect(await queuedRows()).toHaveLength(0);
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it("drops a type the user muted before the flush", async () => {
    const scene = await watcherScene();
    await threeChanges(scene);
    await db
      .update(schema.userNotificationPreferenceTable)
      .set({ taskCommentEnabled: false, taskUpdateEnabled: false })
      .where(eq(schema.userNotificationPreferenceTable.userId, scene.cid.id));

    await flushNotificationEmails(later(301));
    // One change left: it goes out as an ordinary single email.
    expect(sendBatch).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      scene.cid.email,
      "Task status changed",
      expect.objectContaining({
        message: `${scene.target.title} moved from to-do to in-progress.`,
      }),
    );
    expect(await queuedRows()).toHaveLength(0);
  });

  it("drops changes on a task the user unsubscribed from", async () => {
    const scene = await watcherScene();
    await threeChanges(scene);
    await db
      .update(schema.taskSubscriberTable)
      .set({ subscribed: false })
      .where(
        and(
          eq(schema.taskSubscriberTable.taskId, scene.target.id),
          eq(schema.taskSubscriberTable.userId, scene.cid.id),
        ),
      );
    await flushNotificationEmails(later(301));
    expect(sendBatch).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await queuedRows()).toHaveLength(0);
  });

  it("sends nothing once email is turned off", async () => {
    const scene = await watcherScene();
    await threeChanges(scene);
    await db
      .update(schema.userNotificationPreferenceTable)
      .set({ emailEnabled: false })
      .where(eq(schema.userNotificationPreferenceTable.userId, scene.cid.id));
    await flushNotificationEmails(later(301));
    expect(sendBatch).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await queuedRows()).toHaveLength(0);
  });

  it("sends nothing when access was revoked before the flush", async () => {
    const scene = await watcherScene();
    await threeChanges(scene);
    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, scene.workspace.id),
          eq(schema.workspaceUserTable.userId, scene.cid.id),
        ),
      );
    await flushNotificationEmails(later(301));
    expect(sendBatch).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await queuedRows()).toHaveLength(0);
  });

  it("sends nothing for a task archived before the flush", async () => {
    const scene = await watcherScene();
    await threeChanges(scene);
    await db
      .update(schema.taskTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.taskTable.id, scene.target.id));
    await flushNotificationEmails(later(301));
    expect(sendBatch).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await queuedRows()).toHaveLength(0);
  });

  it("sends nothing for a task trashed before the flush", async () => {
    const scene = await watcherScene();
    await threeChanges(scene);
    await db
      .update(schema.taskTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.taskTable.id, scene.target.id));
    await flushNotificationEmails(later(301));
    expect(sendBatch).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await queuedRows()).toHaveLength(0);
  });

  it("sends nothing for a task whose project was trashed before the flush", async () => {
    const scene = await watcherScene();
    await threeChanges(scene);
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, scene.project.id));
    await flushNotificationEmails(later(301));
    expect(sendBatch).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await queuedRows()).toHaveLength(0);
  });

  it("keeps other channels immediate", async () => {
    const scene = await watcherScene();
    await threeChanges(scene);
    // Every in-app row exists right away; only the email waits.
    const rows = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, scene.cid.id));
    expect(rows).toHaveLength(3);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
