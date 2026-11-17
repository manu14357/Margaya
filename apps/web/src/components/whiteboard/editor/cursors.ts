import {
  colorLuminance,
  isTransparentColor,
  type PenStyle,
  themeColor,
} from "@margaya/whiteboard";
import { cursorForHandle, type HandleId } from "./handles";
import type { ToolId } from "./tools";

// CSS cursors for the canvas. Custom cursors are small SVG data URIs, built
// once per colour and style and then served from a cache, so the pointer
// handlers can ask for a cursor on every move without allocating. Every
// custom cursor ends in a keyword the browser uses when it cannot show it.
// Cursors are decorative: touch never shows them, and nothing animates.

export type CursorContext = {
  tool: ToolId;
  /** A read-only or locked board: no drawing cursors. */
  readOnly: boolean;
  penStyle: PenStyle;
  /** The colour of the next pen or marker stroke, as stored. */
  strokeColor: string;
  /** The colour of the next highlighter stroke, as stored. */
  highlighterColor: string;
  theme: "light" | "dark";
  /** A pan (Hand tool, Space or middle button) is under way. */
  panning?: boolean;
  /** The overlay draws a ring the size of the eraser, which is then the cursor. */
  eraserRing?: boolean;
  /** How to offer the 2x image; detected from the browser when left out. */
  imageSet?: ImageSetSyntax | null;
};

export type ImageSetSyntax = "image-set" | "-webkit-image-set";

export const PANNING_CURSOR = "grabbing";
export const HAND_CURSOR = "grab";

/** What the pointer is over while the Select tool hovers. */
export type SelectHoverTarget = "canvas" | "element" | "link" | "linePoint";

/** The pictograms' view box: a 24 unit icon with room for its outline. */
const VIEW_MIN = -1;
const VIEW_SIZE = 26;
/** On-screen size of every custom cursor, in CSS pixels. */
const CURSOR_PX = 32;

/** Ink for outlines on light tints, and for the pale outline on dark ones. */
const DARK_INK = "#1e1e1e";
const LIGHT_INK = "#ffffff";
const LASER_RED = "#ef4444";

type Pictogram = {
  /** Closed shapes filled with the tint. */
  fills: readonly string[];
  /** Every outline, drawn in contrasting ink and then in the tint. */
  strokes: readonly string[];
  /** The nib tip in the 24 unit box: the hotspot. */
  tip: readonly [number, number];
};

// The same outlines as the toolbar's pen buttons, so the cursor reads as the
// button that was pressed.
const PEN_PICTOGRAMS: Record<PenStyle, Pictogram> = {
  pen: {
    fills: [
      "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
    ],
    strokes: [
      "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      "m15 5 4 4",
    ],
    tip: [2.2, 21.8],
  },
  marker: {
    fills: [
      "M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z",
    ],
    strokes: [
      "m11 10 3 3",
      "M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z",
      "M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031",
    ],
    tip: [2.4, 20.6],
  },
  highlighter: {
    fills: ["M9 11 3 17v3h9l3-3z"],
    strokes: [
      "m9 11-6 6v3h9l3-3",
      "m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4",
    ],
    tip: [3, 19.5],
  },
};

/** A turning arrow around the hotspot, for the rotation handle. */
const ROTATE_PICTOGRAM: Pictogram = {
  fills: [],
  strokes: [
    "M20 12a8 8 0 1 1-8-8c2.24 0 4.38.89 5.99 2.43L20 8.5",
    "M20 4v4.5h-4.5",
  ],
  tip: [12, 12],
};

const cache = new Map<string, string>();
/** Colours change rarely; the cap only guards against an unbounded palette. */
const CACHE_LIMIT = 64;

/** Entries in the cursor cache (for tests). */
export function cursorCacheSize(): number {
  return cache.size;
}

export function clearCursorCache(): void {
  cache.clear();
  detected = undefined;
}

function cached(key: string, build: () => string): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = build();
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

let detected: ImageSetSyntax | null | undefined;

/** Whether this browser takes `image-set()` in `cursor` (asked once). */
export function detectImageSet(): ImageSetSyntax | null {
  if (detected !== undefined) return detected;
  detected = null;
  try {
    const supports =
      typeof CSS !== "undefined" && typeof CSS.supports === "function"
        ? CSS.supports.bind(CSS)
        : null;
    if (supports) {
      for (const syntax of ["image-set", "-webkit-image-set"] as const) {
        if (supports("cursor", `${syntax}(url("data:,") 1x) 0 0, auto`)) {
          detected = syntax;
          break;
        }
      }
    }
  } catch {
    detected = null;
  }
  return detected;
}

function svgUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function hotspot(point: readonly [number, number]): [number, number] {
  const scale = CURSOR_PX / VIEW_SIZE;
  return [
    Math.round((point[0] - VIEW_MIN) * scale),
    Math.round((point[1] - VIEW_MIN) * scale),
  ];
}

/**
 * A cursor value from an SVG body: a 32 px image (and a 64 px one for 2x
 * screens when the browser takes `image-set()`), the hotspot and a keyword.
 */
function svgCursor(
  body: string,
  hot: readonly [number, number],
  fallback: string,
  imageSet: ImageSetSyntax | null,
): string {
  const open = (px: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${VIEW_MIN} ${VIEW_MIN} ${VIEW_SIZE} ${VIEW_SIZE}" fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const [x, y] = hotspot(hot);
  const one = svgUrl(open(CURSOR_PX));
  if (!imageSet) return `${one} ${x} ${y}, ${fallback}`;
  const two = svgUrl(open(CURSOR_PX * 2));
  return `${imageSet}(${one} 1x, ${two} 2x) ${x} ${y}, ${one} ${x} ${y}, ${fallback}`;
}

function pictogramSvg(pictogram: Pictogram, tint: string, ink: string) {
  const paths = (list: readonly string[], attrs: string) =>
    list.map((d) => `<path d="${d}" ${attrs}/>`).join("");
  return (
    paths(pictogram.fills, `fill="${tint}"`) +
    paths(pictogram.strokes, `stroke="${ink}" stroke-width="4"`) +
    paths(pictogram.strokes, `stroke="${tint}" stroke-width="2"`)
  );
}

/**
 * The colour a stroke shows on the canvas (dark boards draw ink lighter, as
 * the renderer does). Anything that does not parse, or is see-through, falls
 * back to the default ink, so stored values never reach the SVG unchecked.
 */
export function cursorTint(color: string, theme: "light" | "dark"): string {
  const usable = isTransparentColor(color) ? null : color;
  return themeColor(usable, theme);
}

/** Outline ink that stands out against a tint, so the cursor shows on any board. */
export function contrastInk(tint: string): string {
  return colorLuminance(tint) > 0.4 ? DARK_INK : LIGHT_INK;
}

/** The pen, marker or highlighter cursor in a stroke colour. */
export function penCursor(
  style: PenStyle,
  color: string,
  theme: "light" | "dark",
  imageSet: ImageSetSyntax | null = detectImageSet(),
): string {
  const tint = cursorTint(color, theme);
  return cached(`pen|${style}|${tint}|${imageSet ?? ""}`, () => {
    const pictogram = PEN_PICTOGRAMS[style] ?? PEN_PICTOGRAMS.pen;
    return svgCursor(
      pictogramSvg(pictogram, tint, contrastInk(tint)),
      pictogram.tip,
      "crosshair",
      imageSet,
    );
  });
}

/** A small red dot, the laser pointer's tip. */
export function laserCursor(
  imageSet: ImageSetSyntax | null = detectImageSet(),
): string {
  return cached(`laser|${imageSet ?? ""}`, () =>
    svgCursor(
      `<circle cx="12" cy="12" r="4.5" fill="${LIGHT_INK}" stroke="${DARK_INK}" stroke-opacity="0.35" stroke-width="0.75"/><circle cx="12" cy="12" r="3" fill="${LASER_RED}"/>`,
      [12, 12],
      "crosshair",
      imageSet,
    ),
  );
}

/**
 * A small ring for the eraser, used until the overlay draws a ring the size
 * of the eraser itself.
 */
export function eraserCursor(
  imageSet: ImageSetSyntax | null = detectImageSet(),
): string {
  return cached(`eraser|${imageSet ?? ""}`, () =>
    svgCursor(
      `<circle cx="12" cy="12" r="5" stroke="${LIGHT_INK}" stroke-width="2.5"/><circle cx="12" cy="12" r="5" stroke="${DARK_INK}" stroke-width="1.1"/>`,
      [12, 12],
      "cell",
      imageSet,
    ),
  );
}

/** A turning arrow for the rotation handle. */
export function rotateCursor(
  imageSet: ImageSetSyntax | null = detectImageSet(),
): string {
  return cached(`rotate|${imageSet ?? ""}`, () =>
    svgCursor(
      pictogramSvg(ROTATE_PICTOGRAM, DARK_INK, LIGHT_INK),
      ROTATE_PICTOGRAM.tip,
      "grab",
      imageSet,
    ),
  );
}

/** The cursor over a transform handle: resize arrows turned with the selection, or the rotate arrow. */
export function cursorForHandleHover(
  handle: HandleId,
  angle: number,
  imageSet: ImageSetSyntax | null = detectImageSet(),
): string {
  return handle === "rotate"
    ? rotateCursor(imageSet)
    : cursorForHandle(handle, angle);
}

/** The Select tool's cursor for what lies under the pointer. */
export function cursorForSelectHover(
  target: SelectHoverTarget,
  readOnly: boolean,
): string {
  switch (target) {
    case "link":
    case "linePoint":
      return "pointer";
    case "element":
      // A read-only board cannot move anything: no promise of a drag.
      return readOnly ? "default" : "move";
    case "canvas":
      return "default";
  }
}

/** The canvas cursor for a tool, before hover refines it. */
export function cursorForTool(context: CursorContext): string {
  if (context.panning) return PANNING_CURSOR;
  const imageSet =
    context.imageSet === undefined ? detectImageSet() : context.imageSet;
  const { tool } = context;
  // Viewing works on any board; making marks needs write access.
  if (tool === "hand") return HAND_CURSOR;
  if (tool === "laser") return laserCursor(imageSet);
  if (tool === "select" || context.readOnly) return "default";
  switch (tool) {
    case "draw":
      return penCursor(
        context.penStyle,
        context.penStyle === "highlighter"
          ? context.highlighterColor
          : context.strokeColor,
        context.theme,
        imageSet,
      );
    case "text":
      return "text";
    case "eraser":
      return context.eraserRing ? "none" : eraserCursor(imageSet);
    default:
      // Shapes, lines, arrows, frames, notes and placed images.
      return "crosshair";
  }
}
