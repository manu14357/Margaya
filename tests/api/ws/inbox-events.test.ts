import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventContext, publishEvent } from "../../../apps/api/src/events";
import {
  addConnection,
  addUserConnection,
  initializeWebSocketAdapter,
  removeConnection,
  removeUserConnection,
  shutdownWebSocketAdapter,
} from "../../../apps/api/src/ws/index";

type FakeWs = { send: ReturnType<typeof vi.fn> };

function makeFakeWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
    raw: undefined,
    url: null,
    protocol: null,
  } as never;
}

function lastMessage(ws: unknown) {
  const calls = (ws as FakeWs).send.mock.calls;
  return JSON.parse(calls[calls.length - 1]?.[0] ?? "null");
}

describe("inbox, subscription and reaction events", () => {
  beforeEach(async () => {
    delete process.env.REDIS_URL;
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await shutdownWebSocketAdapter();
  });

  it("maps notification.updated to NOTIFICATIONS_UPDATED on the user channel", async () => {
    const ws = makeFakeWs();
    const conn = addUserConnection("user-n", ws);
    await publishEvent("notification.updated", {
      userId: "user-n",
      workspaceId: "ws-1",
    });
    await vi.waitFor(() => expect((ws as FakeWs).send).toHaveBeenCalled(), {
      timeout: 300,
    });
    expect(lastMessage(ws)).toEqual({
      type: "NOTIFICATIONS_UPDATED",
      workspaceId: "ws-1",
    });
    removeUserConnection("user-n", conn);
  });

  it("maps notification.created to NOTIFICATION_CREATED with its id, type and flags only", async () => {
    const ws = makeFakeWs();
    const conn = addUserConnection("user-c", ws);
    await publishEvent("notification.created", {
      notificationId: "n-1",
      userId: "user-c",
      notificationType: "ai_agent_reply",
      reply: false,
      needsInput: true,
    });
    await vi.waitFor(() => expect((ws as FakeWs).send).toHaveBeenCalled(), {
      timeout: 300,
    });
    expect(lastMessage(ws)).toEqual({
      type: "NOTIFICATION_CREATED",
      notificationId: "n-1",
      notificationType: "ai_agent_reply",
      reply: false,
      needsInput: true,
      quiet: false,
    });
    removeUserConnection("user-c", conn);
  });

  it("keeps the tabs silent and leaves the id out while quiet time holds desktop alerts", async () => {
    const ws = makeFakeWs();
    const conn = addUserConnection("user-q", ws);
    await publishEvent("notification.created", {
      notificationId: "n-2",
      userId: "user-q",
      notificationType: "task_comment",
      reply: false,
      needsInput: false,
      quiet: true,
      desktopHeld: true,
    });
    await vi.waitFor(() => expect((ws as FakeWs).send).toHaveBeenCalled(), {
      timeout: 300,
    });
    expect(lastMessage(ws)).toEqual({
      type: "NOTIFICATION_CREATED",
      notificationId: null,
      notificationType: "task_comment",
      reply: false,
      needsInput: false,
      quiet: true,
    });
    removeUserConnection("user-q", conn);
  });

  it("maps quiet-time releases and preference changes to user hints", async () => {
    const ws = makeFakeWs();
    const conn = addUserConnection("user-r", ws);
    await publishEvent("notification.deliveries_released", {
      userId: "user-r",
      count: 4,
    });
    await vi.waitFor(() => expect((ws as FakeWs).send).toHaveBeenCalled(), {
      timeout: 300,
    });
    expect(lastMessage(ws)).toEqual({
      type: "NOTIFICATIONS_RELEASED",
      count: 4,
    });
    await publishEvent("user.preferences_changed", { userId: "user-r" });
    await vi.waitFor(
      () => expect((ws as FakeWs).send).toHaveBeenCalledTimes(2),
      { timeout: 300 },
    );
    expect(lastMessage(ws)).toEqual({
      type: "PREFERENCES_UPDATED",
      originWindowId: null,
    });
    removeUserConnection("user-r", conn);
  });

  it("maps task.subscription_changed to SUBSCRIPTION_UPDATED for that user", async () => {
    const mine = makeFakeWs();
    const other = makeFakeWs();
    const connections = [
      addUserConnection("user-s", mine),
      addUserConnection("user-o", other),
    ];
    await publishEvent("task.subscription_changed", {
      taskId: "task-1",
      projectId: "proj-1",
      userId: "user-s",
      subscribed: true,
      reason: "manual",
    });
    await vi.waitFor(() => expect((mine as FakeWs).send).toHaveBeenCalled(), {
      timeout: 300,
    });
    expect(lastMessage(mine)).toEqual({
      type: "SUBSCRIPTION_UPDATED",
      taskId: "task-1",
    });
    expect((other as FakeWs).send).not.toHaveBeenCalled();
    removeUserConnection("user-s", connections[0] as never);
    removeUserConnection("user-o", connections[1] as never);
  });

  it.each(["reaction.added", "reaction.removed"])(
    "%s reaches other windows of the project as REACTIONS_UPDATED",
    async (eventName) => {
      const initiator = makeFakeWs();
      const other = makeFakeWs();
      const connections = [
        addConnection("proj-r", initiator, "user-1", "window-1"),
        addConnection("proj-r", other, "user-2", "window-2"),
      ];
      await eventContext.run({ initiatorId: "window-1" }, () =>
        publishEvent(eventName, {
          taskId: "task-r",
          projectId: "proj-r",
          commentId: null,
          userId: "user-1",
          emoji: "heart",
        }),
      );
      await vi.waitFor(
        () => expect((other as FakeWs).send).toHaveBeenCalled(),
        { timeout: 300 },
      );
      expect(lastMessage(other)).toEqual({
        type: "REACTIONS_UPDATED",
        projectId: "proj-r",
        taskId: "task-r",
      });
      expect((initiator as FakeWs).send).not.toHaveBeenCalled();
      removeConnection("proj-r", connections[0] as never);
      removeConnection("proj-r", connections[1] as never);
    },
  );
});
