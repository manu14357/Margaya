import type { BoardElement } from "./elements.js";
import { sortByOrder } from "./order.js";

export const MAX_BOARD_TEXT_LENGTH = 100_000;

function textOf(element: BoardElement): string {
  switch (element.type) {
    case "frame":
      return element.name;
    case "draw":
    case "image":
    case "task":
      return "";
    default:
      return element.text;
  }
}

/**
 * All readable text on a board (text, stickies, shape and line labels, frame
 * names), bottom to top, one entry per line. Used for search and previews.
 */
export function extractBoardText(elements: readonly BoardElement[]): string {
  const parts: string[] = [];
  let length = 0;
  for (const element of sortByOrder(elements)) {
    if (element.deleted) continue;
    const text = textOf(element).trim();
    if (!text) continue;
    parts.push(text);
    length += text.length + 1;
    if (length > MAX_BOARD_TEXT_LENGTH) break;
  }
  return parts.join("\n").slice(0, MAX_BOARD_TEXT_LENGTH);
}

/** Ids of the tasks that have a live card on the board, each once. */
export function taskIdsOf(elements: readonly BoardElement[]): string[] {
  const ids = new Set<string>();
  for (const element of sortByOrder(elements)) {
    if (element.type === "task" && !element.deleted && element.taskId) {
      ids.add(element.taskId);
    }
  }
  return [...ids];
}
