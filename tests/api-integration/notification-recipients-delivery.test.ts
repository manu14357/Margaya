import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { notifyTaskEvent } from "../../apps/api/src/notification/recipients";
import { subscribeUsers } from "../../apps/api/src/subscription/service";
import { resetTestDatabase } from "./helpers/database";
import { inboxScene, notificationsOf } from "./helpers/inbox";

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => undefined),
}));
vi.mock("@margaya/email", async (original) => ({
  ...(await original<object>()),
  sendNotificationEmail: sendEmail,
}));

beforeEach(async () => {
  await resetTestDatabase();
  sendEmail.mockClear();
});

describe("delivery of watcher notifications", () => {
  async function subscriberWithEmail(ruleActive: boolean) {
    const scene = await inboxScene();
    const target = await scene.task([scene.ada.id]);
    await subscribeUsers(target.id, [scene.cid.id], "manual");
    await db
      .insert(schema.userNotificationPreferenceTable)
      .values({ userId: scene.cid.id, emailEnabled: true });
    await db.insert(schema.userNotificationWorkspaceRuleTable).values({
      userId: scene.cid.id,
      workspaceId: scene.workspace.id,
      isActive: ruleActive,
      emailEnabled: true,
    });
    return { ...scene, target };
  }

  it("emails a subscriber's status change once", async () => {
    const { ada, cid, target } = await subscriberWithEmail(true);
    const rows = await notifyTaskEvent({
      taskId: target.id,
      kind: "statusChanged",
      actorId: ada.id,
      eventData: { oldStatus: "to-do", newStatus: "done" },
    });
    expect(rows.map((row) => row.userId)).toEqual([cid.id]);
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    expect(sendEmail).toHaveBeenCalledWith(
      cid.email,
      "Task status changed",
      expect.objectContaining({
        message: `${target.title} moved from to-do to done.`,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("emails a German subscriber in German, with translated column names", async () => {
    const { ada, cid, target } = await subscriberWithEmail(true);
    await db
      .update(schema.userTable)
      .set({ locale: "de-DE" })
      .where(eq(schema.userTable.id, cid.id));
    await notifyTaskEvent({
      taskId: target.id,
      kind: "statusChanged",
      actorId: ada.id,
      eventData: { oldStatus: "in-progress", newStatus: "in-review" },
    });
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    expect(sendEmail).toHaveBeenCalledWith(
      cid.email,
      "Aufgabenstatus geändert",
      expect.objectContaining({
        title: "Aufgabenstatus geändert",
        message: `Der Status der Aufgabe "${target.title}" wurde von "In Bearbeitung" zu "In Prüfung" geändert`,
        locale: "de-DE",
      }),
    );
  });

  it("delivers nothing under an inactive workspace rule, keeping the in-app row", async () => {
    const { ada, cid, target } = await subscriberWithEmail(false);
    await notifyTaskEvent({
      taskId: target.id,
      kind: "comment",
      actorId: ada.id,
      eventData: { commentPreview: "hello" },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sendEmail).not.toHaveBeenCalled();
    const rows = await notificationsOf(target.id);
    expect(rows.map((row) => row.userId)).toEqual([cid.id]);
    const [stored] = await db
      .select({ workspaceId: schema.notificationTable.workspaceId })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, cid.id));
    expect(stored?.workspaceId).toBeTruthy();
  });

  it("words a watcher's comment and an update neutrally", async () => {
    const { ada, cid, target } = await subscriberWithEmail(true);
    await notifyTaskEvent({
      taskId: target.id,
      kind: "comment",
      actorId: ada.id,
      eventData: { commentPreview: "Ship it" },
    });
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    expect(sendEmail).toHaveBeenLastCalledWith(
      cid.email,
      "Ada commented",
      expect.objectContaining({
        message: `New comment on ${target.title}: Ship it`,
      }),
    );

    await notifyTaskEvent({
      taskId: target.id,
      kind: "updated",
      actorId: ada.id,
      eventData: { field: "priority", oldValue: "low", newValue: "urgent" },
    });
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(2), {
      timeout: 5000,
    });
    expect(sendEmail).toHaveBeenLastCalledWith(
      cid.email,
      "Task updated",
      expect.objectContaining({
        message: `Priority of ${target.title} changed from low to urgent.`,
      }),
    );
  });
});
