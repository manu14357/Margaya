import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetClosedProjectSockets,
  useProjectWebSocket,
} from "./use-project-websocket";

const { client, auth } = vi.hoisted(() => ({
  client: { invalidateQueries: vi.fn(), removeQueries: vi.fn() },
  auth: { userId: "user-a" as string | null },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => client }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: auth.userId ? { user: { id: auth.userId } } : null,
    }),
  },
}));
vi.mock("@margaya/libs", () => ({ windowId: "local-test" }));

// Browsers always pass a CloseEvent; 1006 is a dropped connection.
const ABNORMAL_CLOSE = { code: 1006 };

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  // Deliberately delay close events to reproduce the project-switch race.
  close = vi.fn(() => {
    this.readyState = 3;
  });
  constructor(public url: string) {
    TestSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

describe("project WebSocket lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
    TestSocket.instances = [];
    auth.userId = "user-a";
    client.invalidateQueries.mockClear();
    client.removeQueries.mockClear();
    forgetClosedProjectSockets();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("catches up on a project's changes when its socket opens again", () => {
    const first = renderHook(() => useProjectWebSocket("project-a"));
    act(() => TestSocket.instances[0]?.open());
    expect(client.invalidateQueries).not.toHaveBeenCalled();
    first.unmount();

    renderHook(() => useProjectWebSocket("project-a"));
    act(() => TestSocket.instances[1]?.open());
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["tasks", "project-a"],
    });
    expect(client.removeQueries).toHaveBeenCalledWith({
      queryKey: ["task"],
      type: "inactive",
    });
  });

  it("ignores late old-project events without stopping the new project's keepalive", () => {
    const { rerender, unmount } = renderHook(
      ({ id }) => useProjectWebSocket(id),
      { initialProps: { id: "project-a" } },
    );
    const old = TestSocket.instances[0];
    act(() => old.open());
    rerender({ id: "project-b" });
    const current = TestSocket.instances[1];
    act(() => {
      current.open();
      old.onclose?.(ABNORMAL_CLOSE);
      old.onopen?.();
      old.onmessage?.({
        data: JSON.stringify({
          type: "TASK_UPDATED",
          projectId: "project-a",
          taskId: "old-task",
        }),
      });
      vi.advanceTimersByTime(30_000);
    });
    expect(
      TestSocket.instances.map((socket) => new URL(socket.url).pathname),
    ).toEqual(["/api/ws/project-a", "/api/ws/project-b"]);
    expect(old.close).toHaveBeenCalledOnce();
    expect(old.send).not.toHaveBeenCalled();
    expect(current.send).toHaveBeenCalledWith('{"type":"ping"}');
    expect(client.invalidateQueries).not.toHaveBeenCalled();
    unmount();
    act(() => current.onclose?.(ABNORMAL_CLOSE));
    expect(current.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels scheduled reconnects on logout and starts a fresh connection on login", () => {
    const { rerender, unmount } = renderHook(() =>
      useProjectWebSocket("project-a"),
    );
    act(() => TestSocket.instances[0].onclose?.(ABNORMAL_CLOSE));
    expect(vi.getTimerCount()).toBe(1);
    auth.userId = null;
    rerender();
    act(() => vi.advanceTimersByTime(60_000));
    expect(TestSocket.instances).toHaveLength(1);
    auth.userId = "user-b";
    rerender();
    expect(TestSocket.instances).toHaveLength(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps reconnecting with a capped backoff and still invalidates on messages", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    for (let retry = 0; retry < 8; retry++) {
      act(() => {
        TestSocket.instances.at(-1)?.onclose?.(ABNORMAL_CLOSE);
        vi.advanceTimersByTime(Math.min(1000 * 2 ** retry, 30_000));
      });
      expect(TestSocket.instances).toHaveLength(retry + 2);
    }
    const last = TestSocket.instances.at(-1);
    act(() => {
      last?.onmessage?.({
        data: JSON.stringify({
          type: "TASK_UPDATED",
          projectId: "project-a",
          taskId: "task-a",
        }),
      });
      last?.onclose?.(ABNORMAL_CLOSE);
      vi.advanceTimersByTime(30_000);
    });
    expect(TestSocket.instances).toHaveLength(10);
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["tasks", "project-a"],
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["task", "task-a"],
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops reconnecting and refetches the project lists when access is revoked", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    act(() => {
      TestSocket.instances[0].onclose?.({ code: 4404 });
      vi.advanceTimersByTime(60_000);
    });
    expect(TestSocket.instances).toHaveLength(1);
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects"],
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refetches columns, tasks and project statistics on COLUMNS_UPDATED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "COLUMNS_UPDATED",
          projectId: "project-a",
        }),
      });
    });
    expect(client.invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
      // Task query results follow the project's changes (B4).
      { predicate: expect.any(Function) },
      { queryKey: ["my-work"] },
      { queryKey: ["columns", "project-a"] },
      { queryKey: ["tasks", "project-a"] },
      { queryKey: ["projects"] },
      { queryKey: ["modules", "project-a", "list"] },
      { queryKey: ["modules", "project-a", "progress"] },
    ]);
    unmount();
  });

  it("refetches the project queries on PROJECT_UPDATED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "PROJECT_UPDATED",
          projectId: "project-a",
        }),
      });
    });
    expect(client.invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
      // Archived projects and their counts (B11).
      { queryKey: ["archives"] },
      // The workspace's trashed projects (C7).
      { queryKey: ["trash"] },
      { queryKey: ["projects"] },
      // Favorites hide archived projects.
      { queryKey: ["favorites"] },
    ]);
    unmount();
  });

  it("refreshes everything showing tasks on TASKS_CHANGED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({ type: "TASKS_CHANGED", projectId: "project-a" }),
      });
    });
    const keys = client.invalidateQueries.mock.calls.map(([arg]) => arg);
    expect(keys).toEqual(
      expect.arrayContaining([
        { predicate: expect.any(Function) },
        { queryKey: ["archives"] },
        { queryKey: ["tasks", "project-a"] },
        { queryKey: ["task"] },
        { queryKey: ["activities"] },
        { queryKey: ["task-relations"] },
        { queryKey: ["projects"] },
        { queryKey: ["cycles", "project-a"] },
      ]),
    );
    unmount();
  });

  it("refetches cycles and favorites on CYCLE_UPDATED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "CYCLE_UPDATED",
          projectId: "project-a",
        }),
      });
    });
    expect(client.invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
      // Task query results follow the project's changes (B4).
      { predicate: expect.any(Function) },
      { queryKey: ["my-work"] },
      { queryKey: ["archives"] },
      { queryKey: ["cycles", "project-a"] },
      { queryKey: ["favorites"] },
    ]);
    unmount();
  });

  it("refetches modules, favorites and activity on MODULE_UPDATED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "MODULE_UPDATED",
          projectId: "project-a",
        }),
      });
    });
    expect(client.invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
      // Task query results follow the project's changes (B4).
      { predicate: expect.any(Function) },
      { queryKey: ["my-work"] },
      { queryKey: ["archives"] },
      { queryKey: ["modules", "project-a"] },
      { queryKey: ["favorites"] },
      { queryKey: ["activities"] },
    ]);
    unmount();
  });

  it("refetches estimate systems and progress totals on ESTIMATE_UPDATED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "ESTIMATE_UPDATED",
          projectId: "project-a",
          taskId: "",
        }),
      });
    });
    expect(client.invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
      { queryKey: ["estimates", "project-a"] },
      { queryKey: ["cycles", "project-a"] },
      { queryKey: ["modules", "project-a", "progress"] },
    ]);
    unmount();
  });

  it("also refetches tasks and activity on ESTIMATE_TASKS_REMAPPED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "ESTIMATE_TASKS_REMAPPED",
          projectId: "project-a",
          taskId: "",
        }),
      });
    });
    expect(client.invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
      // Task query results follow the project's changes (B4).
      { predicate: expect.any(Function) },
      { queryKey: ["my-work"] },
      { queryKey: ["estimates", "project-a"] },
      { queryKey: ["cycles", "project-a"] },
      { queryKey: ["modules", "project-a", "progress"] },
      { queryKey: ["tasks", "project-a"] },
      { queryKey: ["task"] },
      { queryKey: ["activities"] },
    ]);
    unmount();
  });

  it("refreshes an open activity feed on TASK_UPDATED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "TASK_UPDATED",
          projectId: "project-a",
          taskId: "t1",
        }),
      });
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["activities", "t1"],
    });
    unmount();
  });

  it.each([
    ["TASK_LINKS_UPDATED", "task-links"],
    ["TASK_ATTACHMENTS_UPDATED", "task-attachments"],
  ])(
    "refreshes the task panel and history, not the board, on %s",
    (type, key) => {
      const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
      const socket = TestSocket.instances[0];
      act(() => {
        socket.open();
        socket.onmessage?.({
          data: JSON.stringify({ type, projectId: "project-a", taskId: "t1" }),
        });
      });
      expect(client.invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
        { queryKey: [key, "t1"] },
        { queryKey: ["activities", "t1"] },
      ]);
      unmount();
    },
  );

  it("refreshes both tasks' relations and history on TASK_RELATION_UPDATED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "TASK_RELATION_UPDATED",
          projectId: "project-a",
          taskId: "t1",
          sourceTaskId: "t1",
          targetTaskId: "t2",
        }),
      });
    });
    const keys = client.invalidateQueries.mock.calls.map(([arg]) =>
      JSON.stringify(arg.queryKey),
    );
    for (const id of ["t1", "t2"]) {
      expect(keys).toContain(JSON.stringify(["task-relations", id]));
      expect(keys).toContain(JSON.stringify(["activities", id]));
    }
    unmount();
  });

  it("refreshes the history of a task whose labels changed", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "TASK_LABEL_UPDATED",
          projectId: "project-a",
          taskId: "t1",
        }),
      });
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["activities", "t1"],
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["labels", "t1"],
    });
    unmount();
  });

  it("refreshes module counts on task changes and the task map on deletes", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    const send = (type: string) =>
      socket.onmessage?.({
        data: JSON.stringify({ type, projectId: "project-a", taskId: "t1" }),
      });
    const calls = () =>
      client.invalidateQueries.mock.calls.map(([arg]) =>
        JSON.stringify(arg.queryKey),
      );

    act(() => {
      socket.open();
      send("TASK_UPDATED");
    });
    expect(calls()).toEqual(
      expect.arrayContaining([
        JSON.stringify(["modules", "project-a", "list"]),
        JSON.stringify(["modules", "project-a", "detail"]),
        JSON.stringify(["modules", "project-a", "progress"]),
      ]),
    );
    expect(calls()).not.toContain(
      JSON.stringify(["modules", "project-a", "task-map"]),
    );

    client.invalidateQueries.mockClear();
    act(() => send("TASK_DELETED"));
    expect(calls()).toContain(
      JSON.stringify(["modules", "project-a", "task-map"]),
    );
    unmount();
  });

  it("refreshes the intake queue, badge and request on INTAKE_UPDATED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "INTAKE_UPDATED",
          projectId: "project-a",
          taskId: "t1",
        }),
      });
    });
    expect(client.invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
      { queryKey: ["intake-items", "project-a"] },
      { queryKey: ["intake-summary", "project-a"] },
      { queryKey: ["intake-item"] },
      { queryKey: ["intake-item-by-task", "t1"] },
      { queryKey: ["activities", "t1"] },
    ]);
    unmount();
  });

  it("refreshes intake rows when a task changes or goes away", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    const calls = () =>
      client.invalidateQueries.mock.calls.map(([arg]) =>
        JSON.stringify(arg.queryKey),
      );
    for (const type of ["TASK_UPDATED", "TASK_DELETED"]) {
      client.invalidateQueries.mockClear();
      act(() => {
        if (socket.readyState !== 1) socket.open();
        socket.onmessage?.({
          data: JSON.stringify({ type, projectId: "project-a", taskId: "t1" }),
        });
      });
      expect(calls()).toEqual(
        expect.arrayContaining([
          JSON.stringify(["intake-items", "project-a"]),
          JSON.stringify(["intake-summary", "project-a"]),
        ]),
      );
    }
    unmount();
  });
});
