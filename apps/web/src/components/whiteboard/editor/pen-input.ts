// Stylus rules for the canvas: palm rejection and the pen's eraser. Pure, so
// the decisions can be tested without a pen.

/**
 * How long after the pen was last seen (down, moving or hovering) a new touch
 * still counts as the hand holding it. A palm usually lands while the pen
 * hovers just above the screen.
 */
export const PEN_GRACE_MS = 500;

/** The `buttons` bit of a pen's eraser end (and some barrel buttons). */
const ERASER_BUTTONS = 32;
/** The `button` value a pen's eraser end reports when it goes down. */
const ERASER_BUTTON = 5;

type PointerLike = Pick<PointerEvent, "pointerType" | "button" | "buttons">;

/** The pen's eraser end, or its eraser button held down. */
export function isPenEraser(event: PointerLike): boolean {
  return (
    event.pointerType === "pen" &&
    ((event.buttons & ERASER_BUTTONS) !== 0 || event.button === ERASER_BUTTON)
  );
}

/**
 * What a new touch may do:
 * - "ignore": a pen is down or was just near the screen, so it is a palm;
 * - "pan": "Draw with pen only" is on, so touch moves and zooms the view;
 * - "normal": touch draws, selects and pans like a mouse, and two fingers pinch.
 */
export type TouchPolicy = "ignore" | "pan" | "normal";

export function touchPolicy(input: {
  /** A pen pointer is down on the canvas. */
  penDown: boolean;
  /** `performance.now()` when the pen was last seen; -Infinity for never. */
  lastPenAt: number;
  now: number;
  penOnly: boolean;
}): TouchPolicy {
  if (input.penDown || input.now - input.lastPenAt < PEN_GRACE_MS)
    return "ignore";
  return input.penOnly ? "pan" : "normal";
}
