import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import {
  forgetClosedProjectSockets,
  useProjectWebSocket,
} from "./use-project-websocket";

// The real query client, socket hook and page loader against a fake board of
// 50 pages at 45 ms a page: the sizes measured on a 5,000-task project.
const PAGES = 50;
const server = vi.hoisted(() => ({ version: 0, requests: 0, fail: false }));

vi.mock("@/fetchers/task/get-tasks", async () => {
  const { loadBoardPages } = await import("@/fetchers/task/load-board-pages");
  return {
    default: (projectId: string, signal?: AbortSignal) =>
      loadBoardPages(async (page) => {
        server.requests++;
        const version = server.version;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 45);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        if (server.fail) throw new Error("board failed");
        return {
          data: {
            id: projectId,
            name: `v${version}`,
            columns: [],
            plannedTasks: [],
            archivedTasks: [],
          } as never,
          pagination: {
            page,
            pageSize: 100,
            totalPages: 50,
            total: 5000,
          },
        };
      }, signal) as never,
  };
});
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user" } } }) },
}));
vi.mock("@margaya/libs", () => ({ windowId: "local-test" }));

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(public url: string) {
    TestSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

function latestSocket() {
  const socket = TestSocket.instances.at(-1);
  if (!socket) throw new Error("no socket");
  return socket;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Another user's change: the server's data moves on and a hint goes out. */
function colleagueEdits(type = "TASK_UPDATED") {
  server.version++;
  latestSocket().onmessage?.({
    data: JSON.stringify({ type, projectId: "p", taskId: "t" }),
  });
}

async function openBoard({ live = true } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(
    () => {
      useProjectWebSocket("p");
      return useGetTasks("p");
    },
    { wrapper },
  );
  if (live) {
    await act(async () => {
      latestSocket().open();
    });
  }
  await advance(1_000);
  server.requests = 0;
  return hook;
}

describe("board refresh load", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
    TestSocket.instances = [];
    server.version = 0;
    server.requests = 0;
    server.fail = false;
    forgetClosedProjectSockets();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not reload an idle board every 30 seconds while the socket is live", async () => {
    await openBoard();
    await advance(4 * 60_000);
    expect(server.requests).toBe(0);
    // The slow safety reload still covers changes that send no message.
    await advance(61_000);
    expect(server.requests).toBe(PAGES);
  });

  it("shows a colleague's change promptly, with one reload", async () => {
    const { result } = await openBoard();
    await act(async () => colleagueEdits());
    await advance(1_000);
    expect(result.current.data?.name).toBe("v1");
    expect(server.requests).toBe(PAGES);
  });

  it("turns a bulk edit of 50 tasks into two reloads and ends on the latest data", async () => {
    const { result } = await openBoard();
    for (let task = 0; task < 50; task++) {
      await act(async () => {
        colleagueEdits();
        await vi.advanceTimersByTimeAsync(20);
      });
    }
    await advance(10_000);
    expect(result.current.data?.name).toBe("v50");
    expect(server.requests).toBe(2 * PAGES);
  });

  it("keeps updating the board during steady edits, at a bounded rate", async () => {
    const { result } = await openBoard();
    // An edit every 300 ms is shorter than a reload (about 600 ms here), so
    // each one used to restart the reload and the board never changed.
    for (let edit = 0; edit < 200; edit++) {
      await act(async () => {
        colleagueEdits();
        await vi.advanceTimersByTimeAsync(300);
      });
    }
    const version = Number(result.current.data?.name.slice(1));
    expect(version).toBeGreaterThan(180);
    expect(server.requests).toBeLessThan(25 * PAGES);
    await advance(10_000);
    expect(result.current.data?.name).toBe("v200");
  });

  it("does not reload the board for comments", async () => {
    await openBoard();
    for (let comment = 0; comment < 20; comment++) {
      await act(async () => {
        colleagueEdits("COMMENT_UPDATED");
        await vi.advanceTimersByTimeAsync(1_000);
      });
    }
    expect(server.requests).toBe(0);
  });

  it("falls back to polling every 30 seconds while the socket is down", async () => {
    const { result } = await openBoard();
    await act(async () => latestSocket().onclose?.({ code: 1006 }));
    server.version = 7;
    await advance(31_000);
    expect(result.current.data?.name).toBe("v7");
    expect(server.requests).toBe(PAGES);
    await advance(31_000);
    expect(server.requests).toBe(2 * PAGES);
  });

  it("catches up on reconnecting, then stops polling quickly again", async () => {
    const { result } = await openBoard();
    await act(async () => latestSocket().onclose?.({ code: 1006 }));
    server.version = 3;
    await advance(1_000);
    expect(TestSocket.instances).toHaveLength(2);
    await act(async () => latestSocket().open());
    await advance(1_000);
    expect(result.current.data?.name).toBe("v3");
    server.requests = 0;
    await advance(4 * 60_000);
    expect(server.requests).toBe(0);
  });

  it("polls without a connected socket, as before", async () => {
    const { result } = await openBoard({ live: false });
    server.version = 2;
    await advance(31_000);
    expect(result.current.data?.name).toBe("v2");
  });

  it("retries a failed board on the quick interval even with a live socket", async () => {
    const { result } = await openBoard();
    server.fail = true;
    await act(async () => colleagueEdits());
    await advance(1_000);
    expect(result.current.error).toBeTruthy();
    server.fail = false;
    await advance(31_000);
    expect(result.current.error).toBeNull();
    expect(result.current.data?.name).toBe("v1");
  });

  it("holds a hidden tab's reloads until the tab is visible again", async () => {
    const { result } = await openBoard();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    for (let edit = 0; edit < 10; edit++) {
      await act(async () => {
        colleagueEdits();
        await vi.advanceTimersByTimeAsync(5_000);
      });
    }
    expect(server.requests).toBe(0);
    expect(result.current.data?.name).toBe("v0");

    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(1_000);
    expect(result.current.data?.name).toBe("v10");
    expect(server.requests).toBe(PAGES);
  });
});
