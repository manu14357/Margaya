import { describe, expect, it } from "vitest";
import {
  isWriteAction,
  type KeyInput,
  resolveKey,
  SHORTCUT_SECTIONS,
} from "./shortcuts";

const pc = (input: KeyInput) => resolveKey(input, false);
const mac = (input: KeyInput) => resolveKey(input, true);

describe("keyboard shortcuts", () => {
  it("uses Ctrl on Windows and Linux, and Cmd on a Mac", () => {
    expect(pc({ key: "z", ctrlKey: true })).toEqual({
      kind: "command",
      command: "undo",
    });
    expect(mac({ key: "z", metaKey: true })).toEqual({
      kind: "command",
      command: "undo",
    });
    // Ctrl+Z on a Mac is left to the system.
    expect(mac({ key: "z", ctrlKey: true })).toBeNull();
  });

  it("tells undo and redo apart", () => {
    expect(pc({ key: "Z", ctrlKey: true, shiftKey: true })).toEqual({
      kind: "command",
      command: "redo",
    });
    expect(pc({ key: "y", ctrlKey: true })).toEqual({
      kind: "command",
      command: "redo",
    });
  });

  it("picks tools with single keys and layout-independent digits", () => {
    expect(pc({ key: "r", code: "KeyR" })).toEqual({
      kind: "tool",
      tool: "rectangle",
    });
    expect(pc({ key: "&", code: "Digit1" })).toEqual({
      kind: "tool",
      tool: "select",
    });
    expect(pc({ key: "r", code: "KeyR", ctrlKey: true })).toBeNull();
  });

  it("zooms to fit and to the selection with Shift+1 and Shift+2", () => {
    expect(pc({ key: "!", code: "Digit1", shiftKey: true })).toEqual({
      kind: "command",
      command: "zoomFit",
    });
    expect(pc({ key: "@", code: "Digit2", shiftKey: true })).toEqual({
      kind: "command",
      command: "zoomSelection",
    });
  });

  it("nudges with the arrows, ten units with Shift, and adds flowchart nodes with Ctrl", () => {
    expect(pc({ key: "ArrowLeft" })).toEqual({ kind: "nudge", dx: -1, dy: 0 });
    expect(pc({ key: "ArrowDown", shiftKey: true })).toEqual({
      kind: "nudge",
      dx: 0,
      dy: 10,
    });
    expect(pc({ key: "ArrowRight", ctrlKey: true })).toEqual({
      kind: "flowchart",
      direction: "right",
    });
    expect(pc({ key: "ArrowUp", ctrlKey: true, shiftKey: true })).toEqual({
      kind: "command",
      command: "alignTop",
    });
  });

  it("maps the layer, group and clipboard shortcuts", () => {
    expect(pc({ key: "]", code: "BracketRight", ctrlKey: true })).toEqual({
      kind: "command",
      command: "bringForward",
    });
    expect(
      pc({ key: "}", code: "BracketRight", ctrlKey: true, shiftKey: true }),
    ).toEqual({
      kind: "command",
      command: "bringToFront",
    });
    expect(pc({ key: "g", ctrlKey: true })).toEqual({
      kind: "command",
      command: "group",
    });
    expect(pc({ key: "G", ctrlKey: true, shiftKey: true })).toEqual({
      kind: "command",
      command: "ungroup",
    });
    expect(pc({ key: "d", ctrlKey: true })).toEqual({
      kind: "command",
      command: "duplicate",
    });
    expect(pc({ key: "Delete" })).toEqual({
      kind: "command",
      command: "delete",
    });
    expect(pc({ key: "f", ctrlKey: true })).toEqual({
      kind: "command",
      command: "search",
    });
    expect(pc({ key: "?", shiftKey: true })).toEqual({
      kind: "command",
      command: "help",
    });
    expect(pc({ key: "q" })).toEqual({
      kind: "command",
      command: "toggleToolLock",
    });
  });

  it("matches Alt shortcuts by key code, which Option changes on a Mac", () => {
    expect(mac({ key: "ß", code: "KeyS", altKey: true })).toEqual({
      kind: "command",
      command: "toggleSnap",
    });
  });

  it("marks the shortcuts that change the board", () => {
    expect(isWriteAction({ kind: "command", command: "delete" })).toBe(true);
    expect(isWriteAction({ kind: "command", command: "undo" })).toBe(true);
    expect(isWriteAction({ kind: "nudge", dx: 1, dy: 0 })).toBe(true);
    expect(isWriteAction({ kind: "command", command: "copy" })).toBe(false);
    expect(isWriteAction({ kind: "command", command: "zoomIn" })).toBe(false);
    expect(isWriteAction({ kind: "tool", tool: "rectangle" })).toBe(false);
  });

  it("lists every shortcut in the help dialog with a translation key", () => {
    const rows = SHORTCUT_SECTIONS.flatMap((section) => section.rows);
    expect(rows.length).toBeGreaterThan(40);
    for (const row of rows) {
      expect(row.labelKey.startsWith("whiteboardEditor:")).toBe(true);
      expect(row.keys.length).toBeGreaterThan(0);
    }
  });
});
