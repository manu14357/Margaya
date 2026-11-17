import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installDesktopFileDropGuard } from "./desktop-file-drop";

type TestWindow = Window & { __MARGAYA_DESKTOP__?: unknown };

/** jsdom has no DragEvent or DataTransfer: a cancelable event carrying both. */
function drag(
  type: "dragover" | "drop",
  types: string[],
  target: Element = document.body,
) {
  const dataTransfer = { types, dropEffect: "copy" };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  target.dispatchEvent(event);
  return { event, dataTransfer };
}

let uninstall: () => void = () => {};

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  uninstall();
  delete (window as TestWindow).__MARGAYA_DESKTOP__;
});

describe("installDesktopFileDropGuard", () => {
  it("does nothing in a browser", () => {
    uninstall = installDesktopFileDropGuard();
    expect(drag("dragover", ["Files"]).event.defaultPrevented).toBe(false);
    expect(drag("drop", ["Files"]).event.defaultPrevented).toBe(false);
  });

  describe("in the desktop app", () => {
    beforeEach(() => {
      (window as TestWindow).__MARGAYA_DESKTOP__ = { version: "1.0.0" };
      uninstall = installDesktopFileDropGuard();
    });

    it("stops a file dropped where nothing takes it from opening", () => {
      const over = drag("dragover", ["Files"]);
      expect(over.event.defaultPrevented).toBe(true);
      expect(over.dataTransfer.dropEffect).toBe("none");
      expect(drag("drop", ["Files"]).event.defaultPrevented).toBe(true);
    });

    it("leaves drags without files alone (board cards, text)", () => {
      expect(drag("dragover", ["text/plain"]).event.defaultPrevented).toBe(
        false,
      );
      expect(drag("drop", ["text/plain"]).event.defaultPrevented).toBe(false);
    });

    it("lets a drop zone that took the drag keep it", () => {
      const zone = document.createElement("div");
      document.body.append(zone);
      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        (
          event as unknown as { dataTransfer: DataTransfer }
        ).dataTransfer.dropEffect = "copy";
      });
      const over = drag("dragover", ["Files"], zone);
      expect(over.dataTransfer.dropEffect).toBe("copy");
    });

    it("lets editors and fields decide while hovered, but never open the file", () => {
      const editor = document.createElement("div");
      editor.setAttribute("contenteditable", "true");
      const child = document.createElement("p");
      editor.append(child);
      document.body.append(editor);
      const over = drag("dragover", ["Files"], child);
      expect(over.event.defaultPrevented).toBe(false);
      expect(over.dataTransfer.dropEffect).toBe("copy");
      expect(drag("drop", ["Files"], child).event.defaultPrevented).toBe(true);
    });

    it("leaves a file input's own drop alone", () => {
      const input = document.createElement("input");
      input.type = "file";
      document.body.append(input);
      expect(drag("drop", ["Files"], input).event.defaultPrevented).toBe(false);
    });

    it("stops after uninstalling", () => {
      uninstall();
      uninstall = () => {};
      expect(drag("drop", ["Files"]).event.defaultPrevented).toBe(false);
    });
  });
});
