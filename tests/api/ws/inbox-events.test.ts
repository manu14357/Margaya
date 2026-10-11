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
