import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createElement } from "../src/create.js";
import {
  DEFAULT_BOARD_SETTINGS,
  ELEMENT_TYPES,
  type LocalPoint,
  SHAPE_KINDS,
} from "../src/elements.js";
import {
  elementBounds,
  findBindTarget,
  flipElements,
  hitTest,
  pointOnOutline,
  resizeElements,
  rotatePoint,
  updateBoundLines,
} from "../src/geometry.js";
import { shapePolygon } from "../src/shapes.js";
import { templateElements } from "../src/templates.js";
import { extractBoardText } from "../src/text.js";
import {
  parseElement,
  parseSettings,
  sanitizeElements,
} from "../src/validate.js";
import {
  decodeBoardState,
  encodeBoardState,
  readSettings,
  writeSettings,
} from "../src/yjs.js";

function distanceToPolygon(
  point: { x: number; y: number },
  polygon: readonly LocalPoint[],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t =
      length > 0
        ? Math.max(
            0,
            Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / length),
          )
        : 0;
    best = Math.min(
      best,
      Math.hypot(point.x - (ax + t * dx), point.y - (ay + t * dy)),
    );
  }
  return best;
}

describe("creating shapes and pens", () => {
  it("defaults a shape like a rectangle with a label", () => {
    const shape = createElement("shape", { shape: "heart" });
    expect(shape).toMatchObject({
      type: "shape",
      shape: "heart",
      width: 160,
      height: 120,
      text: "",
      textAlign: "center",
      verticalAlign: "middle",
      fontFamily: "hand",
      fillColor: "transparent",
      strokeColor: "#1e1e1e",
      sketch: 1,
    });
    expect(createElement("shape").shape).toBe("triangle");
    expect(ELEMENT_TYPES).toContain("shape");
  });

  it("gives new drawings a plain pen", () => {
    expect(createElement("draw").penStyle).toBe("pen");
    expect(createElement("draw", { penStyle: "highlighter" }).penStyle).toBe(
      "highlighter",
    );
  });
});

describe("validating shapes and pens", () => {
  const raw = (props: Record<string, unknown>) => ({
    id: "shape1",
    type: "shape",
    shape: "star",
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    ...props,
  });

  it("accepts every shape kind and drops unknown fields", () => {
    for (const shape of SHAPE_KINDS) {
      const parsed = parseElement(raw({ shape, text: "Hi", evil: "<x>" }));
      expect(parsed).toMatchObject({ type: "shape", shape, text: "Hi" });
      expect(parsed && "evil" in parsed).toBe(false);
    }
  });

  it("rejects an unknown or missing kind", () => {
    expect(parseElement(raw({ shape: "blob" }))).toBeNull();
    expect(parseElement(raw({ shape: "__proto__" }))).toBeNull();
    expect(parseElement(raw({ shape: 3 }))).toBeNull();
    const { shape: _, ...missing } = raw({});
    expect(parseElement(missing)).toBeNull();
  });

  it("repairs a shape's text fields and rejects broken geometry", () => {
    const parsed = parseElement(
      raw({ fontSize: 9999, textAlign: "justify", text: 5 }),
    );
    expect(parsed).toMatchObject({
      fontSize: 512,
      textAlign: "center",
      text: "",
    });
    expect(parseElement(raw({ width: Number.NaN }))).toBeNull();
  });

  const draw = (props: Record<string, unknown>) => ({
    id: "ink1",
    type: "draw",
    points: [
      [0, 0],
      [10, 10],
    ],
    ...props,
  });

  it("reads old drawings without a pen style as a pen", () => {
    expect(parseElement(draw({}))).toMatchObject({
      type: "draw",
      penStyle: "pen",
    });
    expect(parseElement(draw({ penStyle: "laser" }))?.type).toBe("draw");
    expect(parseElement(draw({ penStyle: "laser" }))).toMatchObject({
      penStyle: "pen",
    });
    expect(parseElement(draw({ penStyle: 1 }))).toMatchObject({
      penStyle: "pen",
    });
    for (const penStyle of ["pen", "marker", "highlighter"]) {
      expect(parseElement(draw({ penStyle }))).toMatchObject({ penStyle });
    }
  });

  it("keeps loading every older element type unchanged", () => {
    const old = ELEMENT_TYPES.filter((type) => type !== "shape").map((type) => {
      const element = createElement(type, {
        id: `old-${type}`,
        ...(type === "task" ? { taskId: "t1" } : {}),
      }) as Record<string, unknown>;
      if (type === "draw") delete element.penStyle;
      return element;
    });
    const parsed = sanitizeElements(old);
    expect(parsed).toHaveLength(old.length);
    for (const element of parsed) {
      const source = old.find((entry) => entry.id === element.id);
      expect(element).toEqual(
        element.type === "draw" ? { ...source, penStyle: "pen" } : source,
      );
    }
  });
});

describe("board settings", () => {
  it("fills in the pattern for boards saved before patterns existed", () => {
    expect(parseSettings({ background: "#f8f9fa", gridSize: 20 })).toEqual({
      background: "#f8f9fa",
      gridSize: 20,
      pattern: "plain",
      patternSize: 24,
    });
  });

  it("keeps a known pattern and clamps its size", () => {
    expect(parseSettings({ pattern: "dots", patternSize: 32 })).toMatchObject({
      pattern: "dots",
      patternSize: 32,
    });
    expect(parseSettings({ pattern: "zigzag" }).pattern).toBe("plain");
    expect(parseSettings({ pattern: "grid", patternSize: 2 }).patternSize).toBe(
      8,
    );
    expect(parseSettings({ patternSize: 5000 }).patternSize).toBe(200);
    expect(parseSettings({ patternSize: Number.NaN }).patternSize).toBe(24);
    expect(parseSettings({ patternSize: "30" }).patternSize).toBe(24);
    expect(parseSettings({ patternSize: 30.6 }).patternSize).toBe(31);
  });

  it("stores the pattern in the shared document", () => {
    const doc = new Y.Doc();
    writeSettings(doc, { pattern: "lines", patternSize: 40 });
    expect(readSettings(doc)).toEqual({
      ...DEFAULT_BOARD_SETTINGS,
      pattern: "lines",
      patternSize: 40,
    });
    doc.getMap("settings").set("pattern", "<script>");
    expect(readSettings(doc).pattern).toBe("plain");
    const decoded = decodeBoardState(
      encodeBoardState([], { pattern: "grid", patternSize: 16 }),
    );
    expect(decoded.settings).toMatchObject({
      pattern: "grid",
      patternSize: 16,
    });
  });
});

describe("shape text and templates", () => {
  it("includes shape labels in the board text", () => {
    const text = extractBoardText([
      createElement("shape", { shape: "cloud", text: "Big idea", order: "a1" }),
      createElement("shape", {
        shape: "star",
        text: "Gone",
        order: "a2",
        deleted: true,
      }),
    ]);
    expect(text).toBe("Big idea");
  });

  it("draws the flowchart's other branch as a document shape", () => {
    const elements = templateElements("flowchart", {});
    const documentShape = elements.find(
      (element) => element.type === "shape" && element.shape === "document",
    );
    expect(documentShape).toBeDefined();
    const arrow = elements.find(
      (element) =>
        element.type === "arrow" &&
        element.endBinding?.elementId === documentShape?.id,
    );
    expect(arrow).toBeDefined();
  });
});

describe("shape geometry", () => {
  const triangle = (props: Record<string, unknown> = {}) =>
    createElement("shape", {
      id: "tri",
      shape: "triangle",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      fillColor: "#ffc9c9",
      ...props,
    });

  it("hit tests the real outline, not the box", () => {
    const filled = triangle();
    expect(hitTest(filled, { x: 100, y: 80 }, 0)).toBe(true);
    // The box's top-left corner is outside the triangle.
    expect(hitTest(filled, { x: 10, y: 10 }, 2)).toBe(false);
    const hollow = triangle({ fillColor: "transparent" });
    expect(hitTest(hollow, { x: 100, y: 80 }, 2)).toBe(false);
    expect(hitTest(hollow, { x: 100, y: 100 }, 2)).toBe(true);
    // A point on a slanted edge.
    expect(hitTest(hollow, { x: 50, y: 50 }, 2)).toBe(true);
  });

  it("hit tests rotated shapes in their own frame", () => {
    const rotated = triangle({ angle: Math.PI / 2 });
    const center = { x: 100, y: 50 };
    const toWorld = (x: number, y: number) =>
      rotatePoint({ x, y }, center, Math.PI / 2);
    // Just inside the apex and just inside a base corner.
    expect(hitTest(rotated, toWorld(100, 8), 0)).toBe(true);
    expect(hitTest(rotated, toWorld(12, 96), 0)).toBe(true);
    // Beside the apex, inside the box but outside the triangle.
    expect(hitTest(rotated, toWorld(20, 10), 0)).toBe(false);
    // Inside the unrotated triangle, but outside once it is turned.
    expect(hitTest(triangle(), { x: 20, y: 95 }, 0)).toBe(true);
    expect(hitTest(rotated, { x: 20, y: 95 }, 0)).toBe(false);

    const star = createElement("shape", {
      shape: "star",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      angle: 0.7,
      fillColor: "#ffec99",
    });
    expect(hitTest(star, { x: 50, y: 52 }, 0)).toBe(true);
  });

  it("binds a line end to the outline", () => {
    const shape = triangle();
    // Coming from the left at mid-height, the box edge would be x = 0; the
    // triangle's slanted side is at x = 50.
    const end = pointOnOutline(shape, [0.5, 0.5], 0, { x: -100, y: 50 });
    expect(end.x).toBeCloseTo(50, 5);
    expect(end.y).toBeCloseTo(50, 5);
    const gapped = pointOnOutline(shape, [0.5, 0.5], 10, { x: -100, y: 50 });
    expect(gapped.x).toBeCloseTo(40, 5);

    for (const kind of SHAPE_KINDS) {
      const element = createElement("shape", {
        shape: kind,
        x: 300,
        y: 200,
        width: 160,
        height: 120,
        angle: 0.4,
      });
      const from = { x: 0, y: 0 };
      const hit = pointOnOutline(element, [0.5, 0.5], 0, from);
      // Back in the shape's frame the end lies on its outline.
      const local = rotatePoint(hit, { x: 380, y: 260 }, -0.4);
      const polygon = shapePolygon(kind, 160, 120);
      const distance = distanceToPolygon(
        { x: local.x - 300, y: local.y - 200 },
        polygon,
      );
      expect(distance, kind).toBeLessThan(1e-6);
    }
  });

  it("routes bound arrows to the outline and finds shapes as targets", () => {
    const shape = triangle({ id: "target" });
    const arrow = createElement("arrow", {
      id: "arr",
      x: -200,
      y: 50,
      points: [
        [0, 0],
        [150, 0],
      ],
      endBinding: { elementId: "target", focus: [0.5, 0.5], gap: 0 },
    });
    const [routed] = updateBoundLines([shape, arrow], ["target"]);
    expect(routed?.type).toBe("arrow");
    if (routed?.type !== "arrow") return;
    const last = routed.points[routed.points.length - 1];
    expect(routed.x + last[0]).toBeCloseTo(50, 3);
    expect(findBindTarget([shape], { x: 100, y: 70 }, 4)?.id).toBe("target");
    expect(findBindTarget([shape], { x: 10, y: 10 }, 4)).toBeNull();
  });

  it("bounds a rotated shape by its outline", () => {
    const star = createElement("shape", {
      shape: "star",
      width: 100,
      height: 100,
    });
    expect(elementBounds(star)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const turned = { ...star, angle: Math.PI / 4 };
    const bounds = elementBounds(turned);
    const boxBounds = elementBounds({ ...turned, type: "rectangle" } as never);
    expect(bounds.width).toBeLessThan(boxBounds.width);
    expect(bounds.width).toBeGreaterThan(0);
  });

  it("resizes and mirrors shapes", () => {
    const arrow = createElement("shape", {
      shape: "arrowRight",
      width: 100,
      height: 50,
    });
    const [wider] = resizeElements(
      [arrow],
      "e",
      { x: 100, y: 25 },
      {
        x: 150,
        y: 25,
      },
    );
    expect(wider).toMatchObject({
      type: "shape",
      shape: "arrowRight",
      width: 150,
    });
    const [mirrored] = flipElements([arrow], "horizontal");
    expect(mirrored).toMatchObject({ shape: "arrowLeft", x: 0, width: 100 });
    const [upright] = flipElements([arrow], "vertical");
    expect(upright).toMatchObject({ shape: "arrowRight" });
  });
});
