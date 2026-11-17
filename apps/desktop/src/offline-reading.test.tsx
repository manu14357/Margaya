import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineSettings } from "./components/offline-settings";
import { Offline } from "./offline";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const offlineState = {
  serverName: "Work",
  webUrl: "https://pm.example",
  errorKind: "unreachable",
  attempt: 0,
  retryInMs: 60_000,
};

const summary = {
  kind: "task",
  id: "t1",
  title: "Fix the login",
  workspaceName: "Acme",
  projectName: "Web",
  savedAt: Date.UTC(2026, 10, 16, 9, 30),
};

const item = {
  ...summary,
  path: "/dashboard/workspace/w/project/p/task/t1",
  status: "In progress",
  priority: "High",
  dueDate: "2026-11-20T00:00:00.000Z",
  assignees: ["Ada", "Lin"],
  bodyText:
    "# Steps\nOpen the page\nthen sign in\n- [x] reproduce\n<script>alert(1)</script>",
  updatedAt: null,
};

function answer(overrides: Record<string, unknown> = {}) {
  invoke.mockImplementation(async (command: string) => {
    if (command in overrides) return overrides[command];
    if (command === "offline_state") return offlineState;
    if (command === "offline_items") return [summary];
    if (command === "offline_item") return item;
    if (command === "offline_retry") return null;
    return undefined;
  });
}

describe("Offline reading", () => {
  beforeEach(() => {
    invoke.mockReset();
  });
  afterEach(cleanup);

  it("lists the server's recently opened items", async () => {
    answer();
    render(<Offline />);
    expect(await screen.findByText("offline.recentHeading")).toBeTruthy();
    expect(screen.getByText("Fix the login")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("offline_items");
    // Retry and Switch server stay.
    expect(screen.getByRole("button", { name: "offline.retry" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "offline.switchServer" }),
    ).toBeTruthy();
  });

  it("shows no list when nothing is saved or the core is older", async () => {
    answer({ offline_items: undefined });
    render(<Offline />);
    await screen.findByText("offline.title");
    expect(screen.queryByText("offline.recentHeading")).toBeNull();
  });

  it("opens a saved copy read-only, as text, with Try again at hand", async () => {
    answer();
    const { container } = render(<Offline />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Fix the login/ }),
    );
    expect(await screen.findByText("offline.savedCopy")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("offline_item", {
      kind: "task",
      id: "t1",
    });
    expect(
      screen.getByRole("heading", { level: 1, name: "Fix the login" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Steps" })).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Ada, Lin")).toBeTruthy();
    expect(screen.getByText("reproduce")).toBeTruthy();
    // Markup in the saved text is shown as text, never run or parsed.
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
    // Nothing in a saved copy is editable.
    expect(
      container.querySelector("input, textarea, [contenteditable]"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "offline.retry" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("offline_retry", { manual: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "offline.back" }));
    expect(await screen.findByText("offline.recentHeading")).toBeTruthy();
  });

  it("says when a saved copy is gone", async () => {
    answer({ offline_item: null });
    render(<Offline />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Fix the login/ }),
    );
    expect(await screen.findByText("offline.copyMissing")).toBeTruthy();
  });
});

describe("OfflineSettings", () => {
  beforeEach(() => {
    invoke.mockReset();
  });
  afterEach(cleanup);

  it("turns offline reading off and clears saved copies", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "get_offline_reading" ? { enabled: true } : null,
    );
    render(<OfflineSettings />);
    const toggle = await screen.findByRole("switch", {
      name: "settings.offlineReading",
    });
    await waitFor(() =>
      expect((toggle as HTMLInputElement).checked).toBe(true),
    );
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_offline_reading", {
        enabled: false,
      }),
    );
    expect(await screen.findByText("settings.offlineCleared")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "settings.offlineClear" }),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("clear_offline_copies"),
    );
  });

  it("stays disabled against an older core", async () => {
    // Tauri rejects an unknown command with a string.
    invoke.mockImplementation(() => Promise.reject("unknown command"));
    render(<OfflineSettings />);
    const toggle = screen.getByRole("switch", {
      name: "settings.offlineReading",
    }) as HTMLInputElement;
    await act(async () => {});
    expect(invoke.mock.calls[0]?.[0]).toBe("get_offline_reading");
    expect(toggle.disabled).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
