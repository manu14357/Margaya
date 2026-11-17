import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShortcutView } from "../lib/ipc";
import { ShortcutSettings } from "./shortcut-settings";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

const initial: ShortcutView[] = [
  {
    action: "quickAdd",
    accelerator: "CommandOrControl+Shift+Space",
    defaultAccelerator: "CommandOrControl+Shift+Space",
    active: true,
  },
  {
    action: "search",
    accelerator: "Control+Alt+KeyF",
    defaultAccelerator: "CommandOrControl+Shift+K",
    active: false,
  },
  {
    action: "screenshot",
    accelerator: "CommandOrControl+Shift+Alt+S",
    defaultAccelerator: "CommandOrControl+Shift+Alt+S",
    active: true,
  },
  {
    action: "today",
    accelerator: null,
    defaultAccelerator: null,
    active: false,
  },
];

function answer(setShortcut: (args: unknown) => unknown) {
  invoke.mockImplementation(async (command: string, args: unknown) => {
    if (command === "get_shortcuts") return initial;
    if (command === "pause_shortcuts") return initial;
    if (command === "set_shortcut") return setShortcut(args);
    if (command === "reset_shortcut")
      return initial.map((row) =>
        row.action === "search"
          ? { ...row, accelerator: row.defaultAccelerator, active: true }
          : row,
      );
    throw new Error(`unexpected command ${command}`);
  });
}

function row(action: string) {
  const element = document.querySelector(`[data-action="${action}"]`);
  if (!element) throw new Error(`no row for ${action}`);
  return element as HTMLElement;
}

describe("ShortcutSettings", () => {
  beforeEach(() => {
    invoke.mockReset();
  });
  afterEach(cleanup);

  it("lists every action with its keys, unset and unavailable states", async () => {
    answer(() => initial);
    render(<ShortcutSettings platform="windows" />);
    await screen.findByText("settings.shortcutsHeading");
    expect(row("quickAdd").textContent).toContain("Ctrl+Shift+Space");
    expect(row("search").textContent).toContain("settings.shortcutInactive");
    expect(row("today").textContent).toContain("settings.shortcutNone");
    // Reset is off where the default is in use; Clear where nothing is set.
    const reset = row("quickAdd").querySelectorAll("button")[2];
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    const clear = row("today").querySelectorAll("button")[1];
    expect((clear as HTMLButtonElement).disabled).toBe(true);
  });

  it("records a new combination with the shortcuts released", async () => {
    answer((args) =>
      initial.map((item) =>
        item.action === "today"
          ? {
              ...item,
              accelerator: (args as { accelerator: string }).accelerator,
              active: true,
            }
          : item,
      ),
    );
    render(<ShortcutSettings platform="windows" />);
    await screen.findByText("settings.shortcutsHeading");
    const recorder = row("today").querySelector("button") as HTMLButtonElement;
    fireEvent.click(recorder);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pause_shortcuts", { paused: true }),
    );
    expect(recorder.textContent).toBe("settings.shortcutRecording");
    // Modifiers alone keep it waiting.
    fireEvent.keyDown(recorder, { code: "ControlLeft", ctrlKey: true });
    expect(invoke).not.toHaveBeenCalledWith("set_shortcut", expect.anything());
    fireEvent.keyDown(recorder, { code: "KeyY", ctrlKey: true, altKey: true });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_shortcut", {
        action: "today",
        accelerator: "Control+Alt+KeyY",
      }),
    );
    expect(await screen.findByText("Ctrl+Alt+Y")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "settings.shortcutSaved",
    );
  });

  it("keeps the previous combination and says why when the system refuses", async () => {
    answer(() => {
      throw { kind: "shortcutTaken", message: "refused" };
    });
    render(<ShortcutSettings platform="windows" />);
    await screen.findByText("settings.shortcutsHeading");
    const recorder = row("quickAdd").querySelector(
      "button",
    ) as HTMLButtonElement;
    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, { code: "KeyJ", ctrlKey: true, altKey: true });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "errors.shortcutTaken",
    );
    expect(row("quickAdd").textContent).toContain("Ctrl+Shift+Space");
    // The shortcuts are taken back after the failed try.
    expect(invoke).toHaveBeenCalledWith("pause_shortcuts", { paused: false });
  });

  it("cancels recording on Escape", async () => {
    answer(() => initial);
    render(<ShortcutSettings platform="windows" />);
    await screen.findByText("settings.shortcutsHeading");
    const recorder = row("search").querySelector("button") as HTMLButtonElement;
    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, { code: "Escape" });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pause_shortcuts", { paused: false }),
    );
    expect(invoke).not.toHaveBeenCalledWith("set_shortcut", expect.anything());
    expect(recorder.textContent).toBe("settings.shortcutChange");
  });

  it("clears and resets", async () => {
    answer(() => initial);
    render(<ShortcutSettings platform="windows" />);
    await screen.findByText("settings.shortcutsHeading");
    fireEvent.click(row("search").querySelectorAll("button")[1] as HTMLElement);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_shortcut", {
        action: "search",
        accelerator: null,
      }),
    );
    fireEvent.click(row("search").querySelectorAll("button")[2] as HTMLElement);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("reset_shortcut", {
        action: "search",
      }),
    );
    expect(await screen.findByText("Ctrl+Shift+K")).toBeTruthy();
  });

  it("stays hidden with an older core", async () => {
    invoke.mockRejectedValue(new Error("unknown command"));
    const { container } = render(<ShortcutSettings platform="windows" />);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
