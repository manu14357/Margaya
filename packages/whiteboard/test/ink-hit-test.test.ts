import { describe, expect, it } from "vitest";
import { createElement } from "../src/create.js";
import { hitTest } from "../src/geometry.js";
import { penSize } from "../src/render/shapes.js";

// A freehand stroke is drawn much wider than its stroke width (a highlighter
// several times wider), so clicking its visible ink has to select it.

function stroke(penStyle: "pen" | "marker" | "highlighter", strokeWidth = 4) {
  return createElement("draw", {
    x: 0,
    y: 0,
    points: [
      [0, 0],
      [200, 0],
    ],
    pressures: [],
    strokeWidth,
    penStyle,
  });
}

describe("hit testing a freehand stroke", () => {
  it("counts a click on the edge of a highlighter's ink", () => {
    const highlight = stroke("highlighter");
    const halfInk = penSize("highlighter", 4) / 2;
    expect(halfInk).toBeGreaterThan(10);
    // Just inside the visible band, far beyond half the stroke width.
    expect(hitTest(highlight, { x: 100, y: halfInk - 1 }, 0)).toBe(true);
    expect(hitTest(highlight, { x: 100, y: halfInk + 6 }, 4)).toBe(false);
  });

  it("grows with the stroke when a scaled drawing gets thicker", () => {
    const thin = stroke("marker", 2);
    const thick = stroke("marker", 6);
    const point = { x: 100, y: penSize("marker", 6) / 2 - 1 };
    expect(hitTest(thin, point, 0)).toBe(false);
    expect(hitTest(thick, point, 0)).toBe(true);
  });

  it("leaves lines at half their stroke width", () => {
    const line = createElement("line", {
      x: 0,
      y: 0,
      points: [
        [0, 0],
        [200, 0],
      ],
      strokeWidth: 4,
    });
    expect(hitTest(line, { x: 100, y: 3 }, 0)).toBe(false);
    expect(hitTest(line, { x: 100, y: 2 }, 0)).toBe(true);
  });
});
