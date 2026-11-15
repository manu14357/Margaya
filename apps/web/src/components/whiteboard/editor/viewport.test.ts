import { describe, expect, it } from "vitest";
import { fitRect, toScreen, wheelZoomFactor } from "./viewport";

describe("wheelZoomFactor", () => {
  it("zooms one comfortable step per mouse wheel notch", () => {
    // A notch is 100 pixels in Chromium and 3 lines in Firefox.
    for (const factor of [wheelZoomFactor(-100, 0), wheelZoomFactor(-3, 1)]) {
      expect(factor).toBeGreaterThan(1.1);
      expect(factor).toBeLessThan(1.3);
    }
    expect(wheelZoomFactor(100, 0) * wheelZoomFactor(-100, 0)).toBeCloseTo(1);
  });

  it("follows small trackpad pinch deltas smoothly", () => {
    const step = wheelZoomFactor(-3, 0);
    expect(step).toBeGreaterThan(1);
    expect(step).toBeLessThan(1.05);
    // Twice the delta is twice the change on the log scale: no jumps.
    expect(Math.log(wheelZoomFactor(-6, 0))).toBeCloseTo(2 * Math.log(step));
  });
});

describe("fitRect", () => {
  it("keeps fitted content clear of the floating toolbar and zoom bar", () => {
    // A tall board in a short canvas: height decides the zoom.
    const box = { x: 100, y: 50, width: 300, height: 1000 };
    const viewport = fitRect(box, 1100, 760);
    const top = toScreen(viewport, box.x, box.y);
    const bottom = toScreen(viewport, box.x, box.y + box.height);
    expect(top.y).toBeGreaterThanOrEqual(56);
    expect(760 - bottom.y).toBeGreaterThanOrEqual(56);
  });

  it("never zooms in past 100% for a small board", () => {
    const viewport = fitRect({ x: 0, y: 0, width: 50, height: 50 }, 800, 600);
    expect(viewport.zoom).toBe(1);
  });
});
