import * as Y from "yjs";
import {
  BOARD_DOC,
  BOARD_LIMITS,
  type BoardElement,
  type BoardSettings,
  parseElement,
  parseSettings,
} from "../board";

// What a client may put into a board document. Before an update is applied
// its structure is checked: plain JSON values in the two known maps only
// (no nested shared types, text, binary or sub-documents, no other root
// types). After it is applied, every changed element is run through the
// board model's validator and repaired or removed by the server.

const ROOTS = new Set<string>([BOARD_DOC.elements, BOARD_DOC.settings]);

/** Why an update's structure is refused, or null when it may be applied. */
export function boardUpdateShapeError(update: Uint8Array): string | null {
  const { structs } = Y.decodeUpdate(update);
  for (const struct of structs) {
    if (!(struct instanceof Y.Item)) continue;
    const content = struct.content;
    if (
      !(content instanceof Y.ContentAny) &&
      !(content instanceof Y.ContentDeleted)
    ) {
      return "only plain values are allowed";
    }
    const parent = struct.parent;
    if (typeof parent === "string") {
      if (!ROOTS.has(parent)) return `unknown root ${parent}`;
      if (struct.parentSub === null) return "list content is not allowed";
    } else if (parent !== null) {
      // An ID parent is a nested shared type, which boards never hold.
      return "nested types are not allowed";
    }
  }
  return null;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type ElementRepair = {
  /** Keys to delete: unrecoverable values, or over the element limit. */
  remove: string[];
  /** Values to replace with their validated form. */
  replace: BoardElement[];
};

/**
 * The repairs for changed element keys. `added` lists the keys this change
 * created; past the limit those are removed, newest last.
 */
export function elementRepairs(
  map: Y.Map<unknown>,
  changedKeys: Iterable<string>,
  added: ReadonlySet<string>,
): ElementRepair {
  const remove: string[] = [];
  const replace: BoardElement[] = [];
  let overLimit = map.size - BOARD_LIMITS.maxElements;
  for (const key of changedKeys) {
    if (!map.has(key)) continue;
    if (overLimit > 0 && added.has(key)) {
      remove.push(key);
      overLimit--;
      continue;
    }
    const value = map.get(key);
    const parsed =
      key.length <= BOARD_LIMITS.maxIdLength ? parseElement(value) : null;
    if (!parsed || parsed.id !== key) {
      remove.push(key);
    } else if (!sameJson(parsed, value)) {
      // One version up, so editors that compare versions take the repair.
      replace.push({ ...parsed, version: parsed.version + 1 });
    }
  }
  return { remove, replace };
}

export type SettingsRepair = {
  remove: string[];
  set: Partial<BoardSettings>;
};

/** Repairs for the settings map: unknown keys go, values are validated. */
export function settingsRepairs(map: Y.Map<unknown>): SettingsRepair {
  const raw = Object.fromEntries(map.entries());
  const parsed = parseSettings(raw);
  const known = new Set(Object.keys(parsed));
  const remove = [...map.keys()].filter((key) => !known.has(key));
  const set: Partial<BoardSettings> = {};
  for (const [key, value] of Object.entries(parsed) as [
    keyof BoardSettings,
    BoardSettings[keyof BoardSettings],
  ][]) {
    if (map.has(key) && !sameJson(map.get(key), value)) {
      (set as Record<string, unknown>)[key] = value;
    }
  }
  return { remove, set };
}

export function hasRepairs(
  elements: ElementRepair,
  settings: SettingsRepair | null,
): boolean {
  return (
    elements.remove.length > 0 ||
    elements.replace.length > 0 ||
    (settings !== null &&
      (settings.remove.length > 0 || Object.keys(settings.set).length > 0))
  );
}
