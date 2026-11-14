import db from "../../database";
import {
  type BoardElement,
  renderToSvg,
  sanitizeElements,
  taskIdsOf,
} from "../board";
import {
  applyBoardChange,
  currentBoardContent,
  writeServerElements,
} from "../content";
import type { WhiteboardCaller } from "../rules";
import { loadWhiteboard } from "../shared";
import { loadTaskCards } from "../task-cards";
import { assertCanEdit } from "./update-whiteboard";

/** The board's elements and settings: the live room here, else stored. */
export async function getWhiteboardContent(whiteboardId: string) {
  const board = await loadWhiteboard(db, whiteboardId);
  return currentBoardContent(board);
}

/**
 * Adds or replaces elements (agents, MCP, integrations). Invalid elements
 * are skipped; the rest win over what the board holds.
 */
export async function addWhiteboardElements({
  whiteboardId,
  elements,
  caller,
}: {
  whiteboardId: string;
  elements: unknown[];
  caller: WhiteboardCaller;
}) {
  const board = await loadWhiteboard(db, whiteboardId);
  assertCanEdit(board, caller);
  const valid = sanitizeElements(elements);
  // The last copy of an id in one request wins.
  const byId = new Map(valid.map((element) => [element.id, element]));
  let written: BoardElement[] = [];
  const { contentVersion } = await applyBoardChange({
    whiteboardId,
    actorId: caller.userId,
    mutate: (doc) => {
      written = writeServerElements(doc, [...byId.values()], caller.userId);
    },
  });
  return {
    elements: written,
    skipped: elements.length - valid.length,
    contentVersion,
  };
}

/** A standalone SVG of the board, with live task cards of its project. */
export async function renderWhiteboardPreview(whiteboardId: string) {
  const board = await loadWhiteboard(db, whiteboardId);
  const content = await currentBoardContent(board);
  const tasks = await loadTaskCards(
    board.projectId,
    taskIdsOf(content.elements),
  );
  return renderToSvg(content.elements, {
    background: content.settings.background,
    padding: 24,
    theme: "light",
    resolveTask: (taskId: string) => tasks[taskId] ?? null,
    // An SVG shown through <img> can't load other resources anyway.
    imageHref: () => null,
  });
}
