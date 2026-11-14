import { describe, expect, it } from "vitest";
import {
  createElement,
  DEFAULT_STROKE_COLOR,
  deleteElement,
  duplicateElements,
  isNewer,
  rebaseElement,
  STICKY_FILL_COLOR,
  updateElement,
} from "../src/create.js";
import { ELEMENT_TYPES } from "../src/elements.js";
import { newElementId, randomNonce, randomSeed } from "../src/ids.js";
import { parseElement } from "../src/validate.js";

describe("ids", () => {
  it("makes 21-character url-safe ids that do not repeat", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2_000; i++) {
      const id = newElementId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(2_000);
  });

  it("makes positive 31-bit seeds and nonces", () => {
    for (let i = 0; i < 500; i++) {
      const seed = randomSeed();
      const nonce = randomNonce();
      expect(Number.isInteger(seed) && seed >= 1 && seed < 2 ** 31).toBe(true);
      expect(Number.isInteger(nonce) && nonce >= 0 && nonce < 2 ** 31).toBe(
        true,
      );
    }
  });
});

describe("createElement", () => {
  it("fills every field for every type and passes validation", () => {
    for (const type of ELEMENT_TYPES) {
      const props = type === "task" ? { taskId: "task1" } : {};
      const element = createElement(type, props, { userId: "u1", now: 5 });
      expect(element.type).toBe(type);
      expect(element.version).toBe(1);
      expect(element.updatedBy).toBe("u1");
      expect(element.updatedAt).toBe(5);
      expect(element.opacity).toBe(100);
      expect(element.strokeWidth).toBeGreaterThanOrEqual(0);
      expect(parseElement(element)).toEqual(element);
    }
  });

  it("uses the documented defaults", () => {
    const rectangle = createElement("rectangle");
    expect(rectangle.strokeColor).toBe(DEFAULT_STROKE_COLOR);
    expect(rectangle.fillColor).toBe("transparent");
    expect(rectangle.fontFamily).toBe("hand");
    expect(rectangle.sketch).toBe(1);
    expect(rectangle.strokeWidth).toBe(2);
    expect(createElement("sticky").fillColor).toBe(STICKY_FILL_COLOR);
    expect(createElement("arrow").endHead).toBe("arrow");
    expect(createElement("line").endHead).toBe("none");
  });

  it("moves a line's first point to the origin and sizes it from its points", () => {
    const line = createElement("line", {
      x: 10,
      y: 10,
      points: [
        [5, 5],
        [25, -15],
      ],
    });
    expect(line.x).toBe(15);
    expect(line.y).toBe(15);
    expect(line.points).toEqual([
      [0, 0],
      [20, -20],
    ]);
    expect(line.width).toBe(20);
    expect(line.height).toBe(20);
  });
});

describe("updateElement and deleteElement", () => {
  it("returns a stamped copy and never mutates the input", () => {
    const element = createElement("rectangle", { x: 1 }, { userId: "a" });
    const next = updateElement(element, { x: 50 }, { userId: "b", now: 9 });
    expect(element.x).toBe(1);
    expect(next.x).toBe(50);
    expect(next.version).toBe(element.version + 1);
    expect(next.updatedBy).toBe("b");
    expect(next.updatedAt).toBe(9);
    expect(next.id).toBe(element.id);
  });

  it("keeps the previous editor when no user is given", () => {
    const element = createElement("rectangle", {}, { userId: "a" });
    expect(updateElement(element, { y: 3 }).updatedBy).toBe("a");
  });

  it("deletes with a tombstone", () => {
    const element = createElement("ellipse");
    const gone = deleteElement(element);
    expect(gone.deleted).toBe(true);
    expect(isNewer(gone, element)).toBe(true);
  });
});

describe("isNewer", () => {
  it("prefers the higher version", () => {
    const a = createElement("rectangle");
    const b = { ...a, version: a.version + 1, nonce: 2 ** 30 };
    expect(isNewer(b, a)).toBe(true);
    expect(isNewer(a, b)).toBe(false);
  });

  it("breaks equal versions with the lower nonce, symmetrically", () => {
    const a = { ...createElement("rectangle"), nonce: 10 };
    const b = { ...a, nonce: 20 };
    expect(isNewer(a, b)).toBe(true);
    expect(isNewer(b, a)).toBe(false);
    expect(isNewer(a, { ...a })).toBe(false);
  });

  it("lets a rebased element beat the current copy", () => {
    const start = createElement("rectangle");
    const current = updateElement(updateElement(start, { x: 1 }), { x: 2 });
    const fromSnapshot = updateElement(start, { x: 3 });
    const rebased = rebaseElement(fromSnapshot, current);
    expect(isNewer(rebased, current)).toBe(true);
    expect(rebased.x).toBe(3);
  });
});

describe("duplicateElements", () => {
  it("copies with new ids and remaps groups, frames, bindings and links", () => {
    const frame = createElement("frame", { id: "frame1", order: "a0" });
    const box = createElement("rectangle", {
      id: "box1",
      order: "a1",
      groupIds: ["g1"],
      frameId: "frame1",
    });
    const other = createElement("rectangle", { id: "box2", order: "a2" });
    const arrow = createElement("arrow", {
      id: "arrow1",
      order: "a3",
      groupIds: ["g1"],
      startBinding: { elementId: "box1", focus: [0.5, 0.5], gap: 4 },
      endBinding: { elementId: "box2", focus: [0.5, 0.5], gap: 4 },
      link: "#element=box1",
    });
    const copies = duplicateElements(
      [arrow, box, frame],
      { x: 10, y: 20 },
      {
        userId: "u2",
      },
    );
    expect(copies).toHaveLength(3);
    const [frameCopy, boxCopy, arrowCopy] = copies;
    expect(frameCopy.type).toBe("frame");
    expect(boxCopy.type).toBe("rectangle");
    expect(arrowCopy.type).toBe("arrow");
    for (const copy of copies) {
      expect(["frame1", "box1", "arrow1"]).not.toContain(copy.id);
      expect(copy.version).toBe(1);
      expect(copy.updatedBy).toBe("u2");
    }
    expect(boxCopy.x).toBe(box.x + 10);
    expect(boxCopy.y).toBe(box.y + 20);
    expect(boxCopy.frameId).toBe(frameCopy.id);
    expect(boxCopy.groupIds).toHaveLength(1);
    expect(boxCopy.groupIds[0]).not.toBe("g1");
    expect(arrowCopy.groupIds).toEqual(boxCopy.groupIds);
    if (arrowCopy.type !== "arrow") throw new Error("expected arrow");
    expect(arrowCopy.startBinding?.elementId).toBe(boxCopy.id);
    expect(arrowCopy.endBinding).toBeNull();
    expect(arrowCopy.link).toBe(`#element=${boxCopy.id}`);
    // Copies keep their relative order and sit above the originals.
    expect(frameCopy.order < boxCopy.order).toBe(true);
    expect(boxCopy.order < arrowCopy.order).toBe(true);
    expect(frameCopy.order > arrow.order).toBe(true);
    expect(other.order < frameCopy.order).toBe(true);
  });

  it("places copies inside an explicit order gap", () => {
    const a = createElement("rectangle", { order: "a0" });
    const copies = duplicateElements(
      [a],
      { x: 0, y: 0 },
      {
        above: "a0",
        below: "a1",
      },
    );
    expect(copies[0].order > "a0" && copies[0].order < "a1").toBe(true);
  });
});
