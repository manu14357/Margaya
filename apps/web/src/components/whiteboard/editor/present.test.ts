import { createElement } from "@margaya/whiteboard";
import { describe, expect, it } from "vitest";
import {
  isPresentSearch,
  presentationFrames,
  presentKeyAction,
  presentUrl,
  stepPresentation,
} from "./present";

const frame = (id: string, x: number, y: number, extra = {}) =>
  createElement("frame", { id, x, y, width: 400, height: 300, ...extra });

describe("presentationFrames", () => {
  it("reads frames in rows, left to right", () => {
    const frames = [
      frame("c", 0, 400),
      frame("b", 500, 20),
      frame("a", 0, 0),
      frame("d", 520, 380),
    ];
    expect(presentationFrames(frames).map((f) => f.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("leaves out other elements and deleted frames", () => {
    const elements = [
      createElement("rectangle", { id: "r", x: -100, y: -100 }),
      frame("gone", 0, 0, { deleted: true }),
      frame("kept", 100, 0),
    ];
    expect(presentationFrames(elements).map((f) => f.id)).toEqual(["kept"]);
  });

  it("is empty for a board without frames", () => {
    expect(presentationFrames([createElement("sticky", {})])).toEqual([]);
  });
});

describe("presentKeyAction", () => {
  it("maps arrows, paging keys and Escape", () => {
    expect(presentKeyAction("ArrowRight")).toBe("next");
    expect(presentKeyAction("ArrowDown")).toBe("next");
    expect(presentKeyAction(" ")).toBe("next");
    expect(presentKeyAction("PageDown")).toBe("next");
    expect(presentKeyAction("ArrowLeft")).toBe("previous");
    expect(presentKeyAction("PageUp")).toBe("previous");
    expect(presentKeyAction("Home")).toBe("first");
    expect(presentKeyAction("End")).toBe("last");
    expect(presentKeyAction("Escape")).toBe("exit");
    expect(presentKeyAction("a")).toBeNull();
  });
});

describe("stepPresentation", () => {
  it("moves within the frames without wrapping", () => {
    expect(stepPresentation(0, 3, "next")).toBe(1);
    expect(stepPresentation(2, 3, "next")).toBe(2);
    expect(stepPresentation(1, 3, "previous")).toBe(0);
    expect(stepPresentation(0, 3, "previous")).toBe(0);
    expect(stepPresentation(1, 3, "last")).toBe(2);
    expect(stepPresentation(2, 3, "first")).toBe(0);
  });

  it("clamps an index left over after frames were removed", () => {
    expect(stepPresentation(5, 2, "next")).toBe(1);
    expect(stepPresentation(5, 2, "previous")).toBe(1);
  });

  it("stays at 0 without frames", () => {
    expect(stepPresentation(0, 0, "next")).toBe(0);
  });
});

describe("present links", () => {
  it("accepts ?present=1 in its parsed forms", () => {
    expect(isPresentSearch(1)).toBe(true);
    expect(isPresentSearch("1")).toBe(true);
    expect(isPresentSearch(true)).toBe(true);
    expect(isPresentSearch(undefined)).toBe(false);
    expect(isPresentSearch("yes")).toBe(false);
  });

  it("builds the board's present URL without an element link", () => {
    expect(
      presentUrl("https://pm.example.com/dashboard/b/1?element=e1#x"),
    ).toBe("https://pm.example.com/dashboard/b/1?present=1");
  });
});
