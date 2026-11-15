// Transform handles around a selection: eight resize handles on the box
// corners and sides, plus a rotation handle above the top edge. Positions are
// in board units; sizes are given in screen pixels and divided by the zoom so
// the handles keep the same on-screen size at every zoom level.

import type { BoardElement } from "@margaya/whiteboard";

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type HandleId = ResizeHandle | "rotate";

export type SelectionFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation around the box centre, in radians. */
  angle: number;
};

export type HandleLayout = {
  id: HandleId;
  /** Centre of the handle in board units (already rotated). */
  x: number;
  y: number;
  /** Side length in board units. */
  size: number;
};

export const HANDLE_SIZE_MOUSE = 9;
export const HANDLE_SIZE_TOUCH = 18;
/** Distance of the rotation handle above the box, in screen pixels. */
export const ROTATE_OFFSET = 22;

export function rotateAround(
  x: number,
  y: number,
  cx: number,
  cy: number,
  angle: number,
): { x: number; y: number } {
  if (!angle) return { x, y };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

export function layoutHandles(
  frame: SelectionFrame,
  zoom: number,
  options: { coarse?: boolean; rotatable?: boolean; resizable?: boolean } = {},
): HandleLayout[] {
  const screenSize = options.coarse ? HANDLE_SIZE_TOUCH : HANDLE_SIZE_MOUSE;
  const size = screenSize / zoom;
  const { x, y, width, height, angle } = frame;
  const cx = x + width / 2;
  const cy = y + height / 2;
  // Pad tiny boxes so the handles do not sit on top of each other.
  const pad = 4 / zoom;
  const left = x - pad;
  const right = x + width + pad;
  const top = y - pad;
  const bottom = y + height + pad;
  const handles: HandleLayout[] = [];
  const push = (id: HandleId, hx: number, hy: number) => {
    const point = rotateAround(hx, hy, cx, cy, angle);
    handles.push({ id, x: point.x, y: point.y, size });
  };
  if (options.resizable !== false) {
    push("nw", left, top);
    push("ne", right, top);
    push("sw", left, bottom);
    push("se", right, bottom);
    // Side handles only when the box is large enough on screen to hold them.
    const minSide = screenSize * 4;
    if (width * zoom > minSide) {
      push("n", cx, top);
      push("s", cx, bottom);
    }
    if (height * zoom > minSide) {
      push("w", left, cy);
      push("e", right, cy);
    }
  }
  if (options.rotatable !== false) {
    push("rotate", cx, top - ROTATE_OFFSET / zoom);
  }
  return handles;
}

/** The handle under a board point, if any. Slightly generous for fingers. */
export function handleAt(
  handles: readonly HandleLayout[],
  x: number,
  y: number,
  slack = 1.4,
): HandleId | null {
  // Later handles (the rotation one) sit on top.
  for (let index = handles.length - 1; index >= 0; index--) {
    const handle = handles[index];
    if (!handle) continue;
    const reach = (handle.size / 2) * slack;
    if (Math.abs(x - handle.x) <= reach && Math.abs(y - handle.y) <= reach)
      return handle.id;
  }
  return null;
}

const CURSOR_ORDER: ResizeHandle[] = [
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
];
const CURSORS = [
  "ns-resize",
  "nesw-resize",
  "ew-resize",
  "nwse-resize",
  "ns-resize",
  "nesw-resize",
  "ew-resize",
  "nwse-resize",
];

/** The CSS cursor for a handle, turned with the selection's rotation. */
export function cursorForHandle(handle: HandleId, angle: number): string {
  if (handle === "rotate") return "grab";
  const base = CURSOR_ORDER.indexOf(handle);
  const steps = Math.round(normaliseAngle(angle) / (Math.PI / 4));
  return CURSORS[(base + steps + 8) % 8] ?? "default";
}

export function normaliseAngle(angle: number): number {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
}

/** Snaps an angle to 15 degree steps (Shift while rotating). */
export function snapAngle(angle: number, step = Math.PI / 12): number {
  return Math.round(angle / step) * step;
}

/**
 * Whether a resize keeps the selection's proportions. One image or text keeps
 * them unless Shift is held. Several elements stretch freely, except that a
 * group, text or an image scales like a picture from a corner, and rotated
 * elements always scale evenly: stretching a turned box along the screen
 * axes would shear it, which a box cannot show. Shift always keeps them.
 */
export function resizeKeepsAspect(
  elements: readonly BoardElement[],
  handle: ResizeHandle,
  shift: boolean,
): boolean {
  if (elements.length === 1) {
    const only = elements[0];
    const natural = only?.type === "image" || only?.type === "text";
    return shift !== natural;
  }
  if (shift) return true;
  // Lines and drawings carry their turn in their points, so only boxes count.
  if (elements.some((element) => element.angle !== 0 && !("points" in element)))
    return true;
  const corner = handle.length === 2;
  return (
    corner &&
    elements.some(
      (element) =>
        element.groupIds.length > 0 ||
        element.type === "text" ||
        element.type === "image",
    )
  );
}

/**
 * Where the edges a handle drags sit on the unrotated frame: `x` for the
 * left or right side, `y` for the top or bottom, null for a side the handle
 * leaves alone.
 */
export function draggedEdges(
  frame: SelectionFrame,
  handle: ResizeHandle,
): { x: number | null; y: number | null } {
  return {
    x: handle.includes("e")
      ? frame.x + frame.width
      : handle.includes("w")
        ? frame.x
        : null,
    y: handle.includes("s")
      ? frame.y + frame.height
      : handle.includes("n")
        ? frame.y
        : null,
  };
}

/** Whether a board point lies inside the (rotated) frame. */
export function frameContains(
  frame: SelectionFrame,
  x: number,
  y: number,
  slack = 0,
) {
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const local = rotateAround(x, y, cx, cy, -frame.angle);
  return (
    local.x >= frame.x - slack &&
    local.x <= frame.x + frame.width + slack &&
    local.y >= frame.y - slack &&
    local.y <= frame.y + frame.height + slack
  );
}
