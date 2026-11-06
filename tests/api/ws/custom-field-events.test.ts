import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventContext, publishEvent } from "../../../apps/api/src/events";
import {
  addConnection,
  initializeWebSocketAdapter,
  removeConnection,
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

describe("custom field events on the project socket", () => {
  beforeEach(async () => {
    delete process.env.REDIS_URL;
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await shutdownWebSocketAdapter();
  });

  it.each([
    [
      "custom_field.created",
      { fieldId: "f1", projectId: "proj-cf" },
      { type: "CUSTOM_FIELDS_UPDATED", projectId: "proj-cf", taskId: "" },
    ],
    [
      "custom_field.updated",
      { fieldId: "f1", projectId: "proj-cf" },
      { type: "CUSTOM_FIELDS_UPDATED", projectId: "proj-cf", taskId: "" },
    ],
    [
      "custom_field.deleted",
      { fieldId: "f1", projectId: "proj-cf" },
      { type: "CUSTOM_FIELDS_UPDATED", projectId: "proj-cf", taskId: "" },
    ],
    [
      "custom_field.values_changed",
      { fieldId: "f1", projectId: "proj-cf" },
      { type: "TASKS_CHANGED", projectId: "proj-cf" },
    ],
    [
      "task.custom_field_changed",
      { fieldId: "f1", projectId: "proj-cf", taskId: "t1", userId: "u1" },
      { type: "TASK_UPDATED", projectId: "proj-cf", taskId: "t1" },
    ],
  ])(
    "%s reaches other windows as a hint without values",
    async (eventName, payload, expected) => {
      const initiator = makeFakeWs();
      const other = makeFakeWs();
      const connections = [
        addConnection("proj-cf", initiator, "user-1", "window-1"),
        addConnection("proj-cf", other, "user-2", "window-2"),
      ];

      await eventContext.run({ initiatorId: "window-1" }, () =>
        publishEvent(eventName, payload),
      );

      await vi.waitFor(
        () => expect((other as FakeWs).send).toHaveBeenCalled(),
        { timeout: 300 },
      );
      expect(JSON.parse((other as FakeWs).send.mock.calls[0][0])).toEqual(
        expected,
      );
      expect((initiator as FakeWs).send).not.toHaveBeenCalled();

      for (const connection of connections) {
        removeConnection("proj-cf", connection);
      }
    },
  );
});
