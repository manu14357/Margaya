import { describe, expect, it } from "vitest";
import { createElement } from "../src/create.js";
import type { BoardElement } from "../src/elements.js";
import { RenderCache, renderElement } from "../src/render/canvas.js";
import { fakeMeasure, recordingContext } from "./render-fixtures.js";

// An editor previews a drag on copies of the elements with a fresh nonce on
// every frame. Those copies must reuse their drawings; only a change to what
// the element looks like may rebuild one.

function counter() {
  let builds = 0;
  const measure = (value: string, font: string) => {
    builds++;
    return fakeMeasure(value, font);
  };
  return { measure, builds: () => builds };
}

function paint(
  cache: RenderCache,
  el: BoardElement,
  measure: typeof fakeMeasure,
) {
  renderElement(recordingContext(), el, {
    theme: "light",
    measureText: measure,
    cache,
  });
}

describe("the render cache", () => {
  it("reuses a drawing when a preview only moves, turns or fades the element", () => {
    const cache = new RenderCache();
    const { measure, builds } = counter();
    const el = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 120,
      height: 60,
      text: "Label",
    });
    paint(cache, el, measure);
    const first = builds();
    expect(first).toBeGreaterThan(0);
    for (let frame = 1; frame <= 5; frame++) {
      paint(
        cache,
        {
          ...el,
          x: frame * 10,
          y: frame * 5,
          angle: frame / 10,
          opacity: 50,
          version: el.version + 1,
          nonce: frame,
        },
        measure,
      );
    }
    expect(builds()).toBe(first);
  });

  it("rebuilds when the size, style, text or points change", () => {
    const cache = new RenderCache();
    const { measure, builds } = counter();
    const el = createElement("rectangle", {
      width: 120,
      height: 60,
      text: "Label",
    });
    paint(cache, el, measure);
    let last = builds();
    for (const change of [
      { width: 240 },
      { strokeWidth: 6 },
      { fontSize: 40 },
      { text: "Other" },
    ]) {
      paint(cache, { ...el, ...change } as BoardElement, measure);
      expect(builds()).toBeGreaterThan(last);
      last = builds();
    }

    const stroke = createElement("draw", {
      points: [
        [0, 0],
        [40, 10],
      ],
    });
    const drawings = new RenderCache();
    let traced = 0;
    const draw = (el: BoardElement) => {
      const ctx = recordingContext();
      renderElement(ctx, el, {
        theme: "light",
        measureText: fakeMeasure,
        cache: drawings,
        usePath2D: false,
      });
      traced = ctx.calls.filter((call) => call.name === "bezierCurveTo").length;
      return drawings;
    };
    draw(stroke);
    const shape = traced;
    // Same points array, moved: the same drawing.
    draw({ ...stroke, x: 300 });
    expect(traced).toBe(shape);
    // New points (a resize): a new drawing.
    draw({
      ...stroke,
      points: [
        [0, 0],
        [80, 20],
        [120, 0],
      ],
    } as BoardElement);
    expect(traced).not.toBe(shape);
  });
});
