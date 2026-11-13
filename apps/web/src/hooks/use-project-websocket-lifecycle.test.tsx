import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isProjectSocketLive } from "@/lib/project-realtime";
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

/** Lets the batched refreshes (board, task lists, planning) run. */
function runBatchedRefreshes() {
  act(() => {
    vi.advanceTimersByTime(250);
  });
}

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

  it("refetches columns, tasks, project statistics and planning on COLUMNS_UPDATED", () => {
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
    runBatchedRefreshes();
    expect(client.invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
      // A deleted column's archived tasks move to another column.
      { queryKey: ["archives"] },
      { queryKey: ["columns", "project-a"] },
      { queryKey: ["projects"] },
      // Task query results follow the project's changes (B4).
      { predicate: expect.any(Function) },
      { queryKey: ["my-work"] },
      { queryKey: ["tasks", "project-a"] },
      // A column's group decides which tasks count as open or done.
      { queryKey: ["cycles", "project-a"] },
      { queryKey: ["modules", "project-a", "list"] },
      { queryKey: ["modules", "project-a", "detail"] },
      { queryKey: ["modules", "project-a", "progress"] },
      { queryKey: ["delivery", "project-a"] },
      { queryKey: ["delivery-home"] },
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
      // Favorites and recents hide archived projects.
      { queryKey: ["favorites"] },
      { queryKey: ["recent-visits"] },
    ]);
    // Board cards show the project's key.
    runBatchedRefreshes();
    expect(client.invalidateQueries).toHaveBeenLastCalledWith({
      queryKey: ["tasks", "project-a"],
    });
    unmount();
  });

  it("refetches the project's custom field values on CUSTOM_FIELD_VALUES_UPDATED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      for (let i = 0; i < 3; i += 1) {
        socket.onmessage?.({
          data: JSON.stringify({
            type: "CUSTOM_FIELD_VALUES_UPDATED",
            projectId: "project-a",
          }),
        });
      }
    });
    expect(client.invalidateQueries).not.toHaveBeenCalled();
    runBatchedRefreshes();
    // Board cards and backlog rows read the project's values; a burst of
    // edits refreshes them once.
    expect(client.invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
      { queryKey: ["custom-field-values", "project-a"] },
      { queryKey: ["custom-field-filter-values", "project-a"] },
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
    runBatchedRefreshes();
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

  it("refetches fields, values and task lists on CUSTOM_FIELDS_UPDATED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "CUSTOM_FIELDS_UPDATED",
          projectId: "project-a",
          taskId: "",
        }),
      });
    });
    runBatchedRefreshes();
    const keys = client.invalidateQueries.mock.calls.map(([arg]) => arg);
    expect(keys).toEqual(
      expect.arrayContaining([
        { predicate: expect.any(Function) },
        { queryKey: ["custom-fields", "project-a"] },
        { queryKey: ["custom-field-values"] },
        { queryKey: ["custom-field-filter-values", "project-a"] },
      ]),
    );
    unmount();
  });

  it("refetches an open task's values on TASK_UPDATED", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "TASK_UPDATED",
          projectId: "project-a",
          taskId: "task-1",
        }),
      });
    });
    const keys = client.invalidateQueries.mock.calls.map(([arg]) => arg);
    expect(keys).toContainEqual({
      queryKey: ["custom-field-values", "task-1"],
    });
    unmount();
  });

  it("refetches cycles, favorites, forecasts and risks on CYCLE_UPDATED", () => {
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
    runBatchedRefreshes();
    expect(client.invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
      { queryKey: ["archives"] },
      { queryKey: ["favorites"] },
      // Task query results follow the project's changes (B4).
      { predicate: expect.any(Function) },
      { queryKey: ["my-work"] },
      // A cycle's end date and tasks feed its forecast and risks.
      { queryKey: ["cycles", "project-a"] },
      { queryKey: ["modules", "project-a", "list"] },
      { queryKey: ["modules", "project-a", "detail"] },
      { queryKey: ["modules", "project-a", "progress"] },
      { queryKey: ["delivery", "project-a"] },
      { queryKey: ["delivery-home"] },
    ]);
    unmount();
  });

  it("refreshes a cycle's forecast once when its tasks change", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    const send = (data: object) =>
      socket.onmessage?.({
        data: JSON.stringify({ projectId: "project-a", ...data }),
      });
    act(() => {
      socket.open();
      // A membership change: the cycle hint and one hint per task.
      send({ type: "CYCLE_UPDATED" });
      send({ type: "TASK_UPDATED", taskId: "t1" });
      send({ type: "TASK_UPDATED", taskId: "t2" });
    });
    runBatchedRefreshes();
    const delivery = client.invalidateQueries.mock.calls.filter(
      ([arg]) => JSON.stringify(arg.queryKey) === '["delivery","project-a"]',
    );
    expect(delivery).toHaveLength(1);
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
    runBatchedRefreshes();
    expect(client.invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
      { queryKey: ["archives"] },
      { queryKey: ["modules", "project-a"] },
      { queryKey: ["favorites"] },
      { queryKey: ["activities"] },
      // A module's target date and tasks feed its forecast and risks.
      { queryKey: ["delivery", "project-a"] },
      { queryKey: ["delivery-home"] },
      // Task query results follow the project's changes (B4).
      { predicate: expect.any(Function) },
      { queryKey: ["my-work"] },
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
    runBatchedRefreshes();
    expect(client.invalidateQueries.mock.calls.map(([arg]) => arg)).toEqual([
      { queryKey: ["estimates", "project-a"] },
      { queryKey: ["cycles", "project-a"] },
      { queryKey: ["modules", "project-a", "progress"] },
      { queryKey: ["task"] },
      { queryKey: ["activities"] },
      // Task query results follow the project's changes (B4).
      { predicate: expect.any(Function) },
      { queryKey: ["my-work"] },
      { queryKey: ["tasks", "project-a"] },
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

  it("refreshes the one task a cross-project relation message names, and the timeline", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "TASK_RELATION_UPDATED",
          projectId: "project-a",
          taskId: "t2",
          targetTaskId: "t2",
        }),
      });
    });
    const keys = client.invalidateQueries.mock.calls.map(([arg]) =>
      JSON.stringify(arg.queryKey),
    );
    for (const key of ["task", "task-relations", "activities"]) {
      expect(keys).toContain(JSON.stringify([key, "t2"]));
    }
    expect(keys).toContain(JSON.stringify(["task-relations", "project"]));
    // Knowing the side it names, it doesn't refresh every open task's relations.
    expect(keys).not.toContain(JSON.stringify(["task-relations"]));
    expect(keys.join()).not.toContain("undefined");
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
    runBatchedRefreshes();
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

  it("batches a burst of task messages while one task's queries stay immediate", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    const boardRefreshes = () =>
      client.invalidateQueries.mock.calls.filter(
        ([arg]) => JSON.stringify(arg.queryKey) === '["tasks","project-a"]',
      ).length;
    act(() => {
      socket.open();
      for (let task = 0; task < 50; task++) {
        socket.onmessage?.({
          data: JSON.stringify({
            type: "TASK_UPDATED",
            projectId: "project-a",
            taskId: `t${task}`,
          }),
        });
      }
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["task", "t49"],
    });
    expect(boardRefreshes()).toBe(0);
    runBatchedRefreshes();
    expect(boardRefreshes()).toBe(1);
    unmount();
  });

  it("does not reload the board or planning totals for a comment", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    act(() => {
      socket.open();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "COMMENT_UPDATED",
          projectId: "project-a",
          taskId: "t1",
        }),
      });
    });
    runBatchedRefreshes();
    const keys = client.invalidateQueries.mock.calls.map(([arg]) =>
      JSON.stringify(arg.queryKey),
    );
    expect(keys).toContain(JSON.stringify(["comments", "t1"]));
    expect(keys).not.toContain(JSON.stringify(["tasks", "project-a"]));
    expect(keys).not.toContain(JSON.stringify(["cycles", "project-a"]));
    unmount();
  });

  it("leaves no refresh waiting after unmount, and catches up on reopening", () => {
    const first = renderHook(() => useProjectWebSocket("project-a"));
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
    client.invalidateQueries.mockClear();
    first.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(client.invalidateQueries).not.toHaveBeenCalled();

    const second = renderHook(() => useProjectWebSocket("project-a"));
    act(() => TestSocket.instances[1]?.open());
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["tasks", "project-a"],
    });
    second.unmount();
  });

  it("reports the socket as live only while it is connected", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    const socket = TestSocket.instances[0];
    expect(isProjectSocketLive("project-a")).toBe(false);
    act(() => socket.open());
    expect(isProjectSocketLive("project-a")).toBe(true);
    act(() => socket.onclose?.(ABNORMAL_CLOSE));
    expect(isProjectSocketLive("project-a")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1000);
      TestSocket.instances[1]?.open();
    });
    expect(isProjectSocketLive("project-a")).toBe(true);
    unmount();
    expect(isProjectSocketLive("project-a")).toBe(false);
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
