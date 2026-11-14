import { describe, expect, it } from "vitest";
import { createElement } from "../src/create.js";
import type { BoardElement } from "../src/elements.js";
import { elementBounds, resizeElements } from "../src/geometry.js";

// A heart with a highlighter stroke and a single-tap dot on it, grouped:
// growing the group from a corner must look like zooming the picture.
function picture(): BoardElement[] {
  const heart = createElement("shape", {
    shape: "heart",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeWidth: 2,
    text: "Love",
    fontSize: 20,
    groupIds: ["g"],
  });
  const stroke = createElement("draw", {
    x: 30,
    y: 30,
    points: [
      [0, 0],
      [0, 40],
      [40, 40],
    ],
    pressures: [],
    strokeWidth: 4,
    penStyle: "highlighter",
    groupIds: ["g"],
  });
  const dot = createElement("draw", {
    x: 50,
    y: 20,
    points: [[0, 0]],
    pressures: [],
    strokeWidth: 4,
    groupIds: ["g"],
  });
  return [heart, stroke, dot];
}

function byId(elements: BoardElement[], id: string): BoardElement {
  const found = elements.find((element) => element.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("resizing several elements from a corner", () => {
  it("scales strokes, dots, labels and positions together, like a picture", () => {
    const before = picture();
    const bounds = before.map(elementBounds);
    const right = Math.max(...bounds.map((box) => box.x + box.width));
    const bottom = Math.max(...bounds.map((box) => box.y + box.height));
    // Drag the bottom-right corner so the selection doubles in both directions.
    const after = resizeElements(
      before,
      "se",
      { x: right, y: bottom },
      { x: right * 2, y: bottom * 2 },
    );
    const [heart, stroke, dot] = before.map((element) =>
      byId(after, element.id),
    );
    expect(heart.width).toBeCloseTo(200);
    expect(heart.strokeWidth).toBeCloseTo(4);
    expect((heart as { fontSize: number }).fontSize).toBeCloseTo(40);
    expect(stroke.strokeWidth).toBeCloseTo(8);
    expect(dot.strokeWidth).toBeCloseTo(8);
    // The dot keeps its place on the heart, twice as far from the origin.
    expect(dot.x).toBeCloseTo(100);
    expect(dot.y).toBeCloseTo(40);
  });

  it("only stretches, without thickening, when a side handle is dragged", () => {
    const before = picture();
    const right = Math.max(
      ...before.map(elementBounds).map((box) => box.x + box.width),
    );
    const after = resizeElements(
      before,
      "e",
      { x: right, y: 50 },
      { x: right * 2, y: 50 },
    );
    for (const element of before) {
      expect(byId(after, element.id).strokeWidth).toBe(element.strokeWidth);
    }
    expect((byId(after, before[0].id) as { fontSize: number }).fontSize).toBe(
      20,
    );
  });

  it("shrinks proportionally too, never below a hairline", () => {
    const before = picture();
    const bounds = before.map(elementBounds);
    const right = Math.max(...bounds.map((box) => box.x + box.width));
    const bottom = Math.max(...bounds.map((box) => box.y + box.height));
    const after = resizeElements(
      before,
      "se",
      { x: right, y: bottom },
      { x: right / 100, y: bottom / 100 },
    );
    for (const element of after) {
      expect(element.strokeWidth).toBeGreaterThanOrEqual(0.25);
    }
  });
});

describe("resizing one element from a corner", () => {
  it("thickens a freehand drawing with it", () => {
    const [, stroke] = picture();
    const box = elementBounds(stroke);
    const [after] = resizeElements(
      [stroke],
      "se",
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x + box.width * 3, y: box.y + box.height * 3 },
    );
    expect(after.strokeWidth).toBeGreaterThan(stroke.strokeWidth * 2);
  });

  it("keeps a shape's border width", () => {
    const [heart] = picture();
    const [after] = resizeElements(
      [heart],
      "se",
      { x: 100, y: 100 },
      { x: 300, y: 300 },
    );
    expect(after.width).toBeCloseTo(300);
    expect(after.strokeWidth).toBe(2);
  });
});
