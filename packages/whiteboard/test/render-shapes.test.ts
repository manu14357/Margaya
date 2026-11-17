import { describe, expect, it } from "vitest";
import type { BoardElement, LocalPoint } from "../src/elements.js";
import { SHAPE_KINDS } from "../src/elements.js";
import {
  compareRenderOrder,
  PATTERN_MIN_SCREEN_SPACING,
  patternFade,
  RenderCache,
  renderElement,
  renderScene,
} from "../src/render/canvas.js";
import type { RenderSceneOptions } from "../src/render/index.js";
import {
  buildElementDrawing,
  elementSceneBounds,
  HIGHLIGHTER_ALPHA,
  type PathItem,
  penSize,
} from "../src/render/shapes.js";
import { opsToPolygon } from "../src/render/sketch.js";
import { renderToSvg } from "../src/render/svg.js";
import { shapePolygon, shapeTextBox } from "../src/shapes.js";
import {
  fakeMeasure,
  makeElement,
  recordingContext,
} from "./render-fixtures.js";

function sceneOptions(
  overrides: Partial<RenderSceneOptions> = {},
): RenderSceneOptions {
  return {
    viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
    width: 800,
    height: 600,
    pixelRatio: 1,
    theme: "light",
    background: "#ffffff",
    gridSize: 0,
    measureText: fakeMeasure,
    cache: new RenderCache(),
    ...overrides,
  };
}

const FILLS = ["none", "solid", "hatch", "cross"] as const;

function everyShape(): BoardElement[] {
  const elements: BoardElement[] = [];
  SHAPE_KINDS.forEach((shape, index) => {
    for (const sketch of [0, 1, 2] as const) {
      for (const fillStyle of FILLS) {
        elements.push(
          makeElement("shape", {
            shape,
            sketch,
            fillStyle,
            fillColor: fillStyle === "none" ? "transparent" : "#a5d8ff",
            strokeStyle: sketch === 2 ? "dashed" : "solid",
            text: index % 2 === 0 ? "Label text that wraps" : "",
            x: index * 10,
            y: sketch * 10,
            angle: sketch * 0.3,
          }),
        );
      }
    }
  });
  return elements;
}

const stroke = (points: LocalPoint[], props = {}) =>
  makeElement("draw", { points, pressures: [], ...props });

function insidePolygon(
  point: LocalPoint,
  polygon: readonly LocalPoint[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

const line = Array.from({ length: 21 }, (_, i): LocalPoint => [i * 10, 0]);

describe("shape rendering", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`draws every kind at every sketch level and fill (${theme})`, () => {
      const ctx = recordingContext();
      const elements = everyShape();
      const stats = renderScene(ctx, elements, sceneOptions({ theme }));
      expect(stats.drawn).toBe(elements.length);
      expect(ctx.calls.some((call) => call.name === "fill")).toBe(true);
      expect(ctx.calls.some((call) => call.name === "stroke")).toBe(true);
      expect(ctx.calls.some((call) => call.name === "fillText")).toBe(true);
    });
  }

  it("keeps the same drawing for the same seed", () => {
    const shape = makeElement("shape", { shape: "cloud", sketch: 2 });
    const options = {
      theme: "light" as const,
      measure: fakeMeasure,
      background: "#fff",
    };
    expect(buildElementDrawing(shape, options)).toEqual(
      buildElementDrawing({ ...shape }, options),
    );
  });

  it("draws exact outlines at sketch level 0 and adds the cylinder rim", () => {
    const options = {
      theme: "light" as const,
      measure: fakeMeasure,
      background: "#fff",
    };
    const cylinder = makeElement("shape", { shape: "cylinder", sketch: 0 });
    const outline = buildElementDrawing(cylinder, options).items.find(
      (item): item is PathItem => item.kind === "path" && !!item.stroke,
    );
    expect(outline?.ops.filter((op) => op[0] === "M")).toHaveLength(2);
  });

  it("lays the label out inside the shape's text box", () => {
    const shape = makeElement("shape", {
      shape: "triangle",
      width: 200,
      height: 160,
      text: "Hi",
    });
    const drawing = buildElementDrawing(shape, {
      theme: "light",
      measure: fakeMeasure,
      background: "#fff",
    });
    const label = drawing.items.find((item) => item.kind === "text");
    const box = shapeTextBox("triangle", 200, 160);
    expect(label?.kind).toBe("text");
    if (label?.kind !== "text") return;
    expect(label.x).toBeGreaterThanOrEqual(box.x);
    expect(label.y).toBeGreaterThanOrEqual(box.y);
    expect(label.x + label.width).toBeLessThanOrEqual(box.x + box.width);
  });

  it("clips hatch fills to the outline", () => {
    const heart = makeElement("shape", {
      shape: "heart",
      fillStyle: "cross",
      fillColor: "#ffc9c9",
      sketch: 0,
      width: 100,
      height: 100,
    });
    const drawing = buildElementDrawing(heart, {
      theme: "light",
      measure: fakeMeasure,
      background: "#fff",
    });
    const hatch = drawing.items[0];
    expect(hatch?.kind).toBe("path");
    if (hatch?.kind !== "path") return;
    expect(hatch.stroke).toBeDefined();
    const outline = shapePolygon("heart", 100, 100, 32);
    let segments = 0;
    for (let index = 1; index < hatch.ops.length; index++) {
      const from = hatch.ops[index - 1];
      const to = hatch.ops[index];
      if (from?.[0] !== "M" || to?.[0] !== "L") continue;
      segments++;
      // Each hatch segment's middle lies inside the heart, never in the dip
      // between the lobes or beside the point.
      const middle: LocalPoint = [(from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
      expect(insidePolygon(middle, outline), `${middle}`).toBe(true);
    }
    expect(segments).toBeGreaterThan(10);
  });
});

describe("pen styles", () => {
  const options = {
    theme: "light" as const,
    measure: fakeMeasure,
    background: "#fff",
  };

  function widthAt(el: BoardElement, x: number): number {
    const item = buildElementDrawing(el, options).items[0];
    if (item?.kind !== "path") return 0;
    const near = opsToPolygon(item.ops, 4).filter(
      (point) => Math.abs(point[0] - x) < 6,
    );
    return (
      Math.max(...near.map((point) => point[1])) -
      Math.min(...near.map((point) => point[1]))
    );
  }

  it("draws a marker wider and at one width despite pressure", () => {
    const pressures = line.map((_, i) => (i % 4 < 2 ? 0.1 : 1));
    const marker = stroke(line, {
      penStyle: "marker",
      pressures,
      simulatePressure: false,
    });
    const pen = stroke(line, {
      penStyle: "pen",
      pressures,
      simulatePressure: false,
    });
    expect(penSize("marker", 2)).toBeGreaterThan(penSize("pen", 2));
    const widths = [40, 60, 100, 140].map((x) => widthAt(marker, x));
    for (const width of widths) {
      expect(width).toBeCloseTo(penSize("marker", 2), 0);
    }
    const penWidths = [40, 60, 100, 140].map((x) => widthAt(pen, x));
    expect(Math.max(...penWidths) - Math.min(...penWidths)).toBeGreaterThan(1);
  });

  it("draws a highlighter wide, flat-ended and see-through", () => {
    const highlighter = stroke(line, { penStyle: "highlighter" });
    const [item] = buildElementDrawing(highlighter, options).items;
    expect(item).toMatchObject({
      kind: "path",
      alpha: HIGHLIGHTER_ALPHA,
      blend: "multiply",
    });
    expect(HIGHLIGHTER_ALPHA).toBeGreaterThanOrEqual(0.35);
    expect(HIGHLIGHTER_ALPHA).toBeLessThanOrEqual(0.4);
    expect(widthAt(highlighter, 100)).toBeCloseTo(penSize("highlighter", 2), 0);
    // Flat ends stop at the first and last points instead of rounding past them.
    if (item?.kind !== "path") return;
    const xs = opsToPolygon(item.ops).map((point) => point[0]);
    expect(Math.min(...xs)).toBeGreaterThan(-2);
    expect(Math.max(...xs)).toBeLessThan(202);
    const dark = buildElementDrawing(highlighter, {
      ...options,
      theme: "dark",
    });
    expect(dark.items[0]).toMatchObject({ blend: "screen" });
    // Its bounds cover the whole width of the stroke.
    expect(elementSceneBounds(highlighter).height).toBeGreaterThanOrEqual(
      penSize("highlighter", 2),
    );
  });

  it("paints the highlighter with reduced alpha and multiply blending", () => {
    const ctx = recordingContext() as ReturnType<typeof recordingContext> & {
      globalCompositeOperation: string;
    };
    const modes: string[] = [];
    let mode = "source-over";
    Object.defineProperty(ctx, "globalCompositeOperation", {
      get: () => mode,
      set: (value: string) => {
        modes.push(value);
        mode = value;
      },
      enumerable: true,
    });
    renderElement(
      ctx,
      stroke(line, { penStyle: "highlighter", opacity: 100 }),
      {
        theme: "light",
        measureText: fakeMeasure,
        cache: new RenderCache(),
      },
    );
    const alphas = ctx.writes
      .filter((write) => write.prop === "globalAlpha")
      .map((write) => write.value as number);
    expect(
      alphas.some((alpha) => Math.abs(alpha - HIGHLIGHTER_ALPHA) < 1e-9),
    ).toBe(true);
    expect(modes).toContain("multiply");
    // save/restore brings the normal mode back for the next element.
    expect(ctx.calls.filter((call) => call.name === "save").length).toBe(
      ctx.calls.filter((call) => call.name === "restore").length,
    );
  });

  it("leaves pens and markers fully opaque", () => {
    for (const penStyle of ["pen", "marker"] as const) {
      const ctx = recordingContext();
      renderElement(ctx, stroke(line, { penStyle }), {
        theme: "light",
        measureText: fakeMeasure,
        cache: new RenderCache(),
      });
      const alphas = ctx.writes
        .filter((write) => write.prop === "globalAlpha")
        .map((write) => write.value);
      expect(alphas.every((alpha) => alpha === 1)).toBe(true);
    }
  });

  it("draws highlighter strokes beneath strokes of the same order", () => {
    const ink = makeElement("draw", { id: "a", order: "a5" });
    const highlight = makeElement("draw", {
      id: "b",
      order: "a5",
      penStyle: "highlighter",
    });
    expect(
      [ink, highlight].sort(compareRenderOrder).map((el) => el.id),
    ).toEqual(["b", "a"]);
    const above = makeElement("draw", {
      id: "c",
      order: "a6",
      penStyle: "highlighter",
    });
    expect([above, ink].sort(compareRenderOrder).map((el) => el.id)).toEqual([
      "a",
      "c",
    ]);
  });
});

describe("background patterns", () => {
  const patternCalls = (options: Partial<RenderSceneOptions>) => {
    const ctx = recordingContext();
    renderScene(ctx, [], sceneOptions(options));
    return {
      strokes: ctx.calls.filter((call) => call.name === "stroke").length,
      rects: ctx.calls.filter((call) => call.name === "fillRect").length,
      moves: ctx.calls.filter((call) => call.name === "moveTo"),
      styles: ctx.writes
        .filter(
          (write) => write.prop === "strokeStyle" || write.prop === "fillStyle",
        )
        .map((write) => String(write.value)),
    };
  };

  it("draws nothing for plain", () => {
    const calls = patternCalls({ pattern: "plain", gridSize: 20 });
    expect(calls.strokes).toBe(0);
    expect(calls.rects).toBe(1);
  });

  it("draws dots, a grid with stronger major lines, and ruled lines", () => {
    const dots = patternCalls({ pattern: "dots", patternSize: 40 });
    expect(dots.rects).toBeGreaterThan(200);
    const grid = patternCalls({ pattern: "grid", patternSize: 40 });
    expect(grid.strokes).toBe(2);
    const inks = grid.styles.filter((style) => style.startsWith("rgba"));
    expect(inks).toHaveLength(2);
    const alpha = (style: string) => Number(/,\s*([\d.]+)\)$/.exec(style)?.[1]);
    expect(alpha(inks[1])).toBeGreaterThan(alpha(inks[0]));
    const lines = patternCalls({ pattern: "lines", patternSize: 40 });
    expect(lines.strokes).toBe(1);
    // Only horizontal rules: every line starts at the left edge.
    expect(lines.moves.every((call) => call.args[0] === 0)).toBe(true);
  });

  it("aligns the pattern to board coordinates so it pans with the board", () => {
    const calls = patternCalls({
      pattern: "lines",
      patternSize: 30,
      viewport: { scrollX: -17, scrollY: -41, zoom: 1.5 },
    });
    expect(calls.moves.length).toBeGreaterThan(0);
    for (const call of calls.moves) {
      const y = call.args[1] as number;
      expect(Math.abs(y / 30 - Math.round(y / 30))).toBeLessThan(1e-9);
    }
  });

  it("culls the pattern when zoomed far out and fades it in", () => {
    const zoom = (PATTERN_MIN_SCREEN_SPACING - 1) / 24;
    for (const pattern of ["dots", "grid", "lines"] as const) {
      const calls = patternCalls({
        pattern,
        patternSize: 24,
        viewport: { scrollX: 0, scrollY: 0, zoom },
      });
      expect(calls.strokes).toBe(0);
      expect(calls.rects).toBe(1);
    }
    expect(patternFade(24, 0.1)).toBe(0);
    expect(patternFade(24, 0.3)).toBeGreaterThan(0);
    expect(patternFade(24, 0.3)).toBeLessThan(1);
    expect(patternFade(24, 1)).toBe(1);
  });

  it("keeps the pattern subtle in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const grid = patternCalls({ pattern: "grid", patternSize: 40, theme });
      for (const style of grid.styles.filter((s) => s.startsWith("rgba"))) {
        expect(Number(/,\s*([\d.]+)\)$/.exec(style)?.[1])).toBeLessThanOrEqual(
          0.25,
        );
      }
    }
  });

  it("falls back to the snap grid when no pattern is given", () => {
    expect(patternCalls({ gridSize: 20 }).strokes).toBe(1);
  });

  it("ignores an unknown pattern", () => {
    const calls = patternCalls({ pattern: "zigzag" as never });
    expect(calls.strokes).toBe(0);
  });
});

describe("SVG output for shapes, pens and patterns", () => {
  const hostile = `</text><script>alert("x")</script>' onload="evil()"`;

  it("renders every kind and pen with no unsafe output", () => {
    const elements: BoardElement[] = [
      ...everyShape(),
      makeElement("shape", { shape: "speech", text: hostile }),
      makeElement("shape", { shape: `star"><script>` as never, text: hostile }),
      stroke(line, { penStyle: "marker" }),
      stroke(line, { penStyle: "highlighter", strokeColor: "#ffd43b" }),
    ];
    for (const pattern of ["plain", "dots", "grid", "lines"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const svg = renderToSvg(elements, { pattern, theme, patternSize: 32 });
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg).not.toMatch(/<script/i);
        expect(svg).not.toMatch(/\son[a-z]+=/i);
        expect(svg).not.toMatch(/foreignObject/i);
        expect(svg).not.toMatch(/javascript:/i);
        expect(svg).not.toMatch(/href/i);
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
        for (const match of svg.matchAll(/style="([^"]*)"/g)) {
          expect(match[1]).toMatch(/^mix-blend-mode:(multiply|screen)$/);
        }
      }
    }
  });

  it("marks the highlighter as see-through and multiplied", () => {
    const svg = renderToSvg([stroke(line, { penStyle: "highlighter" })]);
    expect(svg).toContain(`opacity="${HIGHLIGHTER_ALPHA}"`);
    expect(svg).toContain('style="mix-blend-mode:multiply"');
    expect(renderToSvg([stroke(line)])).not.toContain("mix-blend-mode");
  });

  it("only draws a pattern when the caller asks for one", () => {
    const elements = [makeElement("shape", { shape: "hexagon" })];
    expect(renderToSvg(elements)).not.toContain("<pattern");
    expect(renderToSvg(elements, { pattern: "plain" })).not.toContain(
      "<pattern",
    );
    const dots = renderToSvg(elements, { pattern: "dots", patternSize: 20 });
    expect(dots).toContain(
      '<pattern id="wb-pattern" patternUnits="userSpaceOnUse"',
    );
    expect(dots).toContain('width="20"');
    const grid = renderToSvg(elements, { pattern: "grid", patternSize: 1e9 });
    expect(grid).toContain('width="200"');
    expect(grid).toContain('width="1000"');
    expect(renderToSvg(elements, { pattern: "zigzag" as never })).not.toContain(
      "<pattern",
    );
  });
});

describe("frame titles", () => {
  const texts = (frame: BoardElement, frameTitle?: string) => {
    const drawing = buildElementDrawing(frame, {
      theme: "light",
      measure: fakeMeasure,
      background: "#ffffff",
      frameTitle,
    });
    return drawing.items.flatMap((item) =>
      item.kind === "text" ? item.lines : [],
    );
  };
  const filled = (ctx: ReturnType<typeof recordingContext>) =>
    ctx.calls
      .filter((call) => call.name === "fillText")
      .map((call) => call.args[0]);

  it("titles an unnamed frame with the caller's default, fainter than a name", () => {
    const unnamed = makeElement("frame", { name: "  " });
    expect(texts(unnamed)).toEqual([]);
    expect(texts(unnamed, "Rahmen")).toEqual(["Rahmen"]);
    expect(texts(makeElement("frame", { name: "Ideas" }), "Rahmen")).toEqual([
      "Ideas",
    ]);
    const color = (frame: BoardElement) =>
      buildElementDrawing(frame, {
        theme: "light",
        measure: fakeMeasure,
        background: "#ffffff",
        frameTitle: "Frame",
      }).items.find((item) => item.kind === "text");
    const stand = color(unnamed);
    const real = color(makeElement("frame", { name: "Ideas" }));
    expect(stand?.kind === "text" && stand.color).toMatch(/0\.5\)$/);
    expect(real?.kind === "text" && real.color).toMatch(/0\.75\)$/);
  });

  it("draws the default title on the canvas and redraws when it changes", () => {
    const frame = makeElement("frame", { name: "" });
    const cache = new RenderCache();
    const first = recordingContext();
    renderElement(first, frame, {
      theme: "light",
      measureText: fakeMeasure,
      cache,
      frameTitle: "Frame",
    });
    expect(filled(first)).toEqual(["Frame"]);
    const second = recordingContext();
    renderElement(second, frame, {
      theme: "light",
      measureText: fakeMeasure,
      cache,
      frameTitle: "Cadre",
    });
    expect(filled(second)).toEqual(["Cadre"]);
  });

  it("shows the same default title in SVG exports", () => {
    const frame = makeElement("frame", { name: "" });
    expect(renderToSvg([frame], { frameTitle: "Frame" })).toContain(
      ">Frame</text>",
    );
    expect(renderToSvg([frame])).not.toContain("<text");
  });
});
