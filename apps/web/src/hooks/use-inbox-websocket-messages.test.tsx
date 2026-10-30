import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectWebSocket } from "./use-project-websocket";
import { useUserWebSocket } from "./use-user-websocket";

// Inbox, subscription and reaction hints (B10 §5) on the user and project
// sockets.

const { client } = vi.hoisted(() => ({
  client: { invalidateQueries: vi.fn() },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => client }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-a" } } }) },
}));
vi.mock("@margaya/libs", () => ({ windowId: "local-test" }));

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(public url: string) {
    TestSocket.instances.push(this);
  }
}

function keysAfter(send: () => void) {
  client.invalidateQueries.mockClear();
  act(send);
  return client.invalidateQueries.mock.calls.map(([arg]) =>
    arg.queryKey ? JSON.stringify(arg.queryKey) : "predicate",
  );
}

function deliver(socket: TestSocket | undefined, message: object) {
  socket?.onmessage?.({ data: JSON.stringify(message) });
}

describe("inbox socket hints", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
    TestSocket.instances = [];
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("refetches notifications on NOTIFICATIONS_UPDATED", () => {
    const { unmount } = renderHook(useUserWebSocket);
    const keys = keysAfter(() =>
      deliver(TestSocket.instances[0], {
        type: "NOTIFICATIONS_UPDATED",
        workspaceId: "ws",
      }),
    );
    expect(keys).toEqual([JSON.stringify(["notifications"])]);
    unmount();
  });

  it("refetches the subscription, task queries and Your work on SUBSCRIPTION_UPDATED", () => {
    const { unmount } = renderHook(useUserWebSocket);
    const keys = keysAfter(() =>
      deliver(TestSocket.instances[0], {
        type: "SUBSCRIPTION_UPDATED",
        taskId: "t1",
      }),
    );
    expect(keys).toEqual([
      JSON.stringify(["task-subscription", "t1"]),
      "predicate",
      JSON.stringify(["my-work"]),
    ]);
    unmount();
  });

  it("refetches only the task's reactions on REACTIONS_UPDATED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const keys = keysAfter(() =>
      deliver(TestSocket.instances[0], {
        type: "REACTIONS_UPDATED",
        projectId: "project-a",
        taskId: "t1",
      }),
    );
    expect(keys).toEqual([JSON.stringify(["reactions", "t1"])]);
    unmount();
  });

  it("also refetches reactions and the subscription on COMMENT_UPDATED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const keys = keysAfter(() =>
      deliver(TestSocket.instances[0], {
        type: "COMMENT_UPDATED",
        projectId: "project-a",
        taskId: "t1",
      }),
    );
    expect(keys).toContain(JSON.stringify(["reactions", "t1"]));
    expect(keys).toContain(JSON.stringify(["task-subscription", "t1"]));
    // Replies arrive on the same hint: the feed carries the threads.
    expect(keys).toContain(JSON.stringify(["activities", "t1"]));
    expect(keys).toContain(JSON.stringify(["comments", "t1"]));
    unmount();
  });

  it("refetches the subscription on TASK_UPDATED (assignment subscribes)", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const keys = keysAfter(() =>
      deliver(TestSocket.instances[0], {
        type: "TASK_UPDATED",
        projectId: "project-a",
        taskId: "t1",
      }),
    );
    expect(keys).toContain(JSON.stringify(["task-subscription", "t1"]));
    expect(keys).not.toContain(JSON.stringify(["reactions", "t1"]));
    unmount();
  });
});
