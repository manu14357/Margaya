import type { User } from "better-auth/types";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import createNotification from "../../apps/api/src/notification/controllers/create-notification";
import { notifyTaskEvent } from "../../apps/api/src/notification/recipients";
import { subscribeUsers } from "../../apps/api/src/subscription/service";
import { removeFromWorkspace } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import { inboxScene } from "./helpers/inbox";

vi.mock("../../apps/api/src/notification-preferences/delivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

beforeEach(async () => {
  await resetTestDatabase();
});

type Row = typeof schema.notificationTable.$inferSelect;
type InboxItem = Row & {
  actor: { id: string; name: string; image: string | null } | null;
  task: {
    id: string;
    key: string;
    title: string;
    projectId: string;
    projectName: string;
  } | null;
  sortAt: string;
  isSnoozed: boolean;
};
type InboxPage = { items: InboxItem[]; nextCursor: string | null };

const HOUR = 60 * 60 * 1000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);
const ahead = (hours: number) => new Date(Date.now() + hours * HOUR);

async function scene() {
  const s = await inboxScene();
  const target = await s.task([s.ada.id]);
  const seed = async (
    values: Partial<typeof schema.notificationTable.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(schema.notificationTable)
      .values({
        userId: s.ada.id,
        type: "task_comment",
        resourceType: "task",
        resourceId: target.id,
        workspaceId: s.workspace.id,
        ...values,
      })
      .returning();
    if (!row) throw new Error("Failed to seed a notification");
    return row;
  };
  const inbox = async (
    query: Record<string, string> = {},
    user: User = s.ada,
  ): Promise<InboxPage> => {
    const params = new URLSearchParams({
      workspaceId: s.workspace.id,
      ...query,
    });
    const response = await s.call(user, "GET", `/notification/inbox?${params}`);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as InboxPage;
  };
  const ids = async (query: Record<string, string> = {}) =>
    (await inbox(query)).items.map((item) => item.id);
  const counts = async (user: User = s.ada) => {
    const response = await s.call(
      user,
      "GET",
      `/notification/counts?workspaceId=${s.workspace.id}`,
    );
    return (await response.json()) as {
      unread: number;
      unreadMentions: number;
    };
  };
  return { ...s, target, seed, inbox, ids, counts };
}

describe("workspace of a notification", () => {
  it("is derived from the resource, and resource-less rows show everywhere", async () => {
    const s = await scene();
    const [fromTask] = await notifyTaskEvent({
      taskId: s.target.id,
      kind: "statusChanged",
      actorId: s.ben.id,
      eventData: { oldStatus: "to-do", newStatus: "done" },
    });
    expect(fromTask?.workspaceId).toBe(s.workspace.id);
    expect(fromTask?.actorId).toBe(s.ben.id);

    const workspaceRow = await createNotification({
      userId: s.ada.id,
      type: "workspace_created",
      resourceId: s.workspace.id,
      resourceType: "workspace",
    });
    expect(workspaceRow?.workspaceId).toBe(s.workspace.id);

    const created = await s.call(s.ada, "POST", "/notification", {
      title: "Deploy",
      message: "Finished",
      type: "info",
      eventData: { workspaceId: "spoofed" },
    });
    const unscoped = (await created.json()) as Row;
    expect(unscoped.workspaceId).toBeNull();

    const other = await createWorkspaceMember({ userName: "Other" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: other.workspace.id,
      userId: s.ada.id,
      joinedAt: new Date(),
    });
    const elsewhere = await s.call(
      s.ada,
      "GET",
      `/notification/inbox?workspaceId=${other.workspace.id}`,
    );
    expect(
      ((await elsewhere.json()) as InboxPage).items.map((item) => item.id),
    ).toEqual([unscoped.id]);
    expect(await s.ids()).toEqual(
      expect.arrayContaining([fromTask?.id, workspaceRow?.id, unscoped.id]),
    );
  });

  it("returns the actor, the current task and the sort instant", async () => {
    const s = await scene();
    await db
      .update(schema.userTable)
      .set({ image: "https://avatars.example.com/ben.png" })
      .where(eq(schema.userTable.id, s.ben.id));
    const row = await s.seed({ actorId: s.ben.id });
    await db
      .update(schema.taskTable)
      .set({ title: "Renamed task" })
      .where(eq(schema.taskTable.id, s.target.id));
    const [item] = (await s.inbox()).items;
    expect(item).toMatchObject({
      id: row.id,
      actor: {
        id: s.ben.id,
        name: "Ben",
        image: "https://avatars.example.com/ben.png",
      },
      task: {
        id: s.target.id,
        key: "INB-1000",
        title: "Renamed task",
        projectId: s.project.id,
      },
      isSnoozed: false,
    });
    expect(item?.actor).not.toHaveProperty("email");
    expect(new Date(item?.sortAt ?? "").getTime()).toBe(
      row.createdAt.getTime(),
    );
  });
});

describe("views, tabs and filters", () => {
  it("separates inbox, snoozed and archived", async () => {
    const s = await scene();
    const plain = await s.seed({ createdAt: ago(5) });
    const archived = await s.seed({ createdAt: ago(4), archivedAt: ago(1) });
    const snoozedLater = await s.seed({
      createdAt: ago(3),
      snoozedUntil: ahead(5),
    });
    const snoozedSoon = await s.seed({
      createdAt: ago(3),
      snoozedUntil: ahead(1),
    });
    const snoozeOver = await s.seed({
      createdAt: ago(2),
      snoozedUntil: ago(1),
    });

    expect(await s.ids()).toEqual([snoozeOver.id, plain.id]);
    expect(await s.ids({ view: "snoozed" })).toEqual([
      snoozedSoon.id,
      snoozedLater.id,
    ]);
    expect(await s.ids({ view: "archived" })).toEqual([archived.id]);
    const snoozedItems = (await s.inbox({ view: "snoozed" })).items;
    expect(snoozedItems.every((item) => item.isSnoozed)).toBe(true);
  });

  it("filters mentions and unread", async () => {
    const s = await scene();
    const mention = await s.seed({ type: "task_mention", createdAt: ago(3) });
    const readMention = await s.seed({
      type: "task_mention",
      isRead: true,
      createdAt: ago(2),
    });
    const unreadComment = await s.seed({ createdAt: ago(1) });
    expect(await s.ids({ tab: "mentions" })).toEqual([
      readMention.id,
      mention.id,
    ]);
    expect(await s.ids({ unread: "true" })).toEqual([
      unreadComment.id,
      mention.id,
    ]);
    expect(await s.ids({ tab: "mentions", unread: "true" })).toEqual([
      mention.id,
    ]);
  });

  it("filters by assigned, created and subscribed tasks", async () => {
    const s = await scene();
    const assigned = s.target; // Ada is its assignee
    const created = await s.task([], { createdBy: s.ada.id });
    const watched = await s.task([]);
    const createdAndWatched = await s.task([], { createdBy: s.ada.id });
    await subscribeUsers(watched.id, [s.ada.id], "manual");
    await subscribeUsers(createdAndWatched.id, [s.ada.id], "manual");
    await subscribeUsers(assigned.id, [s.ada.id], "assignee");
    const onAssigned = await s.seed({
      resourceId: assigned.id,
      createdAt: ago(4),
    });
    const onCreated = await s.seed({
      resourceId: created.id,
      createdAt: ago(3),
    });
    const onWatched = await s.seed({
      resourceId: watched.id,
      createdAt: ago(2),
    });
    const onBoth = await s.seed({
      resourceId: createdAndWatched.id,
      createdAt: ago(1),
    });
    await s.seed({ resourceType: null, resourceId: null, workspaceId: null });

    expect(await s.ids({ types: "assigned" })).toEqual([onAssigned.id]);
    expect(await s.ids({ types: "created" })).toEqual([
      onBoth.id,
      onCreated.id,
    ]);
    expect(await s.ids({ types: "subscribed" })).toEqual([onWatched.id]);
    expect(await s.ids({ types: "assigned,subscribed" })).toEqual([
      onWatched.id,
      onAssigned.id,
    ]);

    const bad = await s.call(
      s.ada,
      "GET",
      `/notification/inbox?workspaceId=${s.workspace.id}&types=watching`,
    );
    expect(bad.status).toBe(400);
    const badView = await s.call(
      s.ada,
      "GET",
      `/notification/inbox?workspaceId=${s.workspace.id}&view=later`,
    );
    expect(badView.status).toBe(400);
    const badLimit = await s.call(
      s.ada,
      "GET",
      `/notification/inbox?workspaceId=${s.workspace.id}&limit=101`,
    );
    expect(badLimit.status).toBe(400);
  });
});

describe("order and paging", () => {
  it("sorts a resurfaced row by when its snooze ended", async () => {
    const s = await scene();
    const older = await s.seed({
      createdAt: ago(10),
      resurfacedAt: ago(0.5),
    });
    const newer = await s.seed({ createdAt: ago(1) });
    expect(await s.ids()).toEqual([older.id, newer.id]);
  });

  it("pages 120 rows by keyset without duplicates or gaps", async () => {
    const s = await scene();
    const base = Date.now() - 1000 * HOUR;
    const rows = await db
      .insert(schema.notificationTable)
      .values(
        Array.from({ length: 120 }, (_, i) => ({
          userId: s.ada.id,
          type: "task_comment",
          resourceType: "task",
          resourceId: s.target.id,
          workspaceId: s.workspace.id,
          // Pairs share an instant so the id tie-break matters.
          createdAt: new Date(base + Math.floor(i / 2) * 1000),
        })),
      )
      .returning({ id: schema.notificationTable.id });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      // 49 splits a same-instant pair across pages.
      const page: InboxPage = await s.inbox({
        limit: "49",
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(120);
    expect([...seen].sort()).toEqual(rows.map((row) => row.id).sort());

    const first = await s.inbox({ limit: "50" });
    const wrongView = await s.call(
      s.ada,
      "GET",
      `/notification/inbox?workspaceId=${s.workspace.id}&view=archived&cursor=${first.nextCursor}`,
    );
    expect(wrongView.status).toBe(400);
    expect(await wrongView.text()).toBe("Invalid cursor");
    const garbage = await s.call(
      s.ada,
      "GET",
      `/notification/inbox?workspaceId=${s.workspace.id}&cursor=nope`,
    );
    expect(garbage.status).toBe(400);
  });
});

describe("counts", () => {
  it("counts unread inbox rows and mentions, ignoring archived and snoozed", async () => {
    const s = await scene();
    await s.seed();
    await s.seed({ type: "task_mention" });
    await s.seed({ type: "task_mention", isRead: true });
    await s.seed({ archivedAt: new Date() });
    await s.seed({ type: "task_mention", snoozedUntil: ahead(2) });
    await s.seed({ snoozedUntil: ago(1) });
    expect(await s.counts()).toEqual({ unread: 3, unreadMentions: 1 });
  });
});

describe("state transitions", () => {
  it("reads, archives, snoozes and unsnoozes one row", async () => {
    const s = await scene();
    const row = await s.seed({ createdAt: ago(5) });
    const newer = await s.seed({ createdAt: ago(1) });
    const patch = (action: string, body?: unknown) =>
      s.call(s.ada, "PATCH", `/notification/${row.id}/${action}`, body);

    expect(await (await patch("read")).json()).toMatchObject({ isRead: true });
    expect(await (await patch("unread")).json()).toMatchObject({
      isRead: false,
    });

    const snoozed = (await (
      await patch("snooze", { until: ahead(24).toISOString() })
    ).json()) as Row;
    expect(snoozed.snoozedUntil).not.toBeNull();
    expect(await s.ids()).toEqual([newer.id]);

    const archived = (await (await patch("archive")).json()) as Row;
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.snoozedUntil).toBeNull();
    expect(await s.ids({ view: "archived" })).toEqual([row.id]);

    const resnoozed = (await (
      await patch("snooze", { until: ahead(2).toISOString() })
    ).json()) as Row;
    expect(resnoozed.archivedAt).toBeNull();
    expect(await s.ids({ view: "snoozed" })).toEqual([row.id]);

    const back = (await (await patch("unsnooze")).json()) as Row;
    expect(back.snoozedUntil).toBeNull();
    expect(back.resurfacedAt).not.toBeNull();
    expect(back.isRead).toBe(false);
    // A manual unsnooze jumps to the top.
    expect(await s.ids()).toEqual([row.id, newer.id]);

    await patch("archive");
    const restored = (await (await patch("unarchive")).json()) as Row;
    expect(restored.archivedAt).toBeNull();
  });

  it("refuses snoozes in the past or more than a year ahead", async () => {
    const s = await scene();
    const row = await s.seed();
    const snooze = (until: string) =>
      s.call(s.ada, "PATCH", `/notification/${row.id}/snooze`, { until });
    const past = await snooze(ago(1).toISOString());
    expect(past.status).toBe(400);
    expect(await past.text()).toBe("Pick a time in the future");
    const far = await snooze(ahead(367 * 24).toISOString());
    expect(far.status).toBe(400);
    expect(await far.text()).toBe(
      "You can snooze a notification for up to a year",
    );
    expect((await snooze("tomorrow")).status).toBe(400);
  });

  it("hides other people's notifications and other workspaces", async () => {
    const s = await scene();
    const row = await s.seed();
    for (const action of [
      "read",
      "unread",
      "archive",
      "unarchive",
      "unsnooze",
    ]) {
      const response = await s.call(
        s.ben,
        "PATCH",
        `/notification/${row.id}/${action}`,
      );
      expect(response.status, action).toBe(404);
      expect(await response.text()).toBe("Notification not found");
    }
    expect(
      (
        await s.call(s.ben, "PATCH", `/notification/${row.id}/snooze`, {
          until: ahead(3).toISOString(),
        })
      ).status,
    ).toBe(404);

    const stranger = (await createWorkspaceMember({ userName: "Stranger" }))
      .user;
    expect(
      (
        await s.call(
          stranger,
          "GET",
          `/notification/inbox?workspaceId=${s.workspace.id}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await s.call(
          stranger,
          "GET",
          `/notification/counts?workspaceId=${s.workspace.id}`,
        )
      ).status,
    ).toBe(403);
  });
});

describe("bulk routes", () => {
  it("marks only the scoped rows read, or every row without a scope", async () => {
    const s = await scene();
    const other = await createWorkspaceMember({ userName: "Other" });
    const mention = await s.seed({ type: "task_mention" });
    const comment = await s.seed();
    const archived = await s.seed({ archivedAt: new Date() });
    const foreign = await s.seed({
      resourceType: null,
      resourceId: null,
      workspaceId: other.workspace.id,
    });

    const scoped = await s.call(
      s.ada,
      "PATCH",
      `/notification/read-all?workspaceId=${s.workspace.id}&tab=mentions`,
    );
    expect(await scoped.json()).toEqual({ success: true, updatedCount: 1 });
    const readIds = async () =>
      (
        await db
          .select({
            id: schema.notificationTable.id,
            isRead: schema.notificationTable.isRead,
          })
          .from(schema.notificationTable)
      )
        .filter((row) => row.isRead)
        .map((row) => row.id)
        .sort();
    expect(await readIds()).toEqual([mention.id]);

    const inboxWide = await s.call(
      s.ada,
      "PATCH",
      `/notification/read-all?workspaceId=${s.workspace.id}`,
    );
    expect(await inboxWide.json()).toEqual({ success: true, updatedCount: 1 });
    expect(await readIds()).toEqual([mention.id, comment.id].sort());

    const legacy = await s.call(s.ada, "PATCH", "/notification/read-all");
    expect(await legacy.json()).toEqual({ success: true, updatedCount: 2 });
    expect(await readIds()).toEqual(
      [mention.id, comment.id, archived.id, foreign.id].sort(),
    );
  });

  it("clears one workspace's rows and keeps unscoped ones", async () => {
    const s = await scene();
    const other = await createWorkspaceMember({ userName: "Other" });
    await s.seed();
    await s.seed();
    const unscoped = await s.seed({
      resourceType: null,
      resourceId: null,
      workspaceId: null,
    });
    const foreign = await s.seed({
      resourceType: null,
      resourceId: null,
      workspaceId: other.workspace.id,
    });
    const cleared = await s.call(
      s.ada,
      "DELETE",
      `/notification/clear-all?workspaceId=${s.workspace.id}`,
    );
    expect(await cleared.json()).toEqual({ success: true, updatedCount: 2 });
    const left = await db
      .select({ id: schema.notificationTable.id })
      .from(schema.notificationTable);
    expect(left.map((row) => row.id).sort()).toEqual(
      [unscoped.id, foreign.id].sort(),
    );
  });
});

describe("compatibility", () => {
  it("keeps the legacy list, with the new fields, and the access rule", async () => {
    const s = await scene();
    const row = await s.seed({ archivedAt: new Date(), actorId: s.ben.id });
    const response = await s.call(s.ada, "GET", "/notification");
    const list = (await response.json()) as Row[];
    expect(list).toEqual([
      expect.objectContaining({
        id: row.id,
        workspaceId: s.workspace.id,
        actorId: s.ben.id,
        snoozedUntil: null,
        resurfacedAt: null,
      }),
    ]);
    expect(list[0]?.archivedAt).not.toBeNull();

    await removeFromWorkspace(s.ada.id, s.workspace.id);
    expect(await (await s.call(s.ada, "GET", "/notification")).json()).toEqual(
      [],
    );
  });

  it("deletes a task's notifications with the task", async () => {
    const s = await scene();
    await s.seed();
    await s.seed({ userId: s.ben.id });
    const deleted = await s.call(s.ada, "DELETE", `/task/${s.target.id}`);
    expect(deleted.status).toBe(200);
    // Deleting trashes the task (C7); the permanent delete removes them.
    const purged = await s.call(s.ada, "DELETE", `/trash/task/${s.target.id}`);
    expect(purged.status).toBe(200);
    await vi.waitFor(
      async () =>
        expect(
          await db
            .select()
            .from(schema.notificationTable)
            .where(eq(schema.notificationTable.resourceId, s.target.id)),
        ).toEqual([]),
      { timeout: 5000, interval: 25 },
    );
  });
});
