import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "../../apps/api/src/database";
import * as schema from "../../apps/api/src/database/schema";
import { notifyTaskEvent } from "../../apps/api/src/notification/recipients";
import { releaseHeldDeliveries } from "../../apps/api/src/notification-preferences/quiet-release";
import { subscribeUsers } from "../../apps/api/src/subscription/service";
import { resetTestDatabase } from "./helpers/database";
import { inboxScene, notificationsOf } from "./helpers/inbox";

// Quiet hours and focus mode hold outbound channels: the inbox row is
// written, the email waits in notification_delivery_hold, and the release
// job queues it for one batched email once quiet time ends.

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

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function focusedSubscriber(preferences: Record<string, unknown>) {
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
  await db
    .update(schema.userTable)
    .set({ preferences })
    .where(eq(schema.userTable.id, scene.cid.id));
  return { ...scene, target };
}

const holdsOf = (userId: string) =>
  db
    .select()
    .from(schema.notificationDeliveryHoldTable)
    .where(eq(schema.notificationDeliveryHoldTable.userId, userId));

describe("quiet time", () => {
  it("holds email during focus and queues it once focus ends", async () => {
    const { ada, cid, target } = await focusedSubscriber({
      focusUntil: inAnHour(),
    });
    await notifyTaskEvent({
      taskId: target.id,
      kind: "statusChanged",
      actorId: ada.id,
      eventData: { oldStatus: "to-do", newStatus: "done" },
    });
    expect((await notificationsOf(target.id)).map((row) => row.userId)).toEqual(
      [cid.id],
    );
    await vi.waitFor(
      async () => expect(await holdsOf(cid.id)).toHaveLength(1),
      {
        timeout: 5000,
      },
    );
    const [held] = await holdsOf(cid.id);
    expect(held?.channels).toEqual(
      expect.arrayContaining(["email", "desktop"]),
    );
    expect(sendEmail).not.toHaveBeenCalled();

    // Still focusing: nothing is released.
    expect((await releaseHeldDeliveries()).released).toBe(0);

    await db
      .update(schema.userTable)
      .set({ preferences: { focusUntil: null } })
      .where(eq(schema.userTable.id, cid.id));
    expect((await releaseHeldDeliveries()).released).toBe(1);
    expect(await holdsOf(cid.id)).toHaveLength(0);
    const queued = await db
      .select()
      .from(schema.notificationEmailQueueTable)
      .where(eq(schema.notificationEmailQueueTable.userId, cid.id));
    expect(queued.map((row) => row.notificationId)).toEqual([
      held?.notificationId,
    ]);
  });

  it("lets a bypassed mention through and holds only the chosen channels", async () => {
    const { ada, cid, target } = await focusedSubscriber({
      focusUntil: inAnHour(),
      quietDelivery: { channels: ["push", "email"], bypass: ["mentions"] },
    });
    await notifyTaskEvent({
      taskId: target.id,
      kind: "mention",
      actorId: ada.id,
      mentionedIds: [cid.id],
    });
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    expect(await holdsOf(cid.id)).toHaveLength(0);

    await notifyTaskEvent({
      taskId: target.id,
      kind: "statusChanged",
      actorId: ada.id,
      eventData: { oldStatus: "to-do", newStatus: "done" },
    });
    await vi.waitFor(
      async () => expect(await holdsOf(cid.id)).toHaveLength(1),
      {
        timeout: 5000,
      },
    );
    const [held] = await holdsOf(cid.id);
    // Only the chosen channels are held; desktop is not among them. Push is
    // held even with no device: its summary then simply reaches nobody.
    expect(held?.channels).toEqual(["push", "email"]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
