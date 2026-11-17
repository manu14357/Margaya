import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NotificationPauseSettings,
  pauseEndText,
} from "./notification-pause-settings";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

let changed: ((event: { payload: unknown }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, handler: (event: { payload: unknown }) => void) => {
    changed = handler;
    return Promise.resolve(() => {});
  },
}));

describe("NotificationPauseSettings", () => {
  beforeEach(() => {
    invoke.mockReset();
    changed = null;
  });
  afterEach(cleanup);

  it("shows the current choice and pauses for an hour", async () => {
    const until = Date.now() + 60 * 60 * 1000;
    invoke.mockImplementation(async (command: string) =>
      command === "set_notification_pause"
        ? { mode: "hour", until }
        : { mode: "off", until: null },
    );
    render(<NotificationPauseSettings />);
    const select = (await screen.findByLabelText(
      "settings.pauseLabel",
    )) as HTMLSelectElement;
    expect(select.value).toBe("off");
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "off",
      "hour",
      "tomorrow",
      "forever",
    ]);
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.change(select, { target: { value: "hour" } });
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("set_notification_pause", {
      mode: "hour",
    });
    expect(select.value).toBe("hour");
  });

  it("follows a change made from the tray", async () => {
    invoke.mockResolvedValue({ mode: "off", until: null });
    render(<NotificationPauseSettings />);
    const select = (await screen.findByLabelText(
      "settings.pauseLabel",
    )) as HTMLSelectElement;
    act(() => changed?.({ payload: { mode: "forever", until: null } }));
    expect(select.value).toBe("forever");
    expect(screen.getByText("settings.pausedForever")).toBeTruthy();
  });

  it("shows no row with an older core", async () => {
    invoke.mockRejectedValue(new Error("unknown command"));
    const { container } = render(<NotificationPauseSettings />);
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });

  it("names the day only when the pause ends on another day", () => {
    const now = new Date(2026, 10, 17, 15, 0);
    const later = new Date(2026, 10, 17, 16, 30).getTime();
    const tomorrow = new Date(2026, 10, 18, 8, 0).getTime();
    expect(pauseEndText(later, now)).toMatch(/4:30|16:30/);
    expect(pauseEndText(tomorrow, now)).toMatch(/8:00|08:00/);
    expect(pauseEndText(tomorrow, now)).not.toBe(pauseEndText(later, now));
    expect(pauseEndText(tomorrow, now).length).toBeGreaterThan(
      pauseEndText(new Date(2026, 10, 17, 8, 0).getTime(), now).length,
    );
  });
});
