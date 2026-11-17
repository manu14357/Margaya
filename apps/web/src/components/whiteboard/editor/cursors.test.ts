import { afterEach, describe, expect, it } from "vitest";
import {
  type CursorContext,
  clearCursorCache,
  contrastInk,
  cursorCacheSize,
  cursorForHandleHover,
  cursorForSelectHover,
  cursorForTool,
  cursorTint,
  eraserCursor,
  laserCursor,
  penCursor,
  rotateCursor,
} from "./cursors";

const base: CursorContext = {
  tool: "select",
  readOnly: false,
  penStyle: "pen",
  strokeColor: "#1e1e1e",
  highlighterColor: "#facc15",
  theme: "light",
  imageSet: null,
};

const ctx = (patch: Partial<CursorContext>): CursorContext => ({
  ...base,
  ...patch,
});

/** The SVG inside the first data URI of a cursor value. */
function svgOf(cursor: string): string {
  const match = /url\("data:image\/svg\+xml,([^"]+)"\)/.exec(cursor);
  if (!match?.[1]) throw new Error(`no SVG in ${cursor}`);
  return decodeURIComponent(match[1]);
}

/** The hotspot and fallback after the plain image. */
function tailOf(cursor: string) {
  const match = /"\) (\d+) (\d+), ([a-z-]+)$/.exec(cursor);
  if (!match) throw new Error(`no hotspot in ${cursor}`);
  return { x: Number(match[1]), y: Number(match[2]), fallback: match[3] };
}

afterEach(() => clearCursorCache());

describe("cursorForTool", () => {
  it("uses keywords for select, hand, text and the creation tools", () => {
    expect(cursorForTool(ctx({ tool: "select" }))).toBe("default");
    expect(cursorForTool(ctx({ tool: "hand" }))).toBe("grab");
    expect(cursorForTool(ctx({ tool: "text" }))).toBe("text");
    for (const tool of [
      "rectangle",
      "diamond",
      "ellipse",
      "shape",
      "arrow",
      "line",
      "frame",
      "sticky",
      "image",
    ] as const) {
      expect(cursorForTool(ctx({ tool }))).toBe("crosshair");
    }
  });

  it("shows grabbing while a pan runs, whatever the tool", () => {
    expect(cursorForTool(ctx({ tool: "hand", panning: true }))).toBe(
      "grabbing",
    );
    expect(cursorForTool(ctx({ tool: "draw", panning: true }))).toBe(
      "grabbing",
    );
    expect(
      cursorForTool(ctx({ tool: "select", readOnly: true, panning: true })),
    ).toBe("grabbing");
  });

  it("draws the pen, marker and highlighter as three different pictograms", () => {
    const pen = cursorForTool(ctx({ tool: "draw", penStyle: "pen" }));
    const marker = cursorForTool(ctx({ tool: "draw", penStyle: "marker" }));
    const highlighter = cursorForTool(
      ctx({ tool: "draw", penStyle: "highlighter" }),
    );
    expect(new Set([svgOf(pen), svgOf(marker), svgOf(highlighter)]).size).toBe(
      3,
    );
    for (const cursor of [pen, marker, highlighter]) {
      expect(tailOf(cursor).fallback).toBe("crosshair");
    }
  });

  it("tints the pen with the stroke colour and the highlighter with its own", () => {
    const pen = svgOf(
      cursorForTool(ctx({ tool: "draw", strokeColor: "#e03131" })),
    );
    expect(pen).toContain('fill="#e03131"');
    expect(pen).toContain('stroke="#e03131"');
    const highlighter = svgOf(
      cursorForTool(
        ctx({
          tool: "draw",
          penStyle: "highlighter",
          strokeColor: "#e03131",
          highlighterColor: "#40c057",
        }),
      ),
    );
    expect(highlighter).toContain('fill="#40c057"');
    expect(highlighter).not.toContain("#e03131");
  });

  it("gives each colour its own cursor", () => {
    const red = cursorForTool(ctx({ tool: "draw", strokeColor: "#e03131" }));
    const blue = cursorForTool(ctx({ tool: "draw", strokeColor: "#1971c2" }));
    expect(red).not.toBe(blue);
  });

  it("shows the laser as a red dot centred on the pointer", () => {
    const cursor = cursorForTool(ctx({ tool: "laser" }));
    expect(svgOf(cursor)).toContain('fill="#ef4444"');
    expect(tailOf(cursor)).toEqual({ x: 16, y: 16, fallback: "crosshair" });
  });

  it("hides the cursor under the eraser ring, with a small ring until it lands", () => {
    expect(cursorForTool(ctx({ tool: "eraser", eraserRing: true }))).toBe(
      "none",
    );
    const fallback = cursorForTool(ctx({ tool: "eraser" }));
    expect(svgOf(fallback)).toContain("<circle");
    expect(tailOf(fallback)).toEqual({ x: 16, y: 16, fallback: "cell" });
  });

  it("keeps a read-only board on the arrow: no drawing cursors", () => {
    for (const tool of [
      "draw",
      "text",
      "eraser",
      "rectangle",
      "arrow",
    ] as const)
      expect(cursorForTool(ctx({ tool, readOnly: true }))).toBe("default");
    expect(cursorForTool(ctx({ tool: "select", readOnly: true }))).toBe(
      "default",
    );
    // Moving the view and pointing still work there.
    expect(cursorForTool(ctx({ tool: "hand", readOnly: true }))).toBe("grab");
    expect(cursorForTool(ctx({ tool: "laser", readOnly: true }))).toContain(
      "url(",
    );
  });
});

describe("pen cursors", () => {
  it("put the hotspot on the nib, bottom left", () => {
    for (const style of ["pen", "marker", "highlighter"] as const) {
      const { x, y } = tailOf(penCursor(style, "#1e1e1e", "light", null));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(8);
      expect(y).toBeGreaterThanOrEqual(22);
      expect(y).toBeLessThan(32);
    }
  });

  it("are 32 px images", () => {
    const svg = svgOf(penCursor("pen", "#1e1e1e", "light", null));
    expect(svg).toContain('width="32" height="32"');
  });

  it("add a 64 px image for 2x screens when the browser takes image-set", () => {
    const cursor = penCursor("marker", "#1e1e1e", "light", "image-set");
    expect(cursor.startsWith("image-set(url(")).toBe(true);
    expect(cursor).toMatch(/ 1x, url\("[^"]+"\) 2x\) \d+ \d+, url\(/);
    expect(decodeURIComponent(cursor)).toContain('width="64" height="64"');
    expect(tailOf(cursor).fallback).toBe("crosshair");
    const prefixed = penCursor(
      "marker",
      "#1e1e1e",
      "light",
      "-webkit-image-set",
    );
    expect(prefixed.startsWith("-webkit-image-set(")).toBe(true);
  });

  it("outline light colours in dark ink and dark colours in light ink", () => {
    expect(contrastInk("#facc15")).toBe("#1e1e1e");
    expect(contrastInk("#1e1e1e")).toBe("#ffffff");
    const svg = svgOf(penCursor("highlighter", "#facc15", "light", null));
    expect(svg).toContain('stroke="#1e1e1e" stroke-width="4"');
  });

  it("show the colour the dark board draws", () => {
    // Dark boards draw black ink pale, and so does the cursor.
    expect(cursorTint("#1e1e1e", "dark")).not.toBe("#1e1e1e");
    expect(penCursor("pen", "#1e1e1e", "dark", null)).not.toBe(
      penCursor("pen", "#1e1e1e", "light", null),
    );
  });

  it("never put an unchecked colour into the SVG", () => {
    const svg = svgOf(
      penCursor("pen", '"/><script>alert(1)</script>', "light", null),
    );
    expect(svg).not.toContain("script");
    expect(cursorTint("transparent", "light")).toBe("#1e1e1e");
  });

  it("are built once per colour and style", () => {
    clearCursorCache();
    const first = penCursor("pen", "#e03131", "light", null);
    expect(cursorCacheSize()).toBe(1);
    expect(penCursor("pen", "#e03131", "light", null)).toBe(first);
    // Equal colours written differently share one entry.
    penCursor("pen", "#E03131", "light", null);
    expect(cursorCacheSize()).toBe(1);
    penCursor("marker", "#e03131", "light", null);
    penCursor("pen", "#1971c2", "light", null);
    expect(cursorCacheSize()).toBe(3);
  });
});

describe("other cursors", () => {
  it("turns resize cursors with the selection and shows an arrow on the rotation handle", () => {
    expect(cursorForHandleHover("e", 0, null)).toBe("ew-resize");
    expect(cursorForHandleHover("e", Math.PI / 2, null)).toBe("ns-resize");
    const rotate = cursorForHandleHover("rotate", 0, null);
    expect(rotate).toBe(rotateCursor(null));
    expect(tailOf(rotate)).toEqual({ x: 16, y: 16, fallback: "grab" });
  });

  it("offers a move only on boards that can change", () => {
    expect(cursorForSelectHover("canvas", false)).toBe("default");
    expect(cursorForSelectHover("element", false)).toBe("move");
    expect(cursorForSelectHover("element", true)).toBe("default");
    expect(cursorForSelectHover("link", true)).toBe("pointer");
    expect(cursorForSelectHover("linePoint", false)).toBe("pointer");
  });

  it("caches the laser and eraser cursors", () => {
    clearCursorCache();
    laserCursor(null);
    laserCursor(null);
    eraserCursor(null);
    eraserCursor(null);
    expect(cursorCacheSize()).toBe(2);
  });
});
