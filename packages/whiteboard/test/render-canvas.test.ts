import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boardToScreen,
  RenderCache,
  renderElement,
  renderScene,
  screenToBoard,
  visibleBoardRect,
} from "../src/render/canvas.js";
import { invertLightness, themeColor } from "../src/render/color.js";
import type { RenderSceneOptions, TaskCardData } from "../src/render/index.js";
import { buildElementDrawing } from "../src/render/shapes.js";
import {
  everyElement,
  fakeMeasure,
  makeElement,
  recordingContext,
} from "./render-fixtures.js";

const task: TaskCardData = {
  key: "MAR-12",
  title:
    "Ship the whiteboard renderer with a fairly long title that needs clamping",
  statusName: "In progress",
  statusColor: "#1971c2",
  assigneeName: "Ada Example",
  dueDate: "2026-11-20T00:00:00.000Z",
  priority: "high",
  done: false,
};

function sceneOptions(
  overrides: Partial<RenderSceneOptions> = {},
): RenderSceneOptions {
  return {
    viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
    width: 800,
    height: 600,
    pixelRatio: 2,
    theme: "light",
    background: "#ffffff",
    gridSize: 20,
    measureText: fakeMeasure,
    resolveTask: (id) => (id === "task-1" ? task : null),
    resolveImage: () => null,
    cache: new RenderCache(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderScene", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const usePath2D of [true, false]) {
      it(`draws every element type (${theme}, Path2D ${usePath2D ? "on" : "off"})`, () => {
        if (usePath2D) {
          vi.stubGlobal(
            "Path2D",
            class {
              moveTo() {}
              lineTo() {}
              bezierCurveTo() {}
              closePath() {}
            },
          );
        }
        const ctx = recordingContext();
        const elements = everyElement();
        const stats = renderScene(
          ctx,
          elements,
          sceneOptions({ theme, usePath2D }),
        );
        expect(stats.drawn).toBe(elements.length);
        expect(stats.culled).toBe(0);
        const names = new Set(ctx.calls.map((call) => call.name));
        expect(names.has("fill")).toBe(true);
        expect(names.has("stroke")).toBe(true);
        expect(names.has("fillText")).toBe(true);
        const saves = ctx.calls.filter((call) => call.name === "save").length;
        const restores = ctx.calls.filter(
          (call) => call.name === "restore",
        ).length;
        expect(saves).toBe(restores);
        if (!usePath2D) expect(names.has("bezierCurveTo")).toBe(true);
      });
    }
  }

  it("culls elements outside the viewport", () => {
    const visible = makeElement("rectangle", { x: 100, y: 100 });
    const far = makeElement("rectangle", { x: 5000, y: 5000 });
    const left = makeElement("ellipse", { x: -900, y: 10 });
    const ctx = recordingContext();
    const stats = renderScene(ctx, [visible, far, left], sceneOptions());
    expect(stats).toEqual({ drawn: 1, culled: 2 });

    const moved = renderScene(
      recordingContext(),
      [visible, far, left],
      sceneOptions({ viewport: { scrollX: -4900, scrollY: -4900, zoom: 1 } }),
    );
    expect(moved).toEqual({ drawn: 1, culled: 2 });
  });

  it("skips deleted and skipped elements", () => {
    const a = makeElement("rectangle");
    const b = makeElement("rectangle", { deleted: true });
    const c = makeElement("rectangle");
    const stats = renderScene(
      recordingContext(),
      [a, b, c],
      sceneOptions({ skipIds: new Set([c.id]) }),
    );
    expect(stats.drawn).toBe(1);
  });

  it("clips frame children to the frame", () => {
    const frame = makeElement("frame", { x: 0, y: 0, width: 200, height: 200 });
    const child = makeElement("rectangle", {
      x: 150,
      y: 150,
      frameId: frame.id,
    });
    const outside = makeElement("rectangle", {
      x: 400,
      y: 400,
      frameId: frame.id,
    });
    const ctx = recordingContext();
    const stats = renderScene(
      ctx,
      [frame, child, outside],
      sceneOptions({ width: 2000, height: 2000 }),
    );
    expect(ctx.calls.filter((call) => call.name === "clip")).toHaveLength(1);
    // The second child lies outside its frame, so nothing of it is visible.
    expect(stats).toEqual({ drawn: 2, culled: 1 });
  });

  it("draws in order-key order", () => {
    const top = makeElement("text", { text: "top", order: "b" });
    const bottom = makeElement("text", { text: "bottom", order: "a" });
    const ctx = recordingContext();
    renderScene(ctx, [top, bottom], sceneOptions());
    const texts = ctx.calls
      .filter((call) => call.name === "fillText")
      .map((call) => call.args[0]);
    expect(texts).toEqual(["bottom", "top"]);
  });

  it("maps the viewport with pixel ratio, zoom and scroll", () => {
    const ctx = recordingContext();
    renderScene(
      ctx,
      [],
      sceneOptions({
        viewport: { scrollX: 10, scrollY: -5, zoom: 2 },
        pixelRatio: 2,
      }),
    );
    const transforms = ctx.calls.filter((call) => call.name === "setTransform");
    expect(transforms[1]?.args).toEqual([4, 0, 0, 4, 40, -20]);
    const point = boardToScreen({ scrollX: 10, scrollY: -5, zoom: 2 }, 0, 0);
    expect(point).toEqual({ x: 20, y: -10 });
    expect(
      screenToBoard({ scrollX: 10, scrollY: -5, zoom: 2 }, 20, -10),
    ).toEqual({ x: 0, y: 0 });
    expect(
      visibleBoardRect({ scrollX: 10, scrollY: -5, zoom: 2 }, 800, 600),
    ).toEqual({
      x: -10,
      y: 5,
      width: 400,
      height: 300,
    });
  });

  it("fills the dark background", () => {
    const ctx = recordingContext();
    renderScene(ctx, [], sceneOptions({ theme: "dark", gridSize: 0 }));
    const fill = ctx.writes.find((write) => write.prop === "fillStyle");
    expect(fill?.value).toBe(invertLightness("#ffffff"));
  });
});

describe("renderElement", () => {
  it("draws a resolved image and leaves its colours alone in dark mode", () => {
    const image = { width: 10, height: 10 };
    const el = makeElement("image", {
      assetId: "a",
      crop: { x: 1, y: 2, width: 3, height: 4 },
    });
    const ctx = recordingContext();
    renderElement(ctx, el, {
      theme: "dark",
      measureText: fakeMeasure,
      resolveImage: () => image,
      cache: new RenderCache(),
    });
    const draw = ctx.calls.find((call) => call.name === "drawImage");
    expect(draw?.args).toEqual([image, 1, 2, 3, 4, 0, 0, 120, 80]);
    expect(ctx.calls.some((call) => call.name === "fill")).toBe(false);
  });

  it("draws the placeholder while the image is unresolved", () => {
    const ctx = recordingContext();
    renderElement(ctx, makeElement("image", { assetId: "a" }), {
      theme: "light",
      measureText: fakeMeasure,
      resolveImage: () => null,
      cache: new RenderCache(),
    });
    expect(ctx.calls.some((call) => call.name === "drawImage")).toBe(false);
    expect(ctx.calls.some((call) => call.name === "fill")).toBe(true);
  });

  it("inverts stroke lightness in dark mode and keeps the hue", () => {
    const el = makeElement("rectangle", { strokeColor: "#1e1e1e", sketch: 0 });
    const ctx = recordingContext();
    renderElement(ctx, el, {
      theme: "dark",
      measureText: fakeMeasure,
      cache: new RenderCache(),
    });
    const stroke = ctx.writes.find((write) => write.prop === "strokeStyle");
    expect(stroke?.value).toBe(themeColor("#1e1e1e", "dark"));
    expect(stroke?.value).not.toBe("#1e1e1e");
    const red = invertLightness("#ffc9c9");
    expect(red).toMatch(/^#/);
    // Pale red becomes dark red: red channel still dominates.
    const r = Number.parseInt(red.slice(1, 3), 16);
    const g = Number.parseInt(red.slice(3, 5), 16);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeLessThan(0xc9);
  });

  it("applies opacity and rotation", () => {
    const el = makeElement("rectangle", {
      opacity: 40,
      angle: 1,
      x: 10,
      y: 20,
    });
    const ctx = recordingContext();
    renderElement(ctx, el, {
      theme: "light",
      measureText: fakeMeasure,
      cache: new RenderCache(),
    });
    expect(
      ctx.writes.find((write) => write.prop === "globalAlpha")?.value,
    ).toBeCloseTo(0.4);
    expect(ctx.calls.find((call) => call.name === "rotate")?.args).toEqual([1]);
    expect(ctx.calls.find((call) => call.name === "translate")?.args).toEqual([
      70, 60,
    ]);
  });

  it("caches drawings by id and content", () => {
    const cache = new RenderCache();
    const el = makeElement("rectangle", { text: "cached" });
    let measured = 0;
    const measure = (value: string, font: string) => {
      measured++;
      return fakeMeasure(value, font);
    };
    renderElement(recordingContext(), el, {
      theme: "light",
      measureText: measure,
      cache,
    });
    const first = measured;
    renderElement(recordingContext(), el, {
      theme: "light",
      measureText: measure,
      cache,
    });
    expect(measured).toBe(first);
    renderElement(
      recordingContext(),
      { ...el, version: 2, text: "changed" },
      { theme: "light", measureText: measure, cache },
    );
    expect(measured).toBeGreaterThan(first);
    expect(cache.size).toBe(1);
    cache.prune(new Set());
    expect(cache.size).toBe(0);
  });

  it("redraws a task card when its data changes", () => {
    const cache = new RenderCache();
    const el = makeElement("task");
    const titles = (data: TaskCardData | null) => {
      const ctx = recordingContext();
      renderElement(ctx, el, {
        theme: "light",
        measureText: fakeMeasure,
        cache,
        resolveTask: () => data,
      });
      return ctx.calls
        .filter((call) => call.name === "fillText")
        .map((call) => call.args[0]);
    };
    expect(titles(null)).toEqual([]);
    const live = titles(task);
    expect(live).toContain("MAR-12");
    expect(live).toContain("AE");
    expect(live).toContain("2026-11-20");
    expect(titles({ ...task, key: "MAR-13" })).toContain("MAR-13");
  });
});

describe("element drawings", () => {
  const options = {
    theme: "light" as const,
    measure: fakeMeasure,
    background: "#ffffff",
  };

  it("clamps a task title to two lines and strikes it through when done", () => {
    const el = makeElement("task");
    const drawing = buildElementDrawing(el, {
      ...options,
      task: { ...task, done: true },
    });
    const title = drawing.items.find(
      (item) => item.kind === "text" && item.fontSize === 14,
    );
    expect(title?.kind === "text" && title.lines.length).toBe(2);
    const strike = drawing.items.filter(
      (item) => item.kind === "path" && item.lineWidth === 1.25,
    );
    expect(strike).toHaveLength(1);
  });

  it("centres sticky text vertically", () => {
    const el = makeElement("sticky", {
      text: "Hi",
      width: 200,
      height: 200,
      verticalAlign: "middle",
    });
    const drawing = buildElementDrawing(el, options);
    const text = drawing.items.find((item) => item.kind === "text");
    expect(text?.kind === "text" && text.y).toBeCloseTo(100 - 12.5);
    const shadowed = drawing.items.find(
      (item) => item.kind === "path" && item.shadow,
    );
    expect(shadowed).toBeDefined();
  });

  it("puts the frame name above the frame", () => {
    const drawing = buildElementDrawing(
      makeElement("frame", { name: "Backlog" }),
      options,
    );
    const label = drawing.items.find((item) => item.kind === "text");
    expect(label?.kind === "text" && label.lines).toEqual(["Backlog"]);
    expect(label?.kind === "text" && label.y).toBeLessThan(0);
  });

  it("routes elbow arrows with orthogonal segments", () => {
    const el = makeElement("arrow", {
      routing: "elbow",
      sketch: 0,
      endHead: "none",
    });
    const drawing = buildElementDrawing(el, options);
    const line = drawing.items[0];
    expect(line?.kind).toBe("path");
    if (line?.kind !== "path") return;
    let previous: readonly number[] = [0, 0];
    for (const op of line.ops) {
      if (op[0] === "Z") continue;
      if (op[0] === "C") {
        previous = [op[5], op[6]];
        continue;
      }
      const point = [op[1], op[2]];
      if (op[0] === "L") {
        const dx = Math.abs(point[0] - previous[0]);
        const dy = Math.abs(point[1] - previous[1]);
        expect(dx < 1e-6 || dy < 1e-6).toBe(true);
      }
      previous = point;
    }
    expect(line.ops.some((op) => op[0] === "C")).toBe(true);
  });

  it("draws each arrowhead kind", () => {
    for (const endHead of ["arrow", "triangle", "dot", "bar"] as const) {
      const drawing = buildElementDrawing(
        makeElement("arrow", { endHead, sketch: 0 }),
        options,
      );
      expect(drawing.items.length).toBeGreaterThan(1);
    }
    const none = buildElementDrawing(
      makeElement("arrow", { endHead: "none", sketch: 0 }),
      options,
    );
    expect(none.items).toHaveLength(1);
  });
});
