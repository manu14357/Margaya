import { describe, expect, it } from "vitest";
import { createElement } from "../src/create.js";
import { BOARD_LIMITS, DEFAULT_BOARD_SETTINGS } from "../src/elements.js";
import {
  isValidColor,
  isValidLink,
  parseElement,
  parseSettings,
  sanitizeElements,
} from "../src/validate.js";

const rect = (extra: Record<string, unknown> = {}) => ({
  ...createElement("rectangle", { id: "r1" }),
  ...extra,
});

describe("parseElement: hostile input", () => {
  it("rejects things that are not elements", () => {
    for (const raw of [
      null,
      undefined,
      42,
      "rectangle",
      [],
      [rect()],
      {},
      { type: "rectangle" },
      { type: "script", id: "x" },
      { type: "__proto__", id: "x" },
    ]) {
      expect(parseElement(raw)).toBeNull();
    }
  });

  it("rejects bad ids", () => {
    expect(parseElement(rect({ id: "" }))).toBeNull();
    expect(parseElement(rect({ id: "a b" }))).toBeNull();
    expect(parseElement(rect({ id: "<script>" }))).toBeNull();
    expect(parseElement(rect({ id: "x".repeat(65) }))).toBeNull();
    expect(parseElement(rect({ id: 7 }))).toBeNull();
  });

  it("rejects non-finite or non-numeric geometry", () => {
    for (const key of ["x", "y", "width", "height", "angle"]) {
      expect(parseElement(rect({ [key]: Number.NaN }))).toBeNull();
      expect(
        parseElement(rect({ [key]: Number.POSITIVE_INFINITY })),
      ).toBeNull();
      expect(parseElement(rect({ [key]: "10" }))).toBeNull();
    }
  });

  it("drops unknown fields and fields of other types", () => {
    const parsed = parseElement(
      rect({
        evil: "<img onerror=alert(1)>",
        points: [
          [0, 0],
          [1, 1],
        ],
        taskId: "t1",
        __proto__: { polluted: true },
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("evil");
    expect(parsed).not.toHaveProperty("points");
    expect(parsed).not.toHaveProperty("taskId");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not read inherited properties", () => {
    const raw = Object.create({ type: "rectangle", id: "inherited" });
    expect(parseElement(raw)).toBeNull();
  });

  it("falls back to defaults for bad style values", () => {
    const parsed = parseElement(
      rect({
        fillStyle: "zigzag",
        strokeStyle: 3,
        sketch: 9,
        opacity: -50,
        fontFamily: "Comic",
        locked: "yes",
        strokeWidth: Number.NaN,
      }),
    );
    expect(parsed?.fillStyle).toBe("solid");
    expect(parsed?.strokeStyle).toBe("solid");
    expect(parsed?.sketch).toBe(2);
    expect(parsed?.opacity).toBe(0);
    expect(parsed?.locked).toBe(false);
    expect(parsed?.strokeWidth).toBe(2);
    if (parsed?.type !== "rectangle") throw new Error("expected rectangle");
    expect(parsed.fontFamily).toBe("hand");
  });
});

describe("parseElement: limits", () => {
  it("clamps coordinates, sizes, fonts and strokes", () => {
    const parsed = parseElement(
      rect({
        x: 1e12,
        y: -1e12,
        width: -40,
        height: 1e12,
        fontSize: 10_000,
        strokeWidth: 500,
        angle: -Math.PI / 2,
      }),
    );
    expect(parsed?.x).toBe(BOARD_LIMITS.maxCoordinate);
    expect(parsed?.y).toBe(-BOARD_LIMITS.maxCoordinate);
    expect(parsed?.width).toBe(40);
    expect(parsed?.height).toBe(BOARD_LIMITS.maxDimension);
    expect(parsed?.strokeWidth).toBe(BOARD_LIMITS.maxStrokeWidth);
    expect(parsed?.angle).toBeCloseTo((3 * Math.PI) / 2);
    if (parsed?.type !== "rectangle") throw new Error("expected rectangle");
    expect(parsed.fontSize).toBe(BOARD_LIMITS.maxFontSize);
  });

  it("caps text, names and group depth", () => {
    const parsed = parseElement(
      rect({
        text: "x".repeat(BOARD_LIMITS.maxTextLength + 500),
        groupIds: Array.from({ length: 50 }, (_, i) => `g${i}`),
      }),
    );
    if (parsed?.type !== "rectangle") throw new Error("expected rectangle");
    expect(parsed.text).toHaveLength(BOARD_LIMITS.maxTextLength);
    expect(parsed.groupIds).toHaveLength(BOARD_LIMITS.maxGroupDepth);
    const frame = parseElement({
      ...createElement("frame", { id: "f1" }),
      name: "n".repeat(1_000),
    });
    if (frame?.type !== "frame") throw new Error("expected frame");
    expect(frame.name).toHaveLength(BOARD_LIMITS.maxNameLength);
  });

  it("caps points and rejects broken ones", () => {
    const many = Array.from(
      { length: BOARD_LIMITS.maxPoints + 100 },
      (_, i) => [i, i],
    );
    const draw = parseElement({
      ...createElement("draw", { id: "d1" }),
      points: many,
      pressures: many.map(() => 0.5),
    });
    if (draw?.type !== "draw") throw new Error("expected draw");
    expect(draw.points).toHaveLength(BOARD_LIMITS.maxPoints);
    // Pressures no longer line up with the capped points.
    expect(draw.pressures).toEqual([]);

    const line = createElement("line", { id: "l1" });
    expect(parseElement({ ...line, points: [[0, 0]] })).toBeNull();
    expect(
      parseElement({
        ...line,
        points: [
          [0, 0],
          [1, Number.NaN],
        ],
      }),
    ).toBeNull();
    expect(parseElement({ ...line, points: "M0 0" })).toBeNull();
  });

  it("normalises line points and drops self bindings", () => {
    const parsed = parseElement({
      ...createElement("arrow", { id: "a1" }),
      x: 0,
      y: 0,
      points: [
        [10, 10],
        [30, 50],
      ],
      startBinding: { elementId: "a1", focus: [0.5, 0.5], gap: 2 },
      endBinding: { elementId: "box", focus: [5, -1], gap: 1e9 },
    });
    if (parsed?.type !== "arrow") throw new Error("expected arrow");
    expect(parsed.x).toBe(10);
    expect(parsed.points).toEqual([
      [0, 0],
      [20, 40],
    ]);
    expect(parsed.width).toBe(20);
    expect(parsed.height).toBe(40);
    expect(parsed.startBinding).toBeNull();
    expect(parsed.endBinding?.focus).toEqual([1, 0]);
    expect(parsed.endBinding?.gap).toBeLessThanOrEqual(1_000);
  });

  it("requires a task id on task cards", () => {
    expect(parseElement({ ...createElement("task"), taskId: "" })).toBeNull();
    expect(
      parseElement({ ...createElement("task"), taskId: "t_1" })?.type,
    ).toBe("task");
  });

  it("keeps only sane image crops", () => {
    const image = createElement("image", { id: "i1" });
    const crop = (value: unknown) => {
      const parsed = parseElement({ ...image, crop: value });
      if (parsed?.type !== "image") throw new Error("expected image");
      return parsed.crop;
    };
    expect(crop({ x: 1, y: 2, width: 3, height: 4 })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(crop({ x: -1, y: 0, width: 3, height: 4 })).toBeNull();
    expect(crop({ x: 0, y: 0, width: 0, height: 4 })).toBeNull();
    expect(crop("full")).toBeNull();
  });
});

describe("colours", () => {
  it("accepts the allowed forms", () => {
    for (const color of [
      "#fff",
      "#1E1E1E",
      "#11223344",
      "transparent",
      "rgb(1, 2, 3)",
      "rgba(255,255,255,0.5)",
      "rgba(10%, 20%, 30%, 50%)",
    ]) {
      expect(isValidColor(color)).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const color of [
      "",
      "red",
      "#ff",
      "#ggg",
      "#12345",
      "url(javascript:alert(1))",
      "rgb(1,2)",
      "rgb(1,2,3);background:url(x)",
      "expression(alert(1))",
      "#fff ",
      12,
      null,
    ]) {
      expect(isValidColor(color)).toBe(false);
    }
    const parsed = parseElement(rect({ strokeColor: "red", fillColor: "<b>" }));
    expect(parsed?.strokeColor).toBe("#1e1e1e");
    expect(parsed?.fillColor).toBe("transparent");
    const sticky = parseElement({
      ...createElement("sticky", { id: "s1" }),
      fillColor: "javascript:1",
    });
    expect(sticky?.fillColor).toBe("#fff3bf");
  });
});

describe("links", () => {
  it("accepts web, mail and element links", () => {
    for (const link of [
      "https://example.com",
      "http://example.com:8080/path?q=1#top",
      "mailto:someone@example.com",
      "mailto:someone@example.com?subject=hi",
      "#element=abc_123",
    ]) {
      expect(isValidLink(link)).toBe(true);
    }
  });

  it("rejects scripts, data, odd schemes and smuggled characters", () => {
    for (const link of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      " javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:x",
      "file:///etc/passwd",
      "//example.com",
      "https://",
      "https://user:pass@example.com",
      "https://exa mple.com",
      "https://example.com/\u0000",
      'https://example.com/"onmouseover="x',
      "#element=",
      "#element=a b",
      "#other=abc",
      `https://example.com/${"a".repeat(BOARD_LIMITS.maxLinkLength)}`,
    ]) {
      expect(isValidLink(link)).toBe(false);
    }
    expect(
      parseElement(rect({ link: "javascript:alert(1)" }))?.link,
    ).toBeNull();
  });
});

describe("parseSettings", () => {
  it("returns defaults for junk", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_BOARD_SETTINGS);
    expect(
      parseSettings({ background: "url(x)", gridSize: Number.NaN }),
    ).toEqual(DEFAULT_BOARD_SETTINGS);
  });

  it("keeps valid values and clamps the grid", () => {
    expect(
      parseSettings({ background: "#000", gridSize: 20.4, extra: 1 }),
    ).toEqual({
      background: "#000",
      gridSize: 20,
      pattern: "plain",
      patternSize: 24,
    });
    expect(parseSettings({ gridSize: -5 }).gridSize).toBe(0);
    expect(parseSettings({ gridSize: 1e9 }).gridSize).toBe(1_000);
  });
});

describe("sanitizeElements", () => {
  it("drops junk, keeps the newer duplicate and returns [] for non-arrays", () => {
    const element = createElement("rectangle", { id: "dup" });
    const newer = { ...element, version: 5, x: 99 };
    const result = sanitizeElements([
      null,
      element,
      "x",
      newer,
      { type: "nope" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(99);
    expect(sanitizeElements("[]")).toEqual([]);
    expect(sanitizeElements({ length: 3 })).toEqual([]);
  });

  it("stops at the element limit", () => {
    const raw = Array.from(
      { length: BOARD_LIMITS.maxElements + 10 },
      (_, i) => ({
        type: "rectangle",
        id: `e${i}`,
      }),
    );
    expect(sanitizeElements(raw)).toHaveLength(BOARD_LIMITS.maxElements);
  });
});

describe("draw pressure", () => {
  const points = [
    [0, 0],
    [10, 5],
    [20, 10],
  ];

  it("reads a stroke saved before pressure existed as simulated", () => {
    const { pressures, simulatePressure, penStyle, ...old } = createElement(
      "draw",
      { id: "d1", points },
    );
    void pressures;
    void simulatePressure;
    void penStyle;
    const draw = parseElement(old);
    if (draw?.type !== "draw") throw new Error("expected draw");
    expect(draw.pressures).toEqual([]);
    expect(draw.simulatePressure).toBe(true);
    expect(draw.penStyle).toBe("pen");
  });

  it("keeps pen pressure to two decimals, clamped to 0..1", () => {
    const draw = parseElement({
      ...createElement("draw", { id: "d1", points }),
      pressures: [0.123456, 1.7, -0.2],
      simulatePressure: false,
    });
    if (draw?.type !== "draw") throw new Error("expected draw");
    expect(draw.pressures).toEqual([0.12, 1, 0]);
    expect(draw.simulatePressure).toBe(false);
  });

  it("drops pressures that are not one number per point", () => {
    for (const bad of [[0.5], [0.5, 0.5, "x"], "0.5,0.5,0.5", null]) {
      const draw = parseElement({
        ...createElement("draw", { id: "d1", points }),
        pressures: bad,
        simulatePressure: false,
      });
      if (draw?.type !== "draw") throw new Error("expected draw");
      expect(draw.pressures).toEqual([]);
    }
  });
});
