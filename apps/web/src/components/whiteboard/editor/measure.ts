// Text width from the browser's canvas metrics, shared by the renderer, the
// text overlay and export so all three wrap text at the same places.

let context: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();
const MAX_CACHE = 5_000;

function getContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context;
  if (typeof document === "undefined") {
    context = null;
    return context;
  }
  try {
    context = document.createElement("canvas").getContext("2d");
  } catch {
    context = null;
  }
  return context;
}

export function measureText(text: string, font: string): number {
  const key = `${font}\u0000${text}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const ctx = getContext();
  // Without a canvas (tests), estimate from the font size.
  let width: number;
  if (ctx) {
    ctx.font = font;
    width = ctx.measureText(text).width;
  } else {
    const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? "16");
    width = text.length * size * 0.55;
  }
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, width);
  return width;
}

/** Forget cached widths, after a web font finished loading. */
export function resetTextMeasurements(): void {
  cache.clear();
}
