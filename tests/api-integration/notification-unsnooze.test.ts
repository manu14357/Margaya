import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { deliverNotification } from "../../apps/api/src/notification-preferences/delivery";
import { resurfaceSnoozedNotifications } from "../../apps/api/src/scheduler/notification-unsnooze";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import { inboxScene, recordEvents } from "./helpers/inbox";

vi.mock("../../apps/api/src/notification-preferences/delivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

const updates = recordEvents("notification.updated");
const created = recordEvents("notification.created");

beforeEach(async () => {
  await resetTestDatabase();
  updates.length = 0;
  created.length = 0;
  vi.mocked(deliverNotification).mockClear();
});

const NOW = new Date("2026-09-26T12:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60 * 1000);

async function rows() {
  const s = await inboxScene();
  const other = await createWorkspaceMember({ userName: "Other" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: other.workspace.id,
    userId: s.ada.id,
    joinedAt: new Date(),
  });
  const seed = async (
    values: Partial<typeof schema.notificationTable.$inferInsert>,
  ) => {
    const [row] = await db
      .insert(schema.notificationTable)
      .values({
        userId: s.ada.id,
        type: "task_comment",
        workspaceId: s.workspace.id,
        isRead: true,
        ...values,
      })
      .returning();
    if (!row) throw new Error("seed failed");
    return row;
  };
  return { ...s, other, seed };
}

async function stored(id: string) {
  const [row] = await db
    .select()
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.id, id));
  return row;
}

describe("unsnooze job", () => {
  it("resurfaces due rows only, unread, sorted from the old snooze time", async () => {
    const s = await rows();
    const due = await s.seed({ snoozedUntil: minutes(-5) });
    const dueElsewhere = await s.seed({
      snoozedUntil: minutes(-1),
      workspaceId: s.other.workspace.id,
    });
    const dueBen = await s.seed({
      userId: s.ben.id,
      snoozedUntil: minutes(-2),
    });
    const future = await s.seed({ snoozedUntil: minutes(30) });
    const archived = await s.seed({
      snoozedUntil: minutes(-5),
      archivedAt: minutes(-10),
    });

    expect(await resurfaceSnoozedNotifications(NOW)).toEqual({ resurfaced: 3 });

    const resurfaced = await stored(due.id);
    expect(resurfaced).toMatchObject({ snoozedUntil: null, isRead: false });
    expect(resurfaced?.resurfacedAt?.toISOString()).toBe(
      minutes(-5).toISOString(),
    );
    expect(await stored(dueElsewhere.id)).toMatchObject({ snoozedUntil: null });
    expect(await stored(dueBen.id)).toMatchObject({ snoozedUntil: null });
    expect((await stored(future.id))?.snoozedUntil?.toISOString()).toBe(
      minutes(30).toISOString(),
    );
    expect(await stored(archived.id)).toMatchObject({
      isRead: true,
      resurfacedAt: null,
    });
    expect((await stored(archived.id))?.snoozedUntil).not.toBeNull();

    // One hint per (user, workspace); nothing is delivered again.
    await vi.waitFor(() => expect(updates).toHaveLength(3));
    expect(updates.map((u) => `${u.userId}:${u.workspaceId}`).sort()).toEqual(
      [
        `${s.ada.id}:${s.workspace.id}`,
        `${s.ada.id}:${s.other.workspace.id}`,
        `${s.ben.id}:${s.workspace.id}`,
      ].sort(),
    );
    expect(created).toHaveLength(0);
    expect(deliverNotification).not.toHaveBeenCalled();

    expect(await resurfaceSnoozedNotifications(NOW)).toEqual({ resurfaced: 0 });
  });

  it("resurfaces each row once when two runs overlap", async () => {
    const s = await rows();
    for (let i = 0; i < 30; i += 1) {
      await s.seed({ snoozedUntil: minutes(-1 - i) });
    }
    const results = await Promise.all([
      resurfaceSnoozedNotifications(NOW),
      resurfaceSnoozedNotifications(NOW),
    ]);
    expect(results.reduce((sum, r) => sum + r.resurfaced, 0)).toBe(30);
    const left = await db
      .select({ id: schema.notificationTable.id })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.isRead, true));
    expect(left).toEqual([]);
  });
});
