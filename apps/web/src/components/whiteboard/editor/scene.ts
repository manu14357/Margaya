import {
  type BoardElement,
  type BoardSettings,
  observeBoard,
  observeSettings,
  readElement,
  readElements,
  readSettings,
  sortByOrder,
} from "@margaya/whiteboard";
import type * as Y from "yjs";

// A read cache over the shared Yjs document. Every write goes through the
// package helpers (see controller.ts); this class only mirrors what the
// document holds, in stacking order, and says who changed it.

/** Transaction origins of this editor's own writes. */
export const LOCAL_ORIGIN = "whiteboard-editor:local";
export const HISTORY_ORIGIN = "whiteboard-editor:history";

export type SceneChange = {
  ids: ReadonlySet<string>;
  /** True when another client (or the server) made the change. */
  remote: boolean;
};

export class BoardScene {
  /** Live elements in stacking order. */
  private live: BoardElement[] = [];
  /** Every element, tombstones included, for undo of deletes. */
  private all = new Map<string, BoardElement>();
  private settings: BoardSettings;
  private listeners = new Set<(change: SceneChange) => void>();
  private stopObserving: (() => void) | null = null;
  private stopSettings: (() => void) | null = null;
  /** Bumped on every change; cheap equality for memoised consumers. */
  version = 0;

  constructor(readonly doc: Y.Doc) {
    this.settings = readSettings(doc);
    this.connect();
  }

  /**
   * Reads the document again and follows it. Safe to call twice; React's
   * strict mode disposes and reconnects the same editor on mount.
   */
  connect(): void {
    if (this.stopObserving) return;
    const doc = this.doc;
    this.all.clear();
    for (const element of readElements(doc, { includeDeleted: true })) {
      this.all.set(element.id, element);
    }
    this.live = this.computeLive();
    this.settings = readSettings(doc);
    this.version++;
    this.stopObserving = observeBoard(doc, (changedIds, transaction) => {
      for (const id of changedIds) {
        const element = readElement(doc, id);
        if (element) this.all.set(id, element);
        else this.all.delete(id);
      }
      this.live = this.computeLive();
      this.version++;
      const origin = transaction.origin;
      const remote =
        !transaction.local ||
        (origin !== LOCAL_ORIGIN && origin !== HISTORY_ORIGIN);
      for (const listener of this.listeners)
        listener({ ids: changedIds, remote });
    });
    this.stopSettings = observeSettings(doc, (settings) => {
      this.settings = settings;
      this.version++;
      for (const listener of this.listeners)
        listener({ ids: new Set(), remote: true });
    });
  }

  private computeLive(): BoardElement[] {
    const live: BoardElement[] = [];
    for (const element of this.all.values())
      if (!element.deleted) live.push(element);
    return sortByOrder(live);
  }

  get elements(): readonly BoardElement[] {
    return this.live;
  }

  get boardSettings(): BoardSettings {
    return this.settings;
  }

  /** A live element by id. */
  get(id: string): BoardElement | undefined {
    const element = this.all.get(id);
    return element && !element.deleted ? element : undefined;
  }

  /** Any element by id, tombstones included. */
  getAny(id: string): BoardElement | undefined {
    return this.all.get(id);
  }

  subscribe(listener: (change: SceneChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.stopObserving?.();
    this.stopSettings?.();
    this.stopObserving = null;
    this.stopSettings = null;
    this.listeners.clear();
  }
}
