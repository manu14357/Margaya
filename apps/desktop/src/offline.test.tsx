import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Offline } from "./offline";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const state = (attempt: number, retryInMs: number) => ({
  serverName: "Work",
  webUrl: "https://pm.example",
  errorKind: "unreachable",
  attempt,
  retryInMs,
});

describe("Offline", () => {
  beforeEach(() => {
    invoke.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the server, the last error and a countdown", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "offline_state" ? state(0, 5000) : undefined,
    );
    render(<Offline />);
    expect(await screen.findByText("offline.title")).toBeTruthy();
    expect(screen.getByText("https://pm.example")).toBeTruthy();
    expect(screen.getByText("offline.lastError")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("offline.retryIn");
    // The page sets the window title in an effect after it renders.
    await waitFor(() => expect(document.title).toBe("Work"));
  });

  it("retries on its own and keeps waiting while the server is down", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    invoke.mockImplementation(async (command: string) => {
      if (command === "offline_state") return state(0, 2000);
      if (command === "offline_retry") return state(1, 5000);
      return undefined;
    });
    render(<Offline />);
    await screen.findByText("offline.title");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(invoke).toHaveBeenCalledWith("offline_retry", { manual: false });
    // The next wait comes from the core's backoff, not a fixed timer.
    const automatic = invoke.mock.calls.filter(
      ([command]) => command === "offline_retry",
    );
    expect(automatic).toHaveLength(1);
  });

  it("reloads the server on Try again and opens the server list", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "offline_state") return state(2, 60_000);
      if (command === "offline_retry") return null;
      return undefined;
    });
    render(<Offline />);
    fireEvent.click(
      await screen.findByRole("button", { name: "offline.retry" }),
    );
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("offline_retry", { manual: true }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "offline.switchServer" }),
    );
    expect(invoke).toHaveBeenCalledWith("show_servers");
  });
});
