// Screen <-> board coordinates. A board point (x, y) lands on the screen at
// ((x + scrollX) * zoom, (y + scrollY) * zoom), relative to the canvas.

export type Viewport = { scrollX: number; scrollY: number; zoom: number };

export type Rect = { x: number; y: number; width: number; height: number };

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

/** The zoom levels the zoom buttons step through. */
const ZOOM_STEPS = [
  0.1, 0.25, 0.33, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
  5, 6, 8, 10, 15, 20, 30,
];

export const DEFAULT_VIEWPORT: Viewport = { scrollX: 0, scrollY: 0, zoom: 1 };

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function toBoard(
  viewport: Viewport,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: screenX / viewport.zoom - viewport.scrollX,
    y: screenY / viewport.zoom - viewport.scrollY,
  };
}

export function toScreen(
  viewport: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (x + viewport.scrollX) * viewport.zoom,
    y: (y + viewport.scrollY) * viewport.zoom,
  };
}

/** Changes the zoom while the board point under the anchor stays put. */
export function zoomAround(
  viewport: Viewport,
  nextZoom: number,
  anchorX: number,
  anchorY: number,
): Viewport {
  const zoom = clampZoom(nextZoom);
  const fixed = toBoard(viewport, anchorX, anchorY);
  return {
    zoom,
    scrollX: anchorX / zoom - fixed.x,
    scrollY: anchorY / zoom - fixed.y,
  };
}

export function nextZoomStep(zoom: number, direction: 1 | -1): number {
  if (direction > 0) {
    return ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? MAX_ZOOM;
  }
  for (let index = ZOOM_STEPS.length - 1; index >= 0; index--) {
    const step = ZOOM_STEPS[index];
    if (step !== undefined && step < zoom - 0.001) return step;
  }
  return MIN_ZOOM;
}

/** The largest zoom change one wheel event makes (about 20%). */
const WHEEL_ZOOM_DELTA_CAP = 24;

/**
 * Wheel delta to a zoom factor. Trackpad pinches arrive as many small
 * ctrl+wheel deltas and follow the fingers; a mouse wheel notch arrives as
 * one large delta (100 pixels or 3 lines) and is capped, so it zooms one
 * comfortable step instead of doubling the zoom.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaY;
  const bounded = Math.max(
    -WHEEL_ZOOM_DELTA_CAP,
    Math.min(WHEEL_ZOOM_DELTA_CAP, pixels),
  );
  return Math.exp(-bounded * 0.0075);
}

export function panBy(viewport: Viewport, dxScreen: number, dyScreen: number) {
  return {
    ...viewport,
    scrollX: viewport.scrollX + dxScreen / viewport.zoom,
    scrollY: viewport.scrollY + dyScreen / viewport.zoom,
  };
}

/** The viewport that shows `box` centred in a `width` x `height` canvas. */
export function fitRect(
  box: Rect,
  width: number,
  height: number,
  options: { padding?: number; maxZoom?: number } = {},
): Viewport {
  // The floating toolbar (top) and zoom bar (bottom) cover about 56px each.
  const padding = options.padding ?? 72;
  const usableW = Math.max(1, width - padding * 2);
  const usableH = Math.max(1, height - padding * 2);
  const zoom = clampZoom(
    Math.min(
      options.maxZoom ?? 1,
      usableW / Math.max(1, box.width),
      usableH / Math.max(1, box.height),
    ),
  );
  return centreOn(box.x + box.width / 2, box.y + box.height / 2, zoom, {
    width,
    height,
  });
}

export function centreOn(
  x: number,
  y: number,
  zoom: number,
  size: { width: number; height: number },
): Viewport {
  return {
    zoom,
    scrollX: size.width / 2 / zoom - x,
    scrollY: size.height / 2 / zoom - y,
  };
}

/** The board area the canvas currently shows. */
export function visibleRect(
  viewport: Viewport,
  width: number,
  height: number,
): Rect {
  const topLeft = toBoard(viewport, 0, 0);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: width / viewport.zoom,
    height: height / viewport.zoom,
  };
}

export function sameViewport(a: Viewport, b: Viewport): boolean {
  return (
    a.zoom === b.zoom && a.scrollX === b.scrollX && a.scrollY === b.scrollY
  );
}
