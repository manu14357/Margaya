import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canOpenInNewWindow,
  isNewWindowClick,
  openInNewWindow,
  openInNewWindowOnClick,
} from "./desktop-new-window";

type TestWindow = Window & { __MARGAYA_DESKTOP__?: unknown };

function withBridge() {
  (window as TestWindow).__MARGAYA_DESKTOP__ = { version: "1.0.0" };
}

function click(init: Partial<MouseEvent> = {}) {
  return {
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...init,
  };
}

afterEach(() => {
  delete (window as TestWindow).__MARGAYA_DESKTOP__;
  vi.restoreAllMocks();
});

describe("open in new window", () => {
  it("is offered only inside the desktop app", () => {
    expect(canOpenInNewWindow()).toBe(false);
    withBridge();
    expect(canOpenInNewWindow()).toBe(true);
  });

  it("does nothing in a browser", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    expect(openInNewWindow("/dashboard/workspace/w/project/p/board")).toBe(
      false,
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("opens a page of this server in another window", () => {
    withBridge();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    expect(openInNewWindow("/dashboard/workspace/w/project/p/task/t?x=1")).toBe(
      true,
    );
    expect(open).toHaveBeenCalledWith(
      `${window.location.origin}/dashboard/workspace/w/project/p/task/t?x=1`,
      "_blank",
    );
  });

  it("refuses anything that leaves this server", () => {
    withBridge();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    for (const path of [
      "https://elsewhere.example/x",
      "//elsewhere.example/x",
      "/\\elsewhere.example",
      "javascript:alert(1)",
      "dashboard",
      "",
    ]) {
      expect(openInNewWindow(path), path).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it("treats Shift+click and a middle click as new-window clicks", () => {
    expect(isNewWindowClick(click({ shiftKey: true }))).toBe(true);
    expect(isNewWindowClick(click({ button: 1 }))).toBe(true);
    expect(isNewWindowClick(click())).toBe(false);
    // Ctrl/Cmd+click selects cards; other buttons and chords are not ours.
    expect(isNewWindowClick(click({ ctrlKey: true }))).toBe(false);
    expect(isNewWindowClick(click({ shiftKey: true, metaKey: true }))).toBe(
      false,
    );
    expect(isNewWindowClick(click({ shiftKey: true, altKey: true }))).toBe(
      false,
    );
    expect(isNewWindowClick(click({ button: 2, shiftKey: true }))).toBe(false);
  });

  it("opens on a new-window click only in the desktop app", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const browserClick = click({ shiftKey: true });
    expect(openInNewWindowOnClick(browserClick, "/dashboard")).toBe(false);
    expect(browserClick.preventDefault).not.toHaveBeenCalled();

    withBridge();
    const plain = click();
    expect(openInNewWindowOnClick(plain, "/dashboard")).toBe(false);
    expect(open).not.toHaveBeenCalled();

    const middle = click({ button: 1 });
    expect(openInNewWindowOnClick(middle, "/dashboard")).toBe(true);
    expect(middle.preventDefault).toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
  });
});
