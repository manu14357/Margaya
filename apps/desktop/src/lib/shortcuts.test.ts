import { describe, expect, it } from "vitest";
import { formatAccelerator, recordKey } from "./shortcuts";

const press = (code: string, mods: Partial<Record<string, boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("recordKey", () => {
  it("waits while only modifiers are held", () => {
    expect(recordKey(press("ControlLeft", { ctrlKey: true }))).toEqual({
      kind: "incomplete",
    });
    expect(recordKey(press("ShiftRight", { shiftKey: true })).kind).toBe(
      "incomplete",
    );
  });

  it("cancels on a plain Escape", () => {
    expect(recordKey(press("Escape"))).toEqual({ kind: "cancel" });
    expect(recordKey(press("Escape", { ctrlKey: true })).kind).toBe("done");
  });

  it("builds the core's combination from physical keys", () => {
    expect(
      recordKey(press("KeyK", { ctrlKey: true, shiftKey: true, altKey: true })),
    ).toEqual({ kind: "done", accelerator: "Control+Alt+Shift+KeyK" });
    expect(recordKey(press("Digit1", { metaKey: true }))).toEqual({
      kind: "done",
      accelerator: "Super+Digit1",
    });
    // The core rejects a combination without a modifier, with a message.
    expect(recordKey(press("KeyK"))).toEqual({
      kind: "done",
      accelerator: "KeyK",
    });
  });
});

describe("formatAccelerator", () => {
  it("reads like the platform's own menus", () => {
    expect(formatAccelerator("CommandOrControl+Shift+Space", "windows")).toBe(
      "Ctrl+Shift+Space",
    );
    expect(formatAccelerator("Control+Alt+KeyK", "linux")).toBe("Ctrl+Alt+K");
    expect(formatAccelerator("Super+Digit1", "windows")).toBe("Win+1");
    expect(formatAccelerator("Super+Digit1", "linux")).toBe("Super+1");
    expect(formatAccelerator("CommandOrControl+Shift+K", "macos")).toBe("⌘⇧K");
    expect(formatAccelerator("Control+Alt+ArrowUp", "macos")).toBe("⌃⌥↑");
    expect(formatAccelerator("Control+Shift+Slash", "windows")).toBe(
      "Ctrl+Shift+/",
    );
  });
});
