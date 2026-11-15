import {
  type BoardElement,
  type ImageElement,
  updateElement,
} from "@margaya/whiteboard";
import type { ResizeHandle } from "./handles";

// Image cropping maths. Everything happens in the picture's own frame: its
// origin is the top-left corner of the whole, uncropped picture as it lies on
// the board, its axes turn with the element, and it is measured in board
// units. The picture never moves in that frame while the kept window changes,
// so any window maps straight back onto the element's x/y/width/height and
// its `crop` (which is stored in the picture's own pixels).

type P = { x: number; y: number };

export type CropRect = { x: number; y: number; width: number; height: number };

export type PictureFrame = {
  /** Board position of the whole picture's top-left corner. */
  origin: P;
  /** The element's rotation, in radians. */
  angle: number;
  /** Board units per picture pixel, across and down. */
  scaleX: number;
  scaleY: number;
  /** The whole picture's size in board units. */
  width: number;
  height: number;
  /** The part the element shows, in the frame. */
  window: CropRect;
};

export type PictureSize = { width: number; height: number };

/** Picture pixels below which a crop counts as the whole picture. */
const WHOLE_TOLERANCE = 1e-3;

function turn(point: P, angle: number): P {
  if (!angle) return point;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

const positive = (value: number) => Number.isFinite(value) && value > 0;

/** The crop an image shows: its stored one when usable, else the whole picture. */
export function visibleCrop(
  element: ImageElement,
  natural: PictureSize,
): CropRect {
  const crop = element.crop;
  if (
    crop &&
    Number.isFinite(crop.x) &&
    Number.isFinite(crop.y) &&
    positive(crop.width) &&
    positive(crop.height)
  )
    return { ...crop };
  return { x: 0, y: 0, width: natural.width, height: natural.height };
}

/** Lays the whole picture out on the board, or null when it has no size. */
export function pictureFrame(
  element: ImageElement,
  natural: PictureSize,
): PictureFrame | null {
  if (
    !positive(natural.width) ||
    !positive(natural.height) ||
    !positive(element.width) ||
    !positive(element.height)
  )
    return null;
  const crop = visibleCrop(element, natural);
  const scaleX = element.width / crop.width;
  const scaleY = element.height / crop.height;
  const window = {
    x: crop.x * scaleX,
    y: crop.y * scaleY,
    width: element.width,
    height: element.height,
  };
  // The element turns about its own centre; walk from there back to the
  // picture's corner along the turned axes.
  const centre = {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };
  const back = turn(
    { x: -(window.x + window.width / 2), y: -(window.y + window.height / 2) },
    element.angle,
  );
  return {
    origin: { x: centre.x + back.x, y: centre.y + back.y },
    angle: element.angle,
    scaleX,
    scaleY,
    width: natural.width * scaleX,
    height: natural.height * scaleY,
    window,
  };
}

/** A board point in the picture's frame. */
export function toPictureFrame(frame: PictureFrame, point: P): P {
  return turn(
    { x: point.x - frame.origin.x, y: point.y - frame.origin.y },
    -frame.angle,
  );
}

/** A point of the picture's frame on the board. */
export function fromPictureFrame(frame: PictureFrame, point: P): P {
  const turned = turn(point, frame.angle);
  return { x: frame.origin.x + turned.x, y: frame.origin.y + turned.y };
}

/** The element showing `window` of the picture, the picture staying put. */
export function showWindow(
  element: ImageElement,
  frame: PictureFrame,
  window: CropRect,
  options?: { userId?: string | null },
): BoardElement {
  const centre = fromPictureFrame(frame, {
    x: window.x + window.width / 2,
    y: window.y + window.height / 2,
  });
  const crop = {
    x: window.x / frame.scaleX,
    y: window.y / frame.scaleY,
    width: window.width / frame.scaleX,
    height: window.height / frame.scaleY,
  };
  const naturalWidth = frame.width / frame.scaleX;
  const naturalHeight = frame.height / frame.scaleY;
  const whole =
    Math.abs(crop.x) < WHOLE_TOLERANCE &&
    Math.abs(crop.y) < WHOLE_TOLERANCE &&
    Math.abs(crop.width - naturalWidth) < WHOLE_TOLERANCE &&
    Math.abs(crop.height - naturalHeight) < WHOLE_TOLERANCE;
  return updateElement(
    element,
    {
      x: centre.x - window.width / 2,
      y: centre.y - window.height / 2,
      width: window.width,
      height: window.height,
      crop: whole ? null : crop,
    },
    options,
  );
}

/** The element showing the whole picture again, where it already lay. */
export function uncropped(
  element: ImageElement,
  frame: PictureFrame,
  options?: { userId?: string | null },
): BoardElement {
  return showWindow(
    element,
    frame,
    { x: 0, y: 0, width: frame.width, height: frame.height },
    options,
  );
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Slides the window over the picture, never past its edges. */
export function moveWindow(
  frame: PictureFrame,
  start: CropRect,
  delta: P,
): CropRect {
  return {
    ...start,
    x: clamp(start.x + delta.x, 0, Math.max(0, frame.width - start.width)),
    y: clamp(start.y + delta.y, 0, Math.max(0, frame.height - start.height)),
  };
}

/**
 * Drags one handle of the window by `delta` (frame units). The opposite side
 * stays put (both sides with `fromCenter`); the window never leaves the
 * picture and never turns inside out: dragging past the far side stops at
 * `minSize`. With `keepAspect` the window keeps its proportions, a side
 * handle growing the other axis about its centre.
 */
export function resizeWindow(
  frame: PictureFrame,
  start: CropRect,
  handle: ResizeHandle,
  delta: P,
  options: {
    keepAspect?: boolean;
    fromCenter?: boolean;
    minSize?: number;
  } = {},
): CropRect {
  const east = handle.includes("e");
  const west = handle.includes("w");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const across = east || west;
  const down = north || south;
  const keepAspect = Boolean(options.keepAspect);
  const fromCenter = Boolean(options.fromCenter);
  const factor = fromCenter ? 2 : 1;

  // What stays put, as a fraction of the window: 0 the near side, 1 the far
  // side, 0.5 the centre.
  const anchorX = fromCenter || !across ? 0.5 : east ? 0 : 1;
  const anchorY = fromCenter || !down ? 0.5 : south ? 0 : 1;
  const fixedX = start.x + anchorX * start.width;
  const fixedY = start.y + anchorY * start.height;
  const room = (anchor: number, fixed: number, size: number) =>
    anchor === 0
      ? size - fixed
      : anchor === 1
        ? fixed
        : 2 * Math.min(fixed, size - fixed);
  const maxWidth = room(anchorX, fixedX, frame.width);
  const maxHeight = room(anchorY, fixedY, frame.height);
  const floor = options.minSize ?? 8;
  const minWidth = Math.min(floor, start.width, maxWidth);
  const minHeight = Math.min(floor, start.height, maxHeight);

  let width = start.width;
  let height = start.height;
  if (across) width = start.width + factor * (east ? delta.x : -delta.x);
  if (down) height = start.height + factor * (south ? delta.y : -delta.y);

  if (keepAspect && start.width > 0 && start.height > 0) {
    const growX = width / start.width;
    const growY = height / start.height;
    // A corner follows whichever axis the pointer changed most.
    const grow =
      across && down
        ? Math.abs(growX - 1) >= Math.abs(growY - 1)
          ? growX
          : growY
        : across
          ? growX
          : growY;
    const most = Math.min(maxWidth / start.width, maxHeight / start.height);
    const least = Math.min(
      most,
      Math.max(minWidth / start.width, minHeight / start.height),
    );
    const scale = clamp(grow, least, most);
    width = start.width * scale;
    height = start.height * scale;
  } else {
    width = clamp(width, minWidth, maxWidth);
    height = clamp(height, minHeight, maxHeight);
  }

  return {
    x: fixedX - anchorX * width,
    y: fixedY - anchorY * height,
    width,
    height,
  };
}
