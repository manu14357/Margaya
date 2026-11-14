import { describe, expect, it } from "vitest";
import { createElement } from "../src/create.js";
import type { BoardElement, LinearElement } from "../src/elements.js";
import {
  alignElements,
  type Box,
  distributeElements,
  elementBounds,
  elementBox,
  elementsInBox,
  findBindTarget,
  flipElements,
  focusFor,
  focusPoint,
  hitTest,
  type Point,
  pointOnOutline,
  resizeElements,
  rotateElements,
  rotatePoint,
  routeElbow,
  sceneBounds,
  snapToElements,
  snapToGrid,
  topElementAt,
  translateElements,
  updateBoundLines,
  worldPoints,
} from "../src/geometry.js";

const close = (a: number, b: number, digits = 6) =>
  expect(a).toBeCloseTo(b, digits);
const closePoint = (a: Point, b: Point, digits = 6) => {
  close(a.x, b.x, digits);
  close(a.y, b.y, digits);
};

function interiorCrossed(points: Point[], box: Box): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    // Sample along the segment; any sample strictly inside fails.
    for (let s = 0; s <= 50; s++) {
      const t = s / 50;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      if (
        x > box.x + 1e-6 &&
        x < box.x + box.width - 1e-6 &&
        y > box.y + 1e-6 &&
        y < box.y + box.height - 1e-6
      ) {
        return true;
      }
    }
  }
  return false;
}

function absolute(start: Point, route: readonly (readonly [number, number])[]) {
  return route.map(([x, y]) => ({ x: start.x + x, y: start.y + y }));
}

function isOrthogonal(points: Point[]) {
  return points.every(
    (point, i) =>
      i === 0 ||
      Math.abs(point.x - points[i - 1].x) < 1e-6 ||
      Math.abs(point.y - points[i - 1].y) < 1e-6,
  );
}

describe("boxes and bounds", () => {
  it("rotates points about a centre", () => {
    closePoint(rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2), {
      x: 0,
      y: 1,
    });
  });

  it("gives the unrotated box and the rotated bounds", () => {
    const rect = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      angle: Math.PI / 2,
    });
    expect(elementBox(rect)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    const bounds = elementBounds(rect);
    close(bounds.x, 25);
    close(bounds.y, -25);
    close(bounds.width, 50);
    close(bounds.height, 100);
  });

  it("measures lines from their points", () => {
    const line = createElement("line", {
      x: 10,
      y: 10,
      points: [
        [0, 0],
        [-20, 30],
      ],
    });
    expect(elementBox(line)).toEqual({ x: -10, y: 10, width: 20, height: 30 });
  });

  it("bounds the live scene", () => {
    const a = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
    const b = createElement("rectangle", {
      x: 50,
      y: 60,
      width: 10,
      height: 10,
    });
    const gone = createElement("rectangle", {
      x: 900,
      y: 900,
      width: 10,
      height: 10,
      deleted: true,
    });
    expect(sceneBounds([a, b, gone])).toEqual({
      x: 0,
      y: 0,
      width: 60,
      height: 70,
    });
    expect(sceneBounds([])).toBeNull();
  });
});

describe("hitTest", () => {
  const outline = createElement("rectangle", {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    strokeWidth: 2,
  });

  it("hits an unfilled rectangle only near its outline", () => {
    expect(hitTest(outline, { x: 50, y: 0 }, 4)).toBe(true);
    expect(hitTest(outline, { x: 103, y: 25 }, 4)).toBe(true);
    expect(hitTest(outline, { x: 50, y: 25 }, 4)).toBe(false);
    expect(hitTest(outline, { x: 120, y: 25 }, 4)).toBe(false);
  });

  it("hits a filled rectangle anywhere inside", () => {
    const filled = { ...outline, fillColor: "#ff0000" };
    expect(hitTest(filled, { x: 50, y: 25 }, 4)).toBe(true);
    expect(
      hitTest({ ...filled, fillStyle: "none" as const }, { x: 50, y: 25 }, 4),
    ).toBe(false);
  });

  it("hits a labelled outline shape inside", () => {
    expect(hitTest({ ...outline, text: "Label" }, { x: 50, y: 25 }, 4)).toBe(
      true,
    );
  });

  it("follows rotation", () => {
    // A thin bar along x, rotated a quarter turn: it now stands upright.
    const bar = createElement("rectangle", {
      x: 0,
      y: 45,
      width: 100,
      height: 10,
      fillColor: "#000000",
      angle: Math.PI / 2,
    });
    expect(hitTest(bar, { x: 50, y: 5 }, 1)).toBe(true);
    expect(hitTest(bar, { x: 50, y: 95 }, 1)).toBe(true);
    expect(hitTest(bar, { x: 5, y: 50 }, 1)).toBe(false);
    expect(hitTest(bar, { x: 95, y: 50 }, 1)).toBe(false);
  });

  it("tests rotated ellipses and diamonds by their real outline", () => {
    const ellipse = createElement("ellipse", {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      strokeWidth: 0,
      angle: Math.PI / 4,
    });
    const center = { x: 100, y: 50 };
    const along = rotatePoint({ x: 199, y: 50 }, center, Math.PI / 4);
    expect(hitTest(ellipse, along, 2)).toBe(true);
    // The unrotated corner of the box is far from a rotated ellipse.
    expect(hitTest(ellipse, { x: 200, y: 50 }, 2)).toBe(false);
    expect(hitTest(ellipse, center, 2)).toBe(false);
    expect(hitTest({ ...ellipse, fillColor: "#00ff00" }, center, 2)).toBe(true);

    const diamond = createElement("diamond", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeWidth: 0,
      fillColor: "#ffffff",
    });
    expect(hitTest(diamond, { x: 50, y: 50 }, 1)).toBe(true);
    expect(hitTest(diamond, { x: 5, y: 5 }, 1)).toBe(false);
    expect(hitTest(diamond, { x: 25, y: 25 }, 1)).toBe(true);
  });

  it("hits lines by distance, including curves and rotation", () => {
    const line = createElement("line", {
      x: 0,
      y: 0,
      strokeWidth: 2,
      points: [
        [0, 0],
        [100, 0],
      ],
    });
    expect(hitTest(line, { x: 50, y: 3 }, 3)).toBe(true);
    expect(hitTest(line, { x: 50, y: 10 }, 3)).toBe(false);
    const turned = { ...line, angle: Math.PI / 2 };
    expect(hitTest(turned, { x: 50, y: 40 }, 3)).toBe(true);
    const curve = createElement("arrow", {
      routing: "curved",
      points: [
        [0, 0],
        [50, 50],
        [100, 0],
      ],
    });
    expect(hitTest(curve, { x: 50, y: 50 }, 2)).toBe(true);
    expect(hitTest(curve, { x: 50, y: 0 }, 2)).toBe(false);
  });

  it("hits stickies, text and task cards inside, frames on the title and outline", () => {
    const sticky = createElement("sticky", { x: 0, y: 0 });
    expect(hitTest(sticky, { x: 100, y: 100 }, 0)).toBe(true);
    const frame = createElement("frame", {
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
    expect(hitTest(frame, { x: 150, y: 100 }, 2)).toBe(false);
    expect(hitTest(frame, { x: 20, y: -10 }, 2)).toBe(true);
    expect(hitTest(frame, { x: 300, y: 100 }, 2)).toBe(true);
    expect(hitTest({ ...sticky, deleted: true }, { x: 100, y: 100 }, 0)).toBe(
      false,
    );
  });

  it("finds the top-most element and elements in a box", () => {
    const below = createElement("sticky", {
      id: "below",
      x: 0,
      y: 0,
      order: "a0",
    });
    const above = createElement("sticky", {
      id: "above",
      x: 50,
      y: 50,
      order: "a1",
    });
    expect(topElementAt([above, below], { x: 100, y: 100 }, 0)?.id).toBe(
      "above",
    );
    expect(topElementAt([above, below], { x: 10, y: 10 }, 0)?.id).toBe("below");
    expect(topElementAt([above, below], { x: 900, y: 900 }, 0)).toBeNull();
    const box = { x: -10, y: -10, width: 230, height: 230 };
    expect(elementsInBox([above, below], box).map((e) => e.id)).toEqual([
      "below",
    ]);
    expect(
      elementsInBox([above, below], box, { fullyInside: false }).map(
        (e) => e.id,
      ),
    ).toEqual(["above", "below"]);
  });
});

describe("bindings", () => {
  const box = createElement("rectangle", {
    id: "box",
    x: 100,
    y: 0,
    width: 100,
    height: 100,
  });

  it("ends a line on the outline, short of it by the gap", () => {
    const end = pointOnOutline(box, [0.5, 0.5], 5, { x: 0, y: 50 });
    closePoint(end, { x: 95, y: 50 });
    const noGap = pointOnOutline(box, [0.5, 0.5], 0, { x: 150, y: -100 });
    closePoint(noGap, { x: 150, y: 0 });
  });

  it("works on rotated and round shapes", () => {
    const turned = { ...box, angle: Math.PI / 4 };
    const end = pointOnOutline(turned, [0.5, 0.5], 0, { x: 150, y: -200 });
    // The top corner of a square turned 45 degrees sits at half the diagonal.
    closePoint(end, { x: 150, y: 50 - Math.SQRT2 * 50 }, 4);
    const circle = createElement("ellipse", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    closePoint(pointOnOutline(circle, [0.5, 0.5], 10, { x: 200, y: 50 }), {
      x: 110,
      y: 50,
    });
  });

  it("aims at the focus point when the start is inside", () => {
    const end = pointOnOutline(box, [0.25, 0.75], 4, { x: 150, y: 50 });
    closePoint(end, { x: 125, y: 75 });
  });

  it("turns board points into focus fractions and back", () => {
    const turned = { ...box, angle: 0.7 };
    const point = focusPoint(turned, [0.2, 0.9]);
    const focus = focusFor(turned, point);
    close(focus[0], 0.2);
    close(focus[1], 0.9);
    expect(focusFor(box, { x: -1000, y: 5000 })).toEqual([0, 1]);
  });

  it("finds a bind target under or near the point", () => {
    const line = createElement("line", { id: "line" });
    expect(findBindTarget([box, line], { x: 150, y: 50 }, 5)?.id).toBe("box");
    expect(findBindTarget([box, line], { x: 97, y: 50 }, 5)?.id).toBe("box");
    expect(findBindTarget([box, line], { x: 50, y: 50 }, 5)).toBeNull();
    expect(
      findBindTarget([box], { x: 150, y: 50 }, 5, new Set(["box"])),
    ).toBeNull();
  });

  it("moves bound line ends with the shapes they connect", () => {
    const left = createElement("rectangle", {
      id: "left",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const right = createElement("rectangle", {
      id: "right",
      x: 300,
      y: 0,
      width: 100,
      height: 100,
    });
    const arrow = createElement("arrow", {
      id: "arrow",
      x: 100,
      y: 50,
      points: [
        [0, 0],
        [200, 0],
      ],
      startBinding: { elementId: "left", focus: [0.5, 0.5], gap: 0 },
      endBinding: { elementId: "right", focus: [0.5, 0.5], gap: 0 },
    });
    const [movedRight] = translateElements([right], 0, 200);
    const all: BoardElement[] = [left, movedRight, arrow];
    const [updated] = updateBoundLines(all, ["right"]) as LinearElement[];
    expect(updated.id).toBe("arrow");
    expect(updated.version).toBe(arrow.version + 1);
    const points = worldPoints(updated);
    // The line now runs between the two centres, clipped at each outline.
    const start = points[0];
    const end = points[points.length - 1];
    expect(hitTest(left, start, 0.5)).toBe(true);
    expect(hitTest(movedRight, end, 0.5)).toBe(true);
    const slope = (end.y - start.y) / (end.x - start.x);
    close(slope, 200 / 300, 4);
    expect(updateBoundLines(all, ["unrelated"])).toEqual([]);
  });

  it("re-routes bound elbow lines around both boxes", () => {
    const a = createElement("rectangle", {
      id: "a",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const b = createElement("rectangle", {
      id: "b",
      x: 300,
      y: 200,
      width: 100,
      height: 100,
    });
    const elbow = createElement("arrow", {
      id: "elbow",
      routing: "elbow",
      x: 100,
      y: 50,
      points: [
        [0, 0],
        [200, 200],
      ],
      startBinding: { elementId: "a", focus: [1, 0.5], gap: 0 },
      endBinding: { elementId: "b", focus: [0, 0.5], gap: 0 },
    });
    const [routed] = updateBoundLines([a, b, elbow], ["a"]) as LinearElement[];
    const points = worldPoints(routed);
    expect(isOrthogonal(points)).toBe(true);
    closePoint(points[0], { x: 100, y: 50 });
    closePoint(points[points.length - 1], { x: 300, y: 250 });
    expect(interiorCrossed(points, elementBox(a))).toBe(false);
    expect(interiorCrossed(points, elementBox(b))).toBe(false);
  });
});

describe("routeElbow", () => {
  it("runs straight when the boxes face each other", () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 300, y: 0, width: 100, height: 100 };
    const route = routeElbow({ x: 100, y: 50 }, { x: 300, y: 50 }, a, b);
    expect(route).toEqual([
      [0, 0],
      [200, 0],
    ]);
  });

  it("goes around when the target is behind the start side", () => {
    const a = { x: 300, y: 0, width: 100, height: 100 };
    const b = { x: 0, y: 0, width: 100, height: 100 };
    // Leave a's right side, enter b's left side: both boxes are in the way.
    const start = { x: 400, y: 50 };
    const end = { x: 0, y: 50 };
    const points = absolute(start, routeElbow(start, end, a, b));
    expect(isOrthogonal(points)).toBe(true);
    closePoint(points[points.length - 1], end);
    expect(interiorCrossed(points, a)).toBe(false);
    expect(interiorCrossed(points, b)).toBe(false);
    // It leaves rightwards and arrives moving rightwards into b's left side.
    expect(points[1].x).toBeGreaterThan(start.x);
    expect(points[points.length - 2].x).toBeLessThan(end.x);
  });

  it("never crosses the boxes for many placements", () => {
    const a = { x: 0, y: 0, width: 120, height: 80 };
    const sides: [number, number][] = [
      [1, 0.5],
      [0, 0.5],
      [0.5, 0],
      [0.5, 1],
    ];
    for (const [ox, oy] of [
      [400, 0],
      [-400, 0],
      [0, 300],
      [0, -300],
      [250, 250],
      [-250, -250],
      [140, 40],
    ]) {
      const b = { x: ox, y: oy, width: 100, height: 100 };
      for (const [sx, sy] of sides) {
        for (const [ex, ey] of sides) {
          const start = { x: a.x + sx * a.width, y: a.y + sy * a.height };
          const end = { x: b.x + ex * b.width, y: b.y + ey * b.height };
          const points = absolute(start, routeElbow(start, end, a, b));
          expect(isOrthogonal(points)).toBe(true);
          closePoint(points[points.length - 1], end);
          expect(interiorCrossed(points, a)).toBe(false);
          expect(interiorCrossed(points, b)).toBe(false);
        }
      }
    }
  });

  it("routes free points without boxes", () => {
    const route = routeElbow({ x: 0, y: 0 }, { x: 100, y: 60 });
    const points = absolute({ x: 0, y: 0 }, route);
    expect(isOrthogonal(points)).toBe(true);
    closePoint(points[points.length - 1], { x: 100, y: 60 });
  });
});

describe("resizeElements", () => {
  const rect = createElement("rectangle", {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
  });

  it("drags a corner and keeps the opposite corner", () => {
    const [resized] = resizeElements(
      [rect],
      "se",
      { x: 100, y: 50 },
      { x: 150, y: 100 },
    );
    expect(elementBox(resized)).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 100,
    });
    const [west] = resizeElements(
      [rect],
      "w",
      { x: 0, y: 25 },
      { x: -20, y: 90 },
    );
    expect(elementBox(west)).toEqual({ x: -20, y: 0, width: 120, height: 50 });
  });

  it("keeps the aspect ratio and resizes from the centre", () => {
    const [aspect] = resizeElements(
      [rect],
      "se",
      { x: 100, y: 50 },
      { x: 300, y: 60 },
      { keepAspect: true },
    );
    expect(elementBox(aspect)).toEqual({ x: 0, y: 0, width: 300, height: 150 });
    const [centred] = resizeElements(
      [rect],
      "e",
      { x: 100, y: 25 },
      { x: 110, y: 25 },
      { fromCenter: true },
    );
    expect(elementBox(centred)).toEqual({
      x: -10,
      y: 0,
      width: 120,
      height: 50,
    });
    const [side] = resizeElements(
      [rect],
      "e",
      { x: 100, y: 25 },
      { x: 200, y: 25 },
      { keepAspect: true },
    );
    expect(elementBox(side)).toEqual({ x: 0, y: -25, width: 200, height: 100 });
  });

  it("mirrors when dragged past the opposite side", () => {
    const [flipped] = resizeElements(
      [rect],
      "e",
      { x: 100, y: 25 },
      { x: -50, y: 25 },
    );
    expect(elementBox(flipped)).toEqual({
      x: -50,
      y: 0,
      width: 50,
      height: 50,
    });
  });

  it("resizes a rotated element in its own frame and keeps the anchor in place", () => {
    const turned = { ...rect, angle: Math.PI / 2 };
    const anchorBefore = rotatePoint(
      { x: 0, y: 0 },
      { x: 50, y: 25 },
      Math.PI / 2,
    );
    // On screen, the element's local +x points down; drag the "se" handle by
    // 20 local units along x (20 down on screen) and 10 along y (10 left).
    const handle = rotatePoint(
      { x: 100, y: 50 },
      { x: 50, y: 25 },
      Math.PI / 2,
    );
    const [resized] = resizeElements([turned], "se", handle, {
      x: handle.x - 10,
      y: handle.y + 20,
    });
    expect(resized.width).toBeCloseTo(120);
    expect(resized.height).toBeCloseTo(60);
    expect(resized.angle).toBeCloseTo(Math.PI / 2);
    const box = elementBox(resized);
    const anchorAfter = rotatePoint(
      { x: box.x, y: box.y },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      resized.angle,
    );
    closePoint(anchorAfter, anchorBefore);
  });

  it("keeps the aspect ratio from the centre on a rotated multi-selection", () => {
    const a = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const b = createElement("rectangle", {
      x: 200,
      y: 0,
      width: 100,
      height: 100,
      angle: Math.PI / 4,
    });
    const bounds = sceneBounds([a, b]) as Box;
    const centre = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    const corner = { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
    const resized = resizeElements(
      [a, b],
      "se",
      corner,
      {
        x: corner.x + bounds.width / 2,
        y: corner.y,
      },
      { keepAspect: true, fromCenter: true },
    );
    const after = sceneBounds(resized) as Box;
    close(after.width / after.height, bounds.width / bounds.height, 4);
    close(after.width, bounds.width * 2, 4);
    closePoint(
      { x: after.x + after.width / 2, y: after.y + after.height / 2 },
      centre,
      4,
    );
    const [, rotated] = resized;
    expect(rotated.angle).toBeCloseTo(Math.PI / 4);
    expect(rotated.width).toBeCloseTo(200);
  });

  it("scales line points and text fonts", () => {
    const line = createElement("line", {
      points: [
        [0, 0],
        [100, 50],
      ],
    });
    const [scaled] = resizeElements(
      [line],
      "se",
      { x: 100, y: 50 },
      { x: 200, y: 100 },
    );
    if (scaled.type !== "line") throw new Error("expected line");
    expect(scaled.points).toEqual([
      [0, 0],
      [200, 100],
    ]);
    const text = createElement("text", {
      width: 100,
      height: 25,
      fontSize: 20,
    });
    const [bigger] = resizeElements(
      [text],
      "se",
      { x: 100, y: 25 },
      { x: 200, y: 30 },
    );
    if (bigger.type !== "text") throw new Error("expected text");
    expect(bigger.fontSize).toBe(40);
    const [wrapped] = resizeElements(
      [text],
      "e",
      { x: 100, y: 12 },
      { x: 150, y: 12 },
    );
    if (wrapped.type !== "text") throw new Error("expected text");
    expect(wrapped.autoSize).toBe(false);
    expect(wrapped.fontSize).toBe(20);
  });
});

describe("rotate, translate and flip", () => {
  it("rotates elements about a shared centre", () => {
    const a = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
    const [turned] = rotateElements([a], { x: 50, y: 5 }, Math.PI);
    close(turned.x, 90);
    close(turned.y, 0);
    close(turned.angle, Math.PI);
  });

  it("translates and returns nothing for a zero move", () => {
    const a = createElement("rectangle", { x: 1, y: 2 });
    expect(translateElements([a], 3, 4)[0]).toMatchObject({ x: 4, y: 6 });
    expect(translateElements([a], 0, 0)).toEqual([]);
  });

  it("mirrors shapes and line points", () => {
    const a = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      angle: 0.3,
    });
    const line = createElement("line", {
      x: 50,
      y: 0,
      points: [
        [0, 0],
        [50, 10],
      ],
    });
    const [flippedA, flippedLine] = flipElements([a, line], "horizontal");
    const bounds = sceneBounds([a, line]) as Box;
    const after = sceneBounds([flippedA, flippedLine]) as Box;
    close(after.x, bounds.x, 4);
    close(after.width, bounds.width, 4);
    close(flippedA.angle, Math.PI * 2 - 0.3);
    const points = worldPoints(flippedLine as LinearElement);
    closePoint(
      points[0],
      { x: bounds.x + bounds.width - 50 + bounds.x, y: 0 },
      4,
    );
  });
});

describe("align and distribute", () => {
  const a = createElement("rectangle", {
    id: "a",
    x: 0,
    y: 0,
    width: 50,
    height: 50,
  });
  const b = createElement("rectangle", {
    id: "b",
    x: 100,
    y: 30,
    width: 20,
    height: 20,
  });
  const c = createElement("rectangle", {
    id: "c",
    x: 300,
    y: 10,
    width: 40,
    height: 40,
  });

  it("aligns edges and centre lines", () => {
    const top = alignElements([a, b, c], "top");
    expect(top.map((e) => [e.id, e.y])).toEqual([
      ["b", 0],
      ["c", 0],
    ]);
    const right = alignElements([a, b, c], "right");
    for (const element of right) expect(element.x + element.width).toBe(340);
    const middle = alignElements([a, b, c], "middle");
    for (const element of middle)
      expect(element.y + element.height / 2).toBe(25);
    expect(alignElements([a], "left")).toEqual([]);
  });

  it("moves groups as one unit", () => {
    const g1 = { ...a, groupIds: ["g"] };
    const g2 = { ...b, groupIds: ["g"] };
    const moved = alignElements([g1, g2, c], "left");
    expect(moved.map((e) => e.id)).toEqual(["c"]);
    expect(moved[0].x).toBe(0);
  });

  it("spaces units with equal gaps", () => {
    const moved = distributeElements([c, a, b], "horizontal");
    expect(moved.map((e) => e.id)).toEqual(["b"]);
    // Span 0..340, sizes 50 + 20 + 40 = 110, so each gap is 115.
    expect(moved[0].x).toBe(165);
    expect(distributeElements([a, b], "horizontal")).toEqual([]);
  });
});

describe("snapping", () => {
  it("snaps to the grid", () => {
    expect(snapToGrid({ x: 13, y: 27 }, 10)).toEqual({ x: 10, y: 30 });
    expect(snapToGrid({ x: 13, y: 27 }, 0)).toEqual({ x: 13, y: 27 });
  });

  it("snaps edges and centres within the threshold and returns guides", () => {
    const moving = { x: 103, y: 205, width: 50, height: 50 };
    const others = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 400, y: 207, width: 10, height: 10 },
    ];
    const result = snapToElements(moving, others, 5);
    expect(result.dx).toBe(-3);
    expect(result.dy).toBe(2);
    const vertical = result.guides.find(
      (guide) => guide.axis === "x" && guide.at === 100,
    );
    expect(vertical).toEqual({ axis: "x", at: 100, start: 0, end: 257 });
    expect(
      result.guides.some((guide) => guide.axis === "y" && guide.at === 207),
    ).toBe(true);
    expect(snapToElements(moving, others, 1)).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
    });
  });
});
