import {
  type BoardElement,
  BoardHistory,
  type BoardSettings,
  compareOrder,
  createElement,
  deleteElement,
  duplicateElements,
  type ElementType,
  elementBounds,
  expandSelectionToGroups,
  frameChildren,
  ordersBetween,
  RenderCache,
  randomNonce,
  rebaseElement,
  renderScene,
  sortByOrder,
  type TaskCardData,
  topOrder,
  updateBoundLines,
  updateElement,
  writeElements,
  writeSettings,
} from "@margaya/whiteboard";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { createImageCache, type ImageCache } from "./image-cache";
import { measureText } from "./measure";
import {
  PresencePublisher,
  type RemotePresence,
  readRemotePresence,
} from "./presence";
import { BoardScene, HISTORY_ORIGIN, LOCAL_ORIGIN } from "./scene";
import { type DependencyLink, dependencyLinkOf } from "./selection-info";
import {
  applyToolEvent,
  createEditorStore,
  type EditorState,
  type EditorStore,
  loadPrefs,
  pruneSelection,
  savePrefs,
  setSelection,
  setViewport,
} from "./store";
import type { ToolEvent } from "./tools";
import type { CollaboratorIdentity } from "./types";
import {
  centreOn,
  clampZoom,
  fitRect,
  type Rect,
  toBoard,
  type Viewport,
  visibleRect,
  zoomAround,
} from "./viewport";

// The editor's engine, independent of React: it owns the scene cache, the
// local undo history, the gesture preview, rendering and presence. React
// mounts the canvases and the chrome around it.

export type NoticeKind =
  | "readOnly"
  | "copied"
  | "linkCopied"
  | "pasteEmpty"
  | "uploadFailed"
  | "imageType"
  | "imageMissing"
  | "uploading"
  | "imagesOff"
  | "importFailed"
  | "imported"
  | "tooManyElements"
  | "dependencyCreated"
  | "dependencyFailed"
  | "cropUnavailable";

export type ControllerCallbacks = {
  openTask?: (taskId: string) => void;
  notice?: (kind: NoticeKind) => void;
  openLink?: (url: string) => void;
  /** Deleted arrows that joined two task cards (start card first). */
  dependencyArrowsRemoved?: (links: DependencyLink[]) => void;
};

export type ControllerOptions = {
  doc: Y.Doc;
  awareness: Awareness | null;
  readOnly: boolean;
  user: CollaboratorIdentity | null;
  whiteboardId: string;
  theme: "light" | "dark";
  imageUrl: (assetId: string) => string;
  uploadImage?: (
    file: File,
  ) => Promise<{ assetId: string; width: number; height: number }>;
  isPublic: boolean;
};

/** Things the interactive layer draws on top of the scene. */
export type OverlayState = {
  box: Rect | null;
  guides: readonly { x1: number; y1: number; x2: number; y2: number }[];
  bindTargetId: string | null;
  eraserTrail: readonly (readonly [number, number])[];
  /** Elements the eraser will remove on release. */
  erasing: ReadonlySet<string>;
  hoverId: string | null;
};

const EMPTY_OVERLAY: OverlayState = {
  box: null,
  guides: [],
  bindTargetId: null,
  eraserTrail: [],
  erasing: new Set(),
  hoverId: null,
};

/** How often a running drag is written to the shared document. */
const PREVIEW_FLUSH_MS = 60;
const PREVIEW_FLUSH_MAX_MS = 250;

/** A non-negative 31-bit random integer, without the crypto API's cost. */
function cheapNonce(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export type LaserTrail = { points: [number, number, number][] };

export class BoardController {
  readonly store: EditorStore;
  readonly scene: BoardScene;
  readonly history: BoardHistory;
  images: ImageCache;
  private readonly renderCache = new RenderCache();
  options: ControllerOptions;
  callbacks: ControllerCallbacks = {};
  overlay: OverlayState = EMPTY_OVERLAY;

  /** Elements changed by the running gesture, not yet committed. */
  private preview = new Map<string, BoardElement>();
  /** Snapshot of the previewed elements before the gesture (for history). */
  private previewBase = new Map<string, BoardElement | undefined>();
  private previewFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Elements the preview flushed to the document while the gesture runs. */
  private previewWritten = false;

  private staticCanvas: HTMLCanvasElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private dpr = 1;
  private frame = 0;
  private dirtyStatic = true;
  private dirtyOverlay = true;
  /** Paints the interactive layer; returns true to keep animating. */
  overlayPainter: ((ctx: CanvasRenderingContext2D) => boolean) | null = null;
  private presenceListeners = new Set<() => void>();
  private taskCards: ReadonlyMap<string, TaskCardData> = new Map();
  private presence: PresencePublisher;
  remote: RemotePresence[] = [];
  /** Bumped whenever `remote` changes, for React subscribers. */
  presenceVersion = 0;
  /** Own laser trail: board points with a timestamp. */
  laser: [number, number, number][] = [];
  private disposers: (() => void)[] = [];
  private connected = false;
  private imagesDisposed = false;
  /** Copied style (Ctrl+Alt+C). */
  copiedStyle: Partial<BoardElement> | null = null;
  /** The image whose crop session holds an open history batch. */
  private cropSession: string | null = null;

  constructor(options: ControllerOptions) {
    this.options = options;
    this.history = new BoardHistory({ userId: options.user?.id ?? null });
    this.store = createEditorStore(loadPrefs());
    this.scene = new BoardScene(options.doc);
    this.images = createImageCache(options.imageUrl, () =>
      this.requestRender(),
    );
    this.presence = new PresencePublisher(options.awareness);
    this.connect();
  }

  /**
   * Starts following the document, the store and the collaborators. The
   * editor calls it on mount: React's strict mode unmounts and mounts the same
   * editor again, so `dispose()` must be undone here, not only in the
   * constructor.
   */
  connect(): void {
    if (this.connected) return;
    this.connected = true;
    const options = this.options;
    this.scene.connect();
    if (this.imagesDisposed) {
      this.imagesDisposed = false;
      this.images = createImageCache(options.imageUrl, () =>
        this.requestRender(),
      );
    }
    if (options.awareness && options.user) {
      this.presence.set({ user: options.user }, true);
    }
    this.store.setState((state) => ({
      ...pruneSelection(state, (id) => Boolean(this.get(id))),
      sceneVersion: this.scene.version,
    }));

    this.disposers.push(
      this.scene.subscribe(() => {
        this.store.setState((state) => ({
          ...pruneSelection(state, (id) => Boolean(this.get(id))),
          sceneVersion: this.scene.version,
        }));
        this.requestRender();
      }),
    );

    let lastPrefs = this.store.getState();
    let lastSelection = lastPrefs.selectedIds;
    let lastViewport = lastPrefs.viewport;
    this.disposers.push(
      this.store.subscribe((state) => {
        if (
          state.style !== lastPrefs.style ||
          state.snapToObjects !== lastPrefs.snapToObjects ||
          state.showMinimap !== lastPrefs.showMinimap ||
          state.penOnly !== lastPrefs.penOnly
        ) {
          savePrefs(state);
        }
        lastPrefs = state;
        if (state.selectedIds !== lastSelection) {
          lastSelection = state.selectedIds;
          this.presence.set({ selectedIds: [...state.selectedIds] });
          this.requestRender(false);
        }
        if (state.viewport !== lastViewport) {
          lastViewport = state.viewport;
          this.publishViewport();
          this.requestRender();
        }
        this.requestRender(false);
        this.syncCrop(state);
      }),
    );

    const awareness = options.awareness;
    if (awareness) {
      const onChange = () => this.readPresence();
      awareness.on("change", onChange);
      this.disposers.push(() => awareness.off("change", onChange));
      this.readPresence();
    }
    this.requestRender();
  }

  // ----- options --------------------------------------------------------

  setOptions(patch: Partial<ControllerOptions>): void {
    const before = this.options;
    this.options = { ...this.options, ...patch };
    if (patch.readOnly && !before.readOnly) {
      this.cancelPreview();
      this.store.setState((state) => ({
        ...state,
        editingTextId: null,
        croppingId: null,
        ...(state.tool === "select" ||
        state.tool === "hand" ||
        state.tool === "laser"
          ? {}
          : { tool: "select" as const }),
      }));
    }
    const next = patch.user;
    const prev = before.user;
    // Only a real identity change goes out; a re-created object must not
    // flood the awareness channel.
    if (
      next &&
      this.options.awareness &&
      (next.id !== prev?.id ||
        next.name !== prev?.name ||
        next.color !== prev?.color ||
        (next.image ?? null) !== (prev?.image ?? null))
    ) {
      this.presence.set({ user: next }, true);
    }
    if (patch.theme !== undefined && patch.theme !== before.theme)
      this.requestRender();
  }

  get readOnly(): boolean {
    return this.options.readOnly;
  }

  get userId(): string | null {
    return this.options.user?.id ?? null;
  }

  get state(): EditorState {
    return this.store.getState();
  }

  update(fn: (state: EditorState) => EditorState): void {
    this.store.setState(fn(this.store.getState()), true);
  }

  dispatchTool(event: ToolEvent): void {
    this.update((state) => applyToolEvent(state, event));
  }

  // ----- reading --------------------------------------------------------

  get settings(): BoardSettings {
    return this.scene.boardSettings;
  }

  /** Live elements in stacking order, with the running gesture applied. */
  elements(): readonly BoardElement[] {
    if (this.preview.size === 0) return this.scene.elements;
    const list: BoardElement[] = [];
    const seen = new Set<string>();
    for (const element of this.scene.elements) {
      const replaced = this.preview.get(element.id);
      seen.add(element.id);
      if (replaced) {
        if (!replaced.deleted) list.push(replaced);
      } else list.push(element);
    }
    const added: BoardElement[] = [];
    for (const element of this.preview.values()) {
      if (!seen.has(element.id) && !element.deleted) added.push(element);
    }
    if (added.length === 0) return list;
    return sortByOrder([...list, ...added]);
  }

  /** A live element, with the running gesture applied. */
  get(id: string): BoardElement | undefined {
    const previewed = this.preview.get(id);
    if (previewed) return previewed.deleted ? undefined : previewed;
    return this.scene.get(id);
  }

  selectedElements(): BoardElement[] {
    const result: BoardElement[] = [];
    for (const id of this.state.selectedIds) {
      const element = this.get(id);
      if (element) result.push(element);
    }
    return result;
  }

  getTaskCard(taskId: string): TaskCardData | null {
    return this.taskCards.get(taskId) ?? null;
  }

  setTaskCards(cards: ReadonlyMap<string, TaskCardData>): void {
    if (cards === this.taskCards) return;
    this.taskCards = cards;
    this.requestRender();
  }

  // ----- writing --------------------------------------------------------

  /** Refuses (and says so) when the board is read-only. */
  canWrite(silent = false): boolean {
    if (!this.options.readOnly) return true;
    if (!silent) this.callbacks.notice?.("readOnly");
    return false;
  }

  /**
   * Writes elements to the shared document and records the change for undo.
   * Each element is re-stamped above what the document holds, so a write
   * computed from an older snapshot still lands.
   */
  commit(
    next: readonly BoardElement[],
    options: {
      record?: boolean;
      before?: ReadonlyMap<string, BoardElement | undefined>;
    } = {},
  ): boolean {
    if (next.length === 0) return true;
    if (!this.canWrite()) return false;
    const before: BoardElement[] = [];
    const stamped: BoardElement[] = [];
    const now = Date.now();
    for (const element of next) {
      const stored = this.scene.getAny(element.id);
      const original = options.before ? options.before.get(element.id) : stored;
      if (original) before.push(original);
      stamped.push(
        rebaseElement(
          { ...element, updatedAt: now, updatedBy: this.userId },
          stored,
        ),
      );
    }
    writeElements(this.options.doc, stamped, LOCAL_ORIGIN);
    if (options.record !== false) this.history.record(before, stamped);
    return true;
  }

  /** Adds new elements on top of the board, optionally selecting them. */
  insert(
    elements: readonly BoardElement[],
    options: { select?: boolean } = {},
  ) {
    if (elements.length === 0) return true;
    if (!this.canWrite()) return false;
    if (this.scene.elements.length + elements.length > 20_000) {
      this.callbacks.notice?.("tooManyElements");
      return false;
    }
    // New elements all carry the default key, so equal keys keep the
    // caller's order (sortByOrder would fall back to their random ids).
    const ordered = elements
      .map((element, index) => ({ element, index }))
      .sort(
        (a, b) =>
          compareOrder(a.element.order, b.element.order) || a.index - b.index,
      )
      .map(({ element }) => element);
    const keys = ordersBetween(
      topOrder(this.scene.elements),
      null,
      ordered.length,
    );
    const placed = ordered.map((element, index) => ({
      ...element,
      order: keys[index] ?? element.order,
    }));
    const ok = this.commit(placed);
    if (ok && options.select !== false) {
      this.update((state) =>
        setSelection(
          { ...state, editingGroupId: null },
          placed.map((element) => element.id),
        ),
      );
    }
    return ok;
  }

  /** A fresh element of `type` with the user's current style. */
  newElement<T extends ElementType>(
    type: T,
    props: Record<string, unknown>,
  ): BoardElement {
    const style = this.state.style;
    const base: Record<string, unknown> = {
      strokeColor: style.strokeColor,
      fillColor: style.fillColor,
      fillStyle: style.fillStyle,
      strokeWidth: style.strokeWidth,
      strokeStyle: style.strokeStyle,
      sketch: style.sketch,
      opacity: style.opacity,
    };
    if (type === "rectangle") base.cornerRadius = style.cornerRadius;
    if (
      type === "rectangle" ||
      type === "ellipse" ||
      type === "diamond" ||
      type === "shape" ||
      type === "sticky" ||
      type === "text" ||
      type === "arrow" ||
      type === "line"
    ) {
      base.fontFamily = style.fontFamily;
      base.fontSize = style.fontSize;
      if (type === "text") base.textAlign = style.textAlign;
    }
    if (type === "arrow" || type === "line") {
      base.routing = style.routing;
      base.startHead = type === "arrow" ? style.startHead : "none";
      base.endHead = type === "arrow" ? style.endHead : "none";
      base.fillColor = "transparent";
    }
    if (type === "sticky") {
      base.fillColor = style.stickyColor;
      base.strokeColor = "#1e1e1e";
      base.fillStyle = "solid";
    }
    if (type === "frame" || type === "task" || type === "image") {
      delete base.fillColor;
      delete base.fillStyle;
      delete base.strokeColor;
      delete base.sketch;
    }
    if (type === "text") {
      base.fillColor = "transparent";
    }
    if (type === "draw") {
      base.penStyle = this.state.penStyle;
      // Highlighters remember their own colour and width.
      if (this.state.penStyle === "highlighter") {
        base.strokeColor = style.highlighterColor;
        base.strokeWidth = style.highlighterWidth;
      }
    }
    return createElement(type, { ...base, ...props } as never, {
      userId: this.userId,
    });
  }

  patch(
    elements: readonly BoardElement[],
    patch: Record<string, unknown>,
  ): boolean {
    const next = elements.map((element) =>
      updateElement(element, patch as never, { userId: this.userId }),
    );
    return this.commit(next);
  }

  /** Deletes elements, the children of deleted frames and bound text. */
  remove(ids: readonly string[]): boolean {
    if (ids.length === 0) return true;
    if (!this.canWrite()) return false;
    const all = this.scene.elements;
    const targets = new Set(ids);
    for (const id of ids) {
      const element = this.scene.get(id);
      if (element?.type === "frame") {
        for (const child of frameChildren(all, id)) targets.add(child.id);
      }
    }
    const deleted: BoardElement[] = [];
    const links: DependencyLink[] = [];
    const lookup = (id: string) => this.scene.get(id);
    for (const id of targets) {
      const element = this.scene.get(id);
      if (element && !element.locked) {
        deleted.push(deleteElement(element, { userId: this.userId }));
        // Read before the write: the cards may go in the same delete.
        const link = dependencyLinkOf(element, lookup);
        if (link) links.push(link);
      }
    }
    // Lines bound to deleted shapes keep their shape but lose the binding.
    const unbound: BoardElement[] = [];
    for (const element of all) {
      if (targets.has(element.id)) continue;
      if (element.type !== "arrow" && element.type !== "line") continue;
      const start =
        element.startBinding && targets.has(element.startBinding.elementId);
      const end =
        element.endBinding && targets.has(element.endBinding.elementId);
      if (start || end) {
        unbound.push(
          updateElement(
            element,
            {
              ...(start ? { startBinding: null } : {}),
              ...(end ? { endBinding: null } : {}),
            },
            { userId: this.userId },
          ),
        );
      }
    }
    const ok = this.commit([...deleted, ...unbound]);
    if (ok) {
      this.update((state) => ({
        ...state,
        selectedIds: state.selectedIds.filter((id) => !targets.has(id)),
      }));
      if (links.length > 0) this.callbacks.dependencyArrowsRemoved?.(links);
    }
    return ok;
  }

  duplicate(
    elements: readonly BoardElement[],
    offset: { x: number; y: number },
  ): BoardElement[] {
    return duplicateElements(elements, offset, { userId: this.userId });
  }

  writeSettings(patch: Partial<BoardSettings>): boolean {
    if (!this.canWrite()) return false;
    writeSettings(this.options.doc, patch, LOCAL_ORIGIN);
    return true;
  }

  undo(): void {
    this.applyHistory("undo");
  }

  redo(): void {
    this.applyHistory("redo");
  }

  private applyHistory(direction: "undo" | "redo"): void {
    if (!this.canWrite()) return;
    this.cancelPreview();
    // Undo inside crop mode takes back the whole session, so close it first.
    this.endCrop();
    const lookup = (id: string) => this.scene.getAny(id);
    const changes =
      direction === "undo"
        ? this.history.undo(lookup)
        : this.history.redo(lookup);
    if (changes.length === 0) return;
    const stamped = changes.map((element) =>
      rebaseElement(element, this.scene.getAny(element.id)),
    );
    writeElements(this.options.doc, stamped, HISTORY_ORIGIN);
    const live = stamped.filter((element) => !element.deleted).map((e) => e.id);
    this.update((state) =>
      setSelection({ ...state, editingTextId: null }, live),
    );
  }

  // ----- image crop -------------------------------------------------------

  /** The picture's own pixel size, once it has loaded. */
  imageSize(element: BoardElement): { width: number; height: number } | null {
    if (element.type !== "image" || !element.assetId) return null;
    const image = this.images.get(element.assetId);
    if (!image?.naturalWidth || !image.naturalHeight) return null;
    return { width: image.naturalWidth, height: image.naturalHeight };
  }

  /**
   * Enters crop mode for an image. Every crop drag until crop mode ends folds
   * into one undo step.
   */
  startCrop(id: string): boolean {
    if (!this.canWrite()) return false;
    const element = this.get(id);
    if (element?.type !== "image" || element.locked) return false;
    if (!this.imageSize(element)) {
      this.callbacks.notice?.("cropUnavailable");
      return false;
    }
    if (this.state.croppingId === id) return true;
    this.endCrop();
    this.cropSession = id;
    this.history.beginBatch();
    this.update((state) => ({
      ...setSelection(state, [id]),
      tool: state.tool === "hand" ? "hand" : "select",
      editingTextId: null,
      contextMenu: null,
      croppingId: id,
    }));
    return true;
  }

  /** Leaves crop mode, keeping the crop; false when it was not on. */
  endCrop(): boolean {
    if (!this.state.croppingId) {
      this.closeCropSession();
      return false;
    }
    this.update((state) => ({ ...state, croppingId: null }));
    return true;
  }

  private closeCropSession(): void {
    if (this.cropSession === null) return;
    this.cropSession = null;
    this.history.commitBatch();
  }

  /** Crop mode ends when its image stops being the one thing selected. */
  private syncCrop(state: EditorState): void {
    if (this.cropSession !== null && state.croppingId !== this.cropSession)
      this.closeCropSession();
    const id = state.croppingId;
    if (!id) return;
    const element = this.get(id);
    const valid =
      !this.options.readOnly &&
      element?.type === "image" &&
      !element.locked &&
      state.selectedIds.length === 1 &&
      state.selectedIds[0] === id &&
      (state.tool === "select" || state.tool === "hand") &&
      state.editingTextId === null;
    if (!valid) this.update((next) => ({ ...next, croppingId: null }));
  }

  // ----- gesture preview -------------------------------------------------

  /**
   * Shows elements as changed while a gesture runs. Collaborators see the
   * change through a throttled write; history records one step at the end.
   */
  setPreview(
    elements: readonly BoardElement[],
    options: { live?: boolean } = {},
  ) {
    for (const element of elements) {
      if (!this.previewBase.has(element.id)) {
        this.previewBase.set(element.id, this.scene.getAny(element.id));
      }
      // A fresh nonce per frame: the renderer caches drawings by version
      // and nonce, and a preview changes without a version bump. Only a
      // tie-breaker, so a cheap random number does: a crypto draw for every
      // element on every pointer move slows big selections down.
      this.preview.set(element.id, { ...element, nonce: cheapNonce() });
    }
    this.requestRender();
    if (options.live !== false && !this.options.readOnly) this.scheduleFlush();
  }

  hasPreview(): boolean {
    return this.preview.size > 0;
  }

  previewed(id: string): BoardElement | undefined {
    return this.preview.get(id);
  }

  private scheduleFlush(): void {
    if (this.previewFlushTimer) return;
    // Writing hundreds of elements is costly for everyone in the room, so
    // big previews reach collaborators a little less often.
    const delay = Math.max(
      PREVIEW_FLUSH_MS,
      Math.min(PREVIEW_FLUSH_MAX_MS, this.preview.size * 0.7),
    );
    this.previewFlushTimer = setTimeout(() => {
      this.previewFlushTimer = null;
      this.flushPreview();
    }, delay);
  }

  /** Writes the running preview without recording history. */
  private flushPreview(): void {
    if (this.preview.size === 0 || this.options.readOnly) return;
    // Only elements that already exist: new shapes appear when finished.
    const existing = [...this.preview.values()].filter((element) =>
      this.previewBase.get(element.id),
    );
    if (existing.length === 0) return;
    const stamped = existing.map((element) =>
      rebaseElement(
        { ...element, nonce: randomNonce(), updatedBy: this.userId },
        this.scene.getAny(element.id),
      ),
    );
    writeElements(this.options.doc, stamped, LOCAL_ORIGIN);
    this.previewWritten = true;
  }

  /** Ends the gesture: one write and one undo step for everything it changed. */
  commitPreview(options: { record?: boolean } = {}): boolean {
    if (this.previewFlushTimer) {
      clearTimeout(this.previewFlushTimer);
      this.previewFlushTimer = null;
    }
    const next = [...this.preview.values()];
    const before = this.previewBase;
    this.preview = new Map();
    this.previewBase = new Map();
    this.previewWritten = false;
    if (next.length === 0) return true;
    const changed = next.filter((element) => {
      const original = before.get(element.id);
      return !original || original !== element;
    });
    const ok = this.commit(changed, { before, record: options.record });
    this.requestRender();
    return ok;
  }

  /** Drops the gesture; anything already flushed is put back. */
  cancelPreview(): void {
    if (this.previewFlushTimer) {
      clearTimeout(this.previewFlushTimer);
      this.previewFlushTimer = null;
    }
    if (this.previewWritten && !this.options.readOnly) {
      const restore: BoardElement[] = [];
      for (const [id, original] of this.previewBase) {
        if (original)
          restore.push(rebaseElement({ ...original }, this.scene.getAny(id)));
      }
      writeElements(this.options.doc, restore, LOCAL_ORIGIN);
    }
    this.preview = new Map();
    this.previewBase = new Map();
    this.previewWritten = false;
    this.overlay = EMPTY_OVERLAY;
    this.requestRender();
  }

  setOverlay(patch: Partial<OverlayState>): void {
    this.overlay = { ...this.overlay, ...patch };
    this.requestRender(false);
  }

  resetOverlay(): void {
    this.overlay = EMPTY_OVERLAY;
    this.requestRender(false);
  }

  /** Lines bound to `movedIds` follow them, inside the running preview. */
  followBoundLines(movedIds: readonly string[]): void {
    if (movedIds.length === 0) return;
    const changed = updateBoundLines(
      this.elements() as BoardElement[],
      movedIds,
    );
    const lines = changed.filter((element) => !movedIds.includes(element.id));
    if (lines.length > 0) this.setPreview(lines);
  }

  // ----- selection ------------------------------------------------------

  select(ids: readonly string[]): void {
    this.update((state) => setSelection(state, ids));
  }

  /** Expands ids to their groups (respecting an entered group). */
  expandToGroups(
    ids: readonly string[],
    editingGroupId: string | null = this.state.editingGroupId,
  ): string[] {
    return expandSelectionToGroups(
      this.elements() as BoardElement[],
      ids,
      editingGroupId ?? undefined,
    );
  }

  // ----- viewport -------------------------------------------------------

  setViewport(viewport: Viewport): void {
    this.update((state) => setViewport(state, viewport));
  }

  toBoard(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.overlayCanvas?.getBoundingClientRect();
    return toBoard(
      this.state.viewport,
      clientX - (rect?.left ?? 0),
      clientY - (rect?.top ?? 0),
    );
  }

  zoomTo(zoom: number, anchor?: { x: number; y: number }): void {
    const { width, height, viewport } = this.state;
    const point = anchor ?? { x: width / 2, y: height / 2 };
    this.setViewport(zoomAround(viewport, zoom, point.x, point.y));
  }

  zoomToElements(elements: readonly BoardElement[], maxZoom = 1): void {
    const box = unionBounds(elements);
    const { width, height } = this.state;
    if (!box || width === 0 || height === 0) {
      this.setViewport(centreOn(0, 0, 1, { width, height }));
      return;
    }
    this.setViewport(fitRect(box, width, height, { maxZoom }));
  }

  zoomToFit(): void {
    this.zoomToElements(this.scene.elements, 1);
  }

  scrollToElement(id: string, select = true): void {
    const element = this.scene.get(id);
    if (!element) return;
    const box = unionBounds([element]);
    if (!box) return;
    const { width, height, viewport } = this.state;
    const visible = visibleRect(viewport, width, height);
    const fits =
      box.width <= visible.width * 0.9 && box.height <= visible.height * 0.9;
    const zoom = fits
      ? viewport.zoom
      : clampZoom(
          Math.min(width / (box.width * 1.25), height / (box.height * 1.25)),
        );
    this.setViewport(
      centreOn(box.x + box.width / 2, box.y + box.height / 2, zoom, {
        width,
        height,
      }),
    );
    if (select) this.select([id]);
  }

  // ----- presence -------------------------------------------------------

  private readPresence(): void {
    const awareness = this.options.awareness;
    if (!awareness) return;
    this.remote = readRemotePresence(
      awareness.getStates() as Map<number, Record<string, unknown>>,
      awareness.clientID,
    );
    const following = this.state.followingClientId;
    if (following !== null) {
      const leader = this.remote.find((entry) => entry.clientId === following);
      if (!leader) this.follow(null);
      else if (leader.viewport) {
        const { width, height } = this.state;
        this.setViewport(
          centreOn(
            leader.viewport.centerX,
            leader.viewport.centerY,
            leader.viewport.zoom,
            {
              width,
              height,
            },
          ),
        );
      }
    }
    this.presenceVersion++;
    for (const listener of this.presenceListeners) listener();
    this.requestRender(false);
  }

  subscribePresence(listener: () => void): () => void {
    this.presenceListeners.add(listener);
    return () => this.presenceListeners.delete(listener);
  }

  publishCursor(point: { x: number; y: number } | null): void {
    this.presence.set({ cursor: point });
  }

  publishLaser(points: [number, number][] | null): void {
    this.presence.set({ laser: points }, points === null);
  }

  private publishViewport(): void {
    const { viewport, width, height } = this.state;
    if (width === 0 || height === 0) return;
    const centre = toBoard(viewport, width / 2, height / 2);
    this.presence.set({
      viewport: { centerX: centre.x, centerY: centre.y, zoom: viewport.zoom },
    });
  }

  follow(clientId: number | null): void {
    const leader = this.remote.find((entry) => entry.clientId === clientId);
    this.update((state) => ({
      ...state,
      followingClientId: leader ? clientId : null,
    }));
    this.presence.set({ following: leader ? leader.user.id : null }, true);
    if (leader?.viewport) this.readPresence();
  }

  // ----- rendering ------------------------------------------------------

  attach(
    staticCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
  ): void {
    this.staticCanvas = staticCanvas;
    this.overlayCanvas = overlayCanvas;
    this.requestRender();
  }

  detach(): void {
    this.staticCanvas = null;
    this.overlayCanvas = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  get overlayElement(): HTMLCanvasElement | null {
    return this.overlayCanvas;
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    for (const canvas of [this.staticCanvas, this.overlayCanvas]) {
      if (!canvas) continue;
      const w = Math.max(1, Math.round(width * dpr));
      const h = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    }
    const first = this.state.width === 0;
    this.update((state) =>
      state.width === width && state.height === height
        ? state
        : { ...state, width, height },
    );
    if (first) this.publishViewport();
    this.requestRender();
  }

  /** Schedules one frame; `scene` false repaints only the interactive layer. */
  requestRender(scene = true): void {
    if (scene) this.dirtyStatic = true;
    this.dirtyOverlay = true;
    if (this.frame || typeof requestAnimationFrame === "undefined") return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** Board colour for the chrome and export. */
  background(): string {
    return this.settings.background;
  }

  private draw(): void {
    const state = this.state;
    if (this.dirtyStatic && this.staticCanvas) {
      this.dirtyStatic = false;
      const ctx = this.staticCanvas.getContext("2d");
      if (ctx) {
        renderScene(ctx, this.elements(), {
          viewport: state.viewport,
          width: state.width,
          height: state.height,
          pixelRatio: this.dpr,
          theme: this.options.theme,
          background: this.settings.background,
          // The pattern is the visible background. A plain board with
          // snap-to-grid on shows that grid, so the snapping is visible.
          gridSize: this.settings.gridSize,
          ...visiblePattern(this.settings),
          resolveImage: (assetId: string) => this.images.get(assetId),
          resolveTask: (taskId: string) => this.getTaskCard(taskId),
          measureText,
          cache: this.renderCache,
        });
      }
    }
    if (this.dirtyOverlay && this.overlayCanvas) {
      this.dirtyOverlay = false;
      const ctx = this.overlayCanvas.getContext("2d");
      if (ctx && this.overlayPainter) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(
          0,
          0,
          this.overlayCanvas.width,
          this.overlayCanvas.height,
        );
        if (this.overlayPainter(ctx)) this.requestRender(false);
      }
    }
  }

  get pixelRatio(): number {
    return this.dpr;
  }

  dispose(): void {
    this.connected = false;
    this.cancelPreview();
    this.closeCropSession();
    this.presence.dispose();
    this.detach();
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.scene.dispose();
    this.images.dispose();
    this.imagesDisposed = true;
    this.overlayPainter = null;
    this.presenceListeners.clear();
  }
}

/** Whether the board shows a background pattern. */
export function hasPattern(settings: BoardSettings): boolean {
  return Boolean(settings.pattern) && settings.pattern !== "plain";
}

/**
 * What the canvas draws behind the board: the chosen pattern, or, on a plain
 * board with snap-to-grid on, that snap grid so the snapping is visible.
 */
export function visiblePattern(settings: BoardSettings): {
  pattern: BoardSettings["pattern"];
  patternSize: number;
} {
  if (!hasPattern(settings) && settings.gridSize > 0) {
    return { pattern: "grid", patternSize: settings.gridSize };
  }
  return {
    pattern: settings.pattern ?? "plain",
    patternSize: settings.patternSize,
  };
}

/** The rotated bounds of elements, joined. */
export function unionBounds(elements: readonly BoardElement[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const element of elements) {
    const box = elementBounds(element);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
