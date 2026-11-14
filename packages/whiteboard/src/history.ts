// Local undo and redo. A step remembers, per element, only the fields the
// local user changed. Undo writes those fields back onto the element as it
// is *now*, so a collaborator's edits to other fields of the same element
// survive, and every write is a normal new version.

import { type ElementOptions, updateElement } from "./create.js";
import type { BoardElement } from "./elements.js";

export const HISTORY_LIMIT = 200;

/** Bookkeeping fields that change on every write and are never restored. */
const STAMP_FIELDS = new Set([
  "id",
  "type",
  "version",
  "nonce",
  "updatedAt",
  "updatedBy",
]);

type Fields = Record<string, unknown>;

type Change = {
  id: string;
  before: Fields;
  after: Fields;
  /** The full element when the step created it, so redo can recreate it. */
  created?: BoardElement;
};

type Step = Change[];

const same = (a: unknown, b: unknown) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

function diff(
  before: BoardElement | undefined,
  after: BoardElement | undefined,
): Change | null {
  if (!after && !before) return null;
  if (!before && after) {
    const fields: Fields = {};
    for (const [key, value] of Object.entries(after)) {
      if (!STAMP_FIELDS.has(key)) fields[key] = value;
    }
    return {
      id: after.id,
      before: { deleted: true },
      after: fields,
      created: after,
    };
  }
  if (before && !after) {
    return {
      id: before.id,
      before: { deleted: false },
      after: { deleted: true },
    };
  }
  const b = before as BoardElement;
  const a = after as BoardElement;
  const changedBefore: Fields = {};
  const changedAfter: Fields = {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const key of keys) {
    if (STAMP_FIELDS.has(key)) continue;
    const from = (b as Fields)[key];
    const to = (a as Fields)[key];
    if (!same(from, to)) {
      changedBefore[key] = from;
      changedAfter[key] = to;
    }
  }
  if (Object.keys(changedAfter).length === 0) return null;
  return { id: a.id, before: changedBefore, after: changedAfter };
}

export type HistoryOptions = ElementOptions & { limit?: number };

export class BoardHistory {
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private batchDepth = 0;
  private batchBefore = new Map<string, BoardElement | undefined>();
  private batchAfter = new Map<string, BoardElement | undefined>();
  private readonly limit: number;
  private readonly options: ElementOptions;

  constructor(options?: HistoryOptions) {
    this.limit = Math.max(1, options?.limit ?? HISTORY_LIMIT);
    this.options = { userId: options?.userId };
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get isBatching(): boolean {
    return this.batchDepth > 0;
  }

  /**
   * Records one local change: `before` holds the touched elements as they
   * were (leave out elements the change created), `after` as they are now
   * (leave out elements it removed outright). Clears the redo stack.
   */
  record(
    before: readonly BoardElement[],
    after: readonly BoardElement[],
  ): void {
    if (this.batchDepth > 0) {
      for (const element of before) {
        if (!this.batchBefore.has(element.id))
          this.batchBefore.set(element.id, element);
      }
      for (const element of after) {
        if (!this.batchBefore.has(element.id))
          this.batchBefore.set(element.id, undefined);
        this.batchAfter.set(element.id, element);
      }
      return;
    }
    const beforeById = new Map(before.map((element) => [element.id, element]));
    const afterById = new Map(after.map((element) => [element.id, element]));
    this.push(beforeById, afterById);
  }

  /** Starts folding several `record` calls (a drag, a typing burst) into one step. */
  beginBatch(): void {
    this.batchDepth++;
  }

  /** Ends a batch; the outermost commit stores the folded step. */
  commitBatch(): void {
    if (this.batchDepth === 0) return;
    this.batchDepth--;
    if (this.batchDepth > 0) return;
    const before = this.batchBefore;
    const after = this.batchAfter;
    this.batchBefore = new Map();
    this.batchAfter = new Map();
    this.push(before, after);
  }

  /** Forgets everything, including an open batch. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.batchDepth = 0;
    this.batchBefore = new Map();
    this.batchAfter = new Map();
  }

  /**
   * Reverts the latest step. `current` looks up each element as it is now;
   * the returned elements are the writes to apply (already version-bumped).
   */
  undo(current: (id: string) => BoardElement | undefined): BoardElement[] {
    const step = this.undoStack.pop();
    if (!step) return [];
    this.redoStack.push(step);
    return this.apply(step, current, "before");
  }

  /** Re-applies the latest undone step. */
  redo(current: (id: string) => BoardElement | undefined): BoardElement[] {
    const step = this.redoStack.pop();
    if (!step) return [];
    this.undoStack.push(step);
    return this.apply(step, current, "after");
  }

  private push(
    before: Map<string, BoardElement | undefined>,
    after: Map<string, BoardElement | undefined>,
  ): void {
    const ids = new Set([...before.keys(), ...after.keys()]);
    const step: Step = [];
    for (const id of ids) {
      const change = diff(before.get(id), after.get(id));
      if (change) step.push(change);
    }
    if (step.length === 0) return;
    this.undoStack.push(step);
    if (this.undoStack.length > this.limit) {
      this.undoStack.splice(0, this.undoStack.length - this.limit);
    }
    this.redoStack = [];
  }

  private apply(
    step: Step,
    current: (id: string) => BoardElement | undefined,
    side: "before" | "after",
  ): BoardElement[] {
    const writes: BoardElement[] = [];
    for (const change of step) {
      const fields = change[side];
      const now = current(change.id);
      if (!now) {
        // Gone from the document entirely: only a redo of a creation can
        // bring it back.
        if (side === "after" && change.created) {
          writes.push(
            updateElement(
              change.created,
              { ...fields, deleted: false },
              this.options,
            ),
          );
        }
        continue;
      }
      const needed = Object.entries(fields).some(
        ([key, value]) => !same((now as Fields)[key], value),
      );
      if (!needed) continue;
      writes.push(
        updateElement(now, fields as Partial<BoardElement>, this.options),
      );
    }
    return writes;
  }
}
