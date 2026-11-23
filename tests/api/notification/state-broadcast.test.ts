import { beforeEach, describe, expect, it, vi } from "vitest";

// Archiving (or any state change) from the API or another tab must reach the
// user's open inboxes: the controller publishes notification.updated, which
// ws/index.ts turns into a NOTIFICATIONS_UPDATED user hint
// (tests/api/ws/inbox-events.test.ts) and the web refetches ["notifications"]
// (apps/web/src/hooks/use-inbox-websocket-messages.test.tsx).

const m = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  publish: vi.fn(),
}));

vi.mock("../../../apps/api/src/database", () => {
  const select = () => ({
    from: () => ({
      where: () => ({ limit: async () => (m.row ? [m.row] : []) }),
    }),
  });
  const update = () => ({
    set: (patch: Record<string, unknown>) => ({
      where: () => ({ returning: async () => [{ ...m.row, ...patch }] }),
    }),
  });
  return { default: { select, update } };
});
vi.mock("../../../apps/api/src/events", () => ({ publishEvent: m.publish }));
vi.mock("../../../apps/api/src/notification/resource-access", () => ({
  notificationResourceAccess: () => undefined,
}));

const { default: updateNotificationState } = await import(
  "../../../apps/api/src/notification/controllers/update-notification-state"
);

describe("notification state changes reach other sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.row = {
      id: "n1",
      userId: "u1",
      workspaceId: "w1",
      isRead: false,
      archivedAt: null,
      snoozedUntil: null,
    };
  });

  it("archiving publishes the user's inbox hint", async () => {
    await updateNotificationState("n1", "u1", { action: "archive" });
    expect(m.publish).toHaveBeenCalledWith("notification.updated", {
      userId: "u1",
      workspaceId: "w1",
    });
  });

  it("unarchiving publishes it too", async () => {
    m.row = { ...m.row, archivedAt: new Date() };
    await updateNotificationState("n1", "u1", { action: "unarchive" });
    expect(m.publish).toHaveBeenCalledWith(
      "notification.updated",
      expect.objectContaining({ userId: "u1" }),
    );
  });

  it("archiving an archived row is a no-op and publishes nothing", async () => {
    m.row = { ...m.row, archivedAt: new Date() };
    await updateNotificationState("n1", "u1", { action: "archive" });
    expect(m.publish).not.toHaveBeenCalled();
  });
});
