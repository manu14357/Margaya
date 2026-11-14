// The shared board document. Each element is stored whole, as plain JSON,
// under its id in one Y.Map; an edit always replaces the whole value. Yjs
// settles concurrent writes to one key on its own, so every replica converges;
// `writeElements` additionally refuses to overwrite a newer local copy.

import * as Y from "yjs";
import { isNewer } from "./create.js";
import {
  BOARD_DOC,
  type BoardElement,
  type BoardSettings,
  DEFAULT_BOARD_SETTINGS,
} from "./elements.js";
import { sortByOrder } from "./order.js";
import { parseSettings } from "./validate.js";

export function elementsMap(doc: Y.Doc): Y.Map<BoardElement> {
  return doc.getMap<BoardElement>(BOARD_DOC.elements);
}

export function settingsMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(BOARD_DOC.settings);
}

export type ReadOptions = { includeDeleted?: boolean };

/** All elements, bottom first; tombstones only when asked for. */
export function readElements(
  doc: Y.Doc,
  options?: ReadOptions,
): BoardElement[] {
  const elements: BoardElement[] = [];
  for (const element of elementsMap(doc).values()) {
    // Remote peers can store anything; skip values that are not objects.
    if (typeof element !== "object" || element === null) continue;
    if (!options?.includeDeleted && element.deleted) continue;
    elements.push(element);
  }
  return sortByOrder(elements);
}

export function readElement(doc: Y.Doc, id: string): BoardElement | undefined {
  return elementsMap(doc).get(id);
}

/**
 * Writes elements in one transaction. An element is skipped when the stored
 * copy is the same or newer (see `isNewer`). Returns the elements written.
 */
export function writeElements(
  doc: Y.Doc,
  elements: Iterable<BoardElement>,
  origin?: unknown,
): BoardElement[] {
  const map = elementsMap(doc);
  const written: BoardElement[] = [];
  doc.transact(() => {
    for (const element of elements) {
      const stored = map.get(element.id);
      if (stored && !isNewer(element, stored)) continue;
      map.set(element.id, element);
      written.push(element);
    }
  }, origin);
  return written;
}

export function readSettings(doc: Y.Doc): BoardSettings {
  return parseSettings(settingsMap(doc).toJSON());
}

export function writeSettings(
  doc: Y.Doc,
  patch: Partial<BoardSettings>,
  origin?: unknown,
): void {
  const map = settingsMap(doc);
  doc.transact(() => {
    for (const key of Object.keys(
      DEFAULT_BOARD_SETTINGS,
    ) as (keyof BoardSettings)[]) {
      const value = patch[key];
      if (value !== undefined && map.get(key) !== value) map.set(key, value);
    }
  }, origin);
}

/**
 * Calls `listener` with the ids of the elements each transaction changed
 * (added, replaced or removed). Returns a function that stops listening.
 */
export function observeBoard(
  doc: Y.Doc,
  listener: (changedIds: Set<string>, transaction: Y.Transaction) => void,
): () => void {
  const map = elementsMap(doc);
  const handler = (event: Y.YMapEvent<BoardElement>) => {
    listener(new Set(event.keysChanged), event.transaction);
  };
  map.observe(handler);
  return () => map.unobserve(handler);
}

/** Calls `listener` after any transaction that changed board settings. */
export function observeSettings(
  doc: Y.Doc,
  listener: (settings: BoardSettings, transaction: Y.Transaction) => void,
): () => void {
  const map = settingsMap(doc);
  const handler = (event: Y.YMapEvent<unknown>) => {
    listener(readSettings(doc), event.transaction);
  };
  map.observe(handler);
  return () => map.unobserve(handler);
}

export function createBoardDoc(
  elements?: Iterable<BoardElement>,
  settings?: Partial<BoardSettings>,
): Y.Doc {
  const doc = new Y.Doc();
  if (elements) writeElements(doc, elements);
  if (settings) writeSettings(doc, settings);
  return doc;
}

/** A Yjs update that recreates a board with these elements and settings. */
export function encodeBoardState(
  elements: Iterable<BoardElement>,
  settings?: Partial<BoardSettings>,
): Uint8Array {
  const doc = createBoardDoc(elements, settings);
  try {
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/** Reads a stored Yjs update; tombstones are left out unless asked for. */
export function decodeBoardState(
  update: Uint8Array,
  options?: ReadOptions,
): { elements: BoardElement[]; settings: BoardSettings } {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, update);
    return {
      elements: readElements(doc, options),
      settings: readSettings(doc),
    };
  } finally {
    doc.destroy();
  }
}
