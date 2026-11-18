import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TODAY_REFRESH_MS, Today } from "./today";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
const listeners = new Map<string, () => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: () => void) => {
    listeners.set(event, handler);
    return () => listeners.delete(event);
  },
}));

const server = (id: string, signedIn: boolean) => ({
  id,
  label: `Server ${id}`,
  webUrl: `https://${id}.example`,
  apiUrl: `https://${id}.example`,
  serverVersion: "1.0.0",
  signedIn,
  unread: 0,
  insecure: false,
  lastUsedAt: null,
});

const task = (id: string, title: string, overdue: boolean) => ({
  serverId: "a",
  serverLabel: "Server a",
  workspaceId: "w1",
  workspaceName: "Team",
  id,
  projectId: "p1",
  projectName: "Web",
  key: `WEB-${id}`,
  title,
  dueDate: overdue ? "2026-11-10T09:00:00.000Z" : "2026-11-17T09:00:00.000Z",
  overdue,
  priority: "high",
  path: `/dashboard/workspace/w1/project/p1/task/${id}`,
});

const tasks = {
  tasks: [task("1", "Late report", true), task("2", "Ship today", false)],
  unavailable: [],
};

function todayCalls() {
  return invoke.mock.calls.filter(([name]) => name === "today_tasks").length;
}

describe("Today", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "list_servers":
          return [server("a", true)];
        case "today_tasks":
          return tasks;
        default:
          return undefined;
      }
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("lists overdue tasks before today's", async () => {
    render(<Today />);
    const overdue = await screen.findByRole("region", {
      name: /today\.overdue/,
    });
    expect(overdue.textContent).toContain("Late report");
    const due = screen.getByRole("region", { name: /today\.dueToday/ });
    expect(due.textContent).toContain("Ship today");
    expect(due.textContent).not.toContain("Late report");
  });

  it("marks a task done and drops it from the list", async () => {
    render(<Today />);
    await screen.findByText("Late report");
    const [first] = screen.getAllByRole("checkbox", {
      name: "today.markDone",
    });
    fireEvent.click(first as HTMLElement);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("today_complete", {
        serverId: "a",
        taskId: "1",
        projectId: "p1",
      }),
    );
    await vi.waitFor(() =>
      expect(screen.queryByText("Late report")).toBeNull(),
    );
    expect(screen.getByText("Ship today")).toBeTruthy();
  });

  it("keeps the task and says so when it can't be marked done", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "list_servers") return [server("a", true)];
      if (command === "today_tasks") return tasks;
      if (command === "today_complete")
        throw { kind: "quickAddFailed", message: "403" };
      return undefined;
    });
    render(<Today />);
    await screen.findByText("Late report");
    fireEvent.click(screen.getAllByRole("checkbox")[0] as HTMLElement);
    expect(await screen.findByText("today.completeFailed")).toBeTruthy();
    expect(screen.getByText("Late report")).toBeTruthy();
  });

  it("opens a task in its server window", async () => {
    render(<Today />);
    fireEvent.click(await screen.findByRole("button", { name: /Ship today/ }));
    expect(invoke).toHaveBeenCalledWith("today_open", {
      serverId: "a",
      path: "/dashboard/workspace/w1/project/p1/task/2",
    });
  });

  it("refreshes on focus and every five minutes, and hides on Escape", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Today />);
    await screen.findByText("Late report");
    expect(todayCalls()).toBe(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await vi.waitFor(() => expect(todayCalls()).toBe(2));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODAY_REFRESH_MS);
    });
    await vi.waitFor(() => expect(todayCalls()).toBe(3));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(invoke).toHaveBeenCalledWith("close_today");
  });

  it("stops refreshing while hidden and refreshes once when shown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Today />);
    await screen.findByText("Late report");
    await vi.waitFor(() => expect(listeners.has("today-hidden")).toBe(true));
    expect(todayCalls()).toBe(1);

    act(() => listeners.get("today-hidden")?.());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODAY_REFRESH_MS * 3);
    });
    expect(todayCalls()).toBe(1);

    await act(async () => {
      listeners.get("today-refresh")?.();
    });
    await vi.waitFor(() => expect(todayCalls()).toBe(2));
    // The timer runs again from the moment it showed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODAY_REFRESH_MS);
    });
    await vi.waitFor(() => expect(todayCalls()).toBe(3));
  });

  it("shows empty and signed-out states", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "list_servers"
        ? [server("a", true)]
        : { tasks: [], unavailable: ["Server b"] },
    );
    render(<Today />);
    expect(await screen.findByText("today.empty")).toBeTruthy();
    expect(screen.getByText("today.unavailable")).toBeTruthy();
    cleanup();

    invoke.mockReset();
    invoke.mockImplementation(async (command: string) =>
      command === "list_servers" ? [server("a", false)] : undefined,
    );
    render(<Today />);
    expect(await screen.findByText("today.noServers")).toBeTruthy();
    expect(invoke).not.toHaveBeenCalledWith("today_tasks");
  });
});
