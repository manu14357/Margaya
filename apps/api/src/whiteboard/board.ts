// The server's one seam to the shared board model. Everything the API reads
// from or writes into a board's Yjs document goes through these names, so
// the model can evolve in one place.

export {
  BOARD_DOC,
  BOARD_LIMITS,
  type BoardElement,
  type BoardSettings,
  createBoardDoc,
  createElement,
  DEFAULT_BOARD_SETTINGS,
  decodeBoardState,
  type ElementType,
  elementsMap,
  encodeBoardState,
  extractBoardText,
  parseElement,
  parseSettings,
  readElements,
  readSettings,
  renderToSvg,
  sanitizeElements,
  settingsMap,
  type TaskCardData,
  taskIdsOf,
  writeElements,
} from "@margaya/whiteboard";
