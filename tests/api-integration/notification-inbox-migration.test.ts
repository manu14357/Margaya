import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { migrateNotificationInbox } from "../../apps/api/src/migrations/notification-inbox-migration";
import { resetTestDatabase } from "./helpers/database";
import { assignTask, createWorkspaceMember } from "./helpers/fixtures";
import { inboxScene, mentionOf } from "./helpers/inbox";

vi.mock("../../apps/api/src/notification-preferences/delivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

beforeEach(async () => {
  await resetTestDatabase();
});

async function notification(
  values: Partial<typeof schema.notificationTable.$inferInsert> & {
    userId: string;
  },
) {
  const [row] = await db
    .insert(schema.notificationTable)
    .values({ type: "info", ...values })
    .returning();
  if (!row) throw new Error("seed failed");
  return row;
}

async function workspaceOf(id: string) {
  const [row] = await db
    .select({ workspaceId: schema.notificationTable.workspaceId })
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.id, id));
  return row?.workspaceId;
}

describe("notification inbox boot migration", () => {
  it("derives the workspace of task and workspace notifications only", async () => {
    const s = await inboxScene();
    const target = await s.task([]);
    const onTask = await notification({
      userId: s.ada.id,
      resourceType: "task",
      resourceId: target.id,
    });
    const onWorkspace = await notification({
      userId: s.ada.id,
      resourceType: "workspace",
      resourceId: s.workspace.id,
    });
    const onDeletedTask = await notification({
      userId: s.ada.id,
      resourceType: "task",
      resourceId: "task-that-is-gone",
    });
    const unscoped = await notification({ userId: s.ada.id });

    expect((await migrateNotificationInbox()).workspaces).toBe(2);
    expect(await workspaceOf(onTask.id)).toBe(s.workspace.id);
    expect(await workspaceOf(onWorkspace.id)).toBe(s.workspace.id);
    expect(await workspaceOf(onDeletedTask.id)).toBeNull();
    expect(await workspaceOf(unscoped.id)).toBeNull();
  });

  it("backfills member mentions and subscriptions in reason order, once", async () => {
    const s = await inboxScene();
    const outsider = (await createWorkspaceMember({ userName: "Out" })).user;
    const dee = await s.person("Dee");
    const target = await s.task([], {
      createdBy: s.ada.id,
      description: `${mentionOf(s.ben)} ${mentionOf(outsider)} <margaya-mention id="ghost" label="Ghost"></margaya-mention>`,
    });
    await assignTask(target.id, [s.ada.id, s.cid.id]);
    const [comment] = await db
      .insert(schema.activityTable)
      .values({
        taskId: target.id,
        type: "comment",
        userId: s.cid.id,
        content: `for ${mentionOf(dee)}`,
      })
      .returning();
    await db.insert(schema.activityTable).values({
      taskId: target.id,
      type: "comment",
      userId: s.ben.id,
      content: "imported",
      externalSource: "gitea",
      externalUserName: "Someone",
    });

    const first = await migrateNotificationInbox();
    expect(first).toMatchObject({ mentions: 2, subscriptions: 4 });

    const mentions = await db
      .select({
        userId: schema.taskMentionTable.userId,
        commentId: schema.taskMentionTable.commentId,
      })
      .from(schema.taskMentionTable);
    expect(
      mentions.map((m) => `${m.commentId ?? "description"}:${m.userId}`).sort(),
    ).toEqual([`description:${s.ben.id}`, `${comment?.id}:${dee.id}`].sort());

    const subscriptions = await db
      .select({
        userId: schema.taskSubscriberTable.userId,
        reason: schema.taskSubscriberTable.reason,
        subscribed: schema.taskSubscriberTable.subscribed,
      })
      .from(schema.taskSubscriberTable);
    expect(
      subscriptions
        .map((row) => [row.userId, row.reason, row.subscribed])
        .sort(),
    ).toEqual(
      [
        // Ada created and is assigned: creator wins.
        [s.ada.id, "creator", true],
        // Cid is assigned and commented: assignee wins.
        [s.cid.id, "assignee", true],
        // Ben's only comment is imported, so he is subscribed by mention.
        [s.ben.id, "mention", true],
        [dee.id, "mention", true],
      ].sort(),
    );

    expect(await migrateNotificationInbox()).toEqual({
      workspaces: 0,
      mentions: 0,
      subscriptions: 0,
    });
  });

  it("skips the backfills once the tables hold rows", async () => {
    const s = await inboxScene();
    const kept = await s.task([], { createdBy: s.ada.id });
    const skipped = await s.task([], {
      createdBy: s.ben.id,
      description: mentionOf(s.cid),
    });
    await db
      .insert(schema.taskSubscriberTable)
      .values({ taskId: kept.id, userId: s.ada.id, reason: "manual" });
    await db
      .insert(schema.taskMentionTable)
      .values({ taskId: kept.id, userId: s.ben.id });

    expect(await migrateNotificationInbox()).toEqual({
      workspaces: 0,
      mentions: 0,
      subscriptions: 0,
    });
    expect(
      await db
        .select()
        .from(schema.taskSubscriberTable)
        .where(eq(schema.taskSubscriberTable.taskId, skipped.id)),
    ).toEqual([]);
  });
});
