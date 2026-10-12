import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { sendNotificationDigests } from "../../apps/api/src/notification-email/digest-job";
import { resetTestDatabase } from "./helpers/database";
import { inboxScene } from "./helpers/inbox";

const { sendDigest } = vi.hoisted(() => ({
  sendDigest: vi.fn(async () => ({ success: true })),
}));
vi.mock("@margaya/email", async (original) => ({
  ...(await original<object>()),
  sendNotificationDigestEmail: sendDigest,
}));

beforeEach(async () => {
  await resetTestDatabase();
  sendDigest.mockClear();
});

// 2026-10-14 is a Wednesday. Users without a time zone use UTC.
const wednesday = (time: string) => new Date(`2026-10-14T${time}:00.000Z`);
const thursday = (time: string) => new Date(`2026-10-15T${time}:00.000Z`);

async function digestUser(
  frequency: "daily" | "weekly",
  overrides: { weekday?: number; hour?: number } = {},
) {
  const scene = await inboxScene();
  await db.insert(schema.userNotificationPreferenceTable).values({
    userId: scene.cid.id,
    digestFrequency: frequency,
    digestWeekday: overrides.weekday ?? 1,
    digestHour: overrides.hour ?? 8,
  });
  return scene;
}

async function lastDigestOf(userId: string) {
  const [row] = await db
    .select({ at: schema.userNotificationPreferenceTable.lastDigestSentAt })
    .from(schema.userNotificationPreferenceTable)
    .where(eq(schema.userNotificationPreferenceTable.userId, userId));
  return row?.at ?? null;
}

describe("notification digests", () => {
  it("skips an empty digest but still records the period", async () => {
    const scene = await digestUser("daily");
    const result = await sendNotificationDigests(wednesday("08:30"));
    expect(result.sent).toBe(0);
    expect(sendDigest).not.toHaveBeenCalled();
    expect(await lastDigestOf(scene.cid.id)).toEqual(wednesday("08:30"));
  });

  it("lists due work once per day and never sends twice", async () => {
    const scene = await digestUser("daily");
    const due = await scene.task([scene.cid.id], {
      dueDate: new Date("2026-10-16T12:00:00.000Z"),
    });
    const overdue = await scene.task([scene.cid.id], {
      dueDate: new Date("2026-10-10T12:00:00.000Z"),
    });
    // Not assigned to Cid, and too far out: neither is listed.
    await scene.task([scene.ada.id], {
      dueDate: new Date("2026-10-16T12:00:00.000Z"),
    });
    await scene.task([scene.cid.id], {
      dueDate: new Date("2026-11-30T12:00:00.000Z"),
    });

    // Before the send hour nothing goes out.
    await sendNotificationDigests(wednesday("07:45"));
    expect(sendDigest).not.toHaveBeenCalled();

    await sendNotificationDigests(wednesday("08:15"));
    expect(sendDigest).toHaveBeenCalledTimes(1);
    expect(sendDigest).toHaveBeenCalledWith(
      scene.cid.email,
      "Your Margaya daily digest",
      expect.objectContaining({
        frequency: "daily",
        settingsUrl: expect.stringContaining(
          "/dashboard/settings/account/notifications",
        ),
        workspaces: [
          expect.objectContaining({
            name: scene.workspace.name,
            dueTasks: [
              expect.objectContaining({ title: overdue.title, overdue: true }),
              expect.objectContaining({ title: due.title, overdue: false }),
            ],
            moreDueTasks: 0,
          }),
        ],
      }),
    );

    // Later the same day, and a concurrent second run: no second email.
    await sendNotificationDigests(wednesday("08:30"));
    await sendNotificationDigests(wednesday("23:45"));
    expect(sendDigest).toHaveBeenCalledTimes(1);

    await sendNotificationDigests(thursday("08:00"));
    expect(sendDigest).toHaveBeenCalledTimes(2);
  });

  it("leaves out tasks the user can no longer see", async () => {
    const scene = await digestUser("daily");
    await scene.task([scene.cid.id], {
      dueDate: new Date("2026-10-15T12:00:00.000Z"),
      archivedAt: new Date("2026-10-13T12:00:00.000Z"),
    });
    await sendNotificationDigests(wednesday("08:15"));
    expect(sendDigest).not.toHaveBeenCalled();
  });

  it("leaves out trashed tasks and work in a trashed project", async () => {
    const scene = await digestUser("daily");
    const trashed = await scene.task([scene.cid.id], {
      dueDate: new Date("2026-10-15T12:00:00.000Z"),
    });
    const live = await scene.task([scene.cid.id], {
      dueDate: new Date("2026-10-16T12:00:00.000Z"),
    });
    await db.insert(schema.notificationTable).values({
      userId: scene.cid.id,
      workspaceId: scene.workspace.id,
      type: "task_mention",
      resourceType: "task",
      resourceId: trashed.id,
      eventData: { taskTitle: trashed.title, mentionerName: "Ada" },
      createdAt: new Date("2026-10-14T06:00:00.000Z"),
    });
    await db
      .update(schema.taskTable)
      .set({ deletedAt: new Date("2026-10-13T12:00:00.000Z") })
      .where(eq(schema.taskTable.id, trashed.id));

    // The trashed task is neither due work nor a mention.
    await sendNotificationDigests(wednesday("08:15"));
    expect(sendDigest).toHaveBeenCalledTimes(1);
    expect(sendDigest).toHaveBeenCalledWith(
      scene.cid.email,
      "Your Margaya daily digest",
      expect.objectContaining({
        workspaces: [
          expect.objectContaining({
            dueTasks: [expect.objectContaining({ title: live.title })],
            mentionCount: 0,
            mentions: [],
            unreadCount: 0,
          }),
        ],
      }),
    );

    // With the project in the trash, nothing is left to send.
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date("2026-10-14T12:00:00.000Z") })
      .where(eq(schema.projectTable.id, scene.project.id));
    await sendNotificationDigests(thursday("08:15"));
    expect(sendDigest).toHaveBeenCalledTimes(1);
  });

  it("sends a weekly digest only on the chosen weekday", async () => {
    const scene = await digestUser("weekly", { weekday: 4 });
    await scene.task([scene.cid.id], {
      dueDate: new Date("2026-10-16T12:00:00.000Z"),
    });

    await sendNotificationDigests(wednesday("09:00"));
    expect(sendDigest).not.toHaveBeenCalled();
    expect(await lastDigestOf(scene.cid.id)).toBeNull();

    await sendNotificationDigests(thursday("09:00"));
    expect(sendDigest).toHaveBeenCalledTimes(1);
    expect(sendDigest).toHaveBeenLastCalledWith(
      scene.cid.email,
      "Your Margaya weekly digest",
      expect.objectContaining({ frequency: "weekly" }),
    );

    await sendNotificationDigests(thursday("15:00"));
    expect(sendDigest).toHaveBeenCalledTimes(1);
  });

  it("counts new mentions and unread inbox items since the last digest", async () => {
    const scene = await digestUser("daily");
    const target = await scene.task([scene.ada.id]);
    await db.insert(schema.notificationTable).values([
      {
        userId: scene.cid.id,
        workspaceId: scene.workspace.id,
        type: "task_mention",
        resourceType: "task",
        resourceId: target.id,
        eventData: { taskTitle: target.title, mentionerName: "Ada" },
        createdAt: new Date("2026-10-14T06:00:00.000Z"),
      },
      {
        userId: scene.cid.id,
        workspaceId: scene.workspace.id,
        type: "task_comment",
        resourceType: "task",
        resourceId: target.id,
        eventData: { taskTitle: target.title },
        createdAt: new Date("2026-10-14T07:00:00.000Z"),
      },
      // Before the period started: not counted.
      {
        userId: scene.cid.id,
        workspaceId: scene.workspace.id,
        type: "task_mention",
        resourceType: "task",
        resourceId: target.id,
        eventData: { taskTitle: target.title },
        createdAt: new Date("2026-10-01T07:00:00.000Z"),
      },
    ]);

    await sendNotificationDigests(wednesday("08:15"));
    expect(sendDigest).toHaveBeenCalledWith(
      scene.cid.email,
      "Your Margaya daily digest",
      expect.objectContaining({
        workspaces: [
          expect.objectContaining({
            dueTasks: [],
            mentionCount: 1,
            mentions: [expect.objectContaining({ title: "Ada mentioned you" })],
            unreadCount: 2,
          }),
        ],
      }),
    );
  });
});
