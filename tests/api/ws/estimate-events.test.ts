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

async function deliver(
  eventName: string,
  payload: Record<string, unknown>,
): Promise<{ other: FakeWs; initiator: FakeWs; elsewhere: FakeWs }> {
  const initiator = makeFakeWs();
  const other = makeFakeWs();
  const elsewhere = makeFakeWs();
  const connections = [
    addConnection("proj-e", initiator, "user-1", "window-1"),
    addConnection("proj-e", other, "user-2", "window-2"),
    addConnection("proj-x", elsewhere, "user-3", "window-3"),
  ];

  await eventContext.run({ initiatorId: "window-1" }, () =>
    publishEvent(eventName, {
      projectId: "proj-e",
      userId: "user-1",
      ...payload,
    }),
  );
  await vi.waitFor(() => expect((other as FakeWs).send).toHaveBeenCalled(), {
    timeout: 300,
  });

  removeConnection("proj-e", connections[0]);
  removeConnection("proj-e", connections[1]);
  removeConnection("proj-x", connections[2]);
  return {
    other: other as FakeWs,
    initiator: initiator as FakeWs,
    elsewhere: elsewhere as FakeWs,
  };
}

describe("estimate events on the project socket", () => {
  beforeEach(async () => {
    delete process.env.REDIS_URL;
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await shutdownWebSocketAdapter();
  });

  it.each([
    "estimate.created",
    "estimate.updated",
    "estimate.deleted",
    "estimate.activated",
  ])("%s reaches other windows as ESTIMATE_UPDATED", async (eventName) => {
    const { other, initiator, elsewhere } = await deliver(eventName, {
      estimateId: "estimate-1",
    });
    expect(JSON.parse(other.send.mock.calls[0][0])).toEqual({
      type: "ESTIMATE_UPDATED",
      projectId: "proj-e",
      taskId: "",
    });
    expect(initiator.send).not.toHaveBeenCalled();
    expect(elsewhere.send).not.toHaveBeenCalled();
  });

  it("estimate.tasks_remapped sends one ESTIMATE_TASKS_REMAPPED", async () => {
    const { other } = await deliver("estimate.tasks_remapped", {
      estimateId: "estimate-1",
      changedTaskCount: 250,
    });
    expect(other.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(other.send.mock.calls[0][0])).toEqual({
      type: "ESTIMATE_TASKS_REMAPPED",
      projectId: "proj-e",
      taskId: "",
    });
  });

  it("task.estimate_changed reaches clients as TASK_UPDATED", async () => {
    const { other } = await deliver("task.estimate_changed", {
      taskId: "task-9",
      oldPointId: null,
      newPointId: "point-1",
      type: "estimate_changed",
    });
    expect(JSON.parse(other.send.mock.calls[0][0])).toMatchObject({
      type: "TASK_UPDATED",
      projectId: "proj-e",
      taskId: "task-9",
    });
  });
});
