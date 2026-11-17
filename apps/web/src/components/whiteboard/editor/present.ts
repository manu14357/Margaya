import type { BoardElement, FrameElement } from "@margaya/whiteboard";

// Present mode: a read-only, full-screen walk through the board's frames, or
// the whole board when it has none. Pure helpers, so the order and the keys
// can be tested without a canvas.

/**
 * The board's frames in reading order: rows from top to bottom, each row
 * from left to right. A frame that starts above the middle of a row's first
 * frame belongs to that row, so slightly uneven rows still read naturally.
 */
export function presentationFrames(
  elements: readonly BoardElement[],
): FrameElement[] {
  const frames = elements.filter(
    (element): element is FrameElement =>
      element.type === "frame" && !element.deleted,
  );
  const byTop = [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: FrameElement[][] = [];
  for (const frame of byTop) {
    const row = rows[rows.length - 1];
    const first = row?.[0];
    if (row && first && frame.y < first.y + first.height / 2) row.push(frame);
    else rows.push([frame]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x || a.y - b.y));
}

export type PresentStep = "next" | "previous" | "first" | "last";
export type PresentAction = PresentStep | "exit";

/** What a key does in present mode, or null when it does nothing. */
export function presentKeyAction(key: string): PresentAction | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
    case "Enter":
      return "next";
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Escape":
      return "exit";
    default:
      return null;
  }
}

/** The frame index after a step; stays within 0..count-1 (no wrapping). */
export function stepPresentation(
  index: number,
  count: number,
  step: PresentStep,
): number {
  if (count <= 0) return 0;
  const last = count - 1;
  switch (step) {
    case "next":
      return Math.min(last, Math.max(0, index + 1));
    case "previous":
      return Math.max(0, Math.min(last, index - 1));
    case "first":
      return 0;
    case "last":
      return last;
  }
}

/** Whether the board was opened to present (`?present=1`). */
export function isPresentSearch(value: unknown): boolean {
  return value === 1 || value === "1" || value === true;
}

/** The board's URL that opens straight into present mode. */
export function presentUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("element");
  url.searchParams.set("present", "1");
  url.hash = "";
  return url.toString();
}
