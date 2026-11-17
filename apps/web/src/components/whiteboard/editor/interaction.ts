import {
  assignFrames,
  type Binding,
  type BoardElement,
  elementBox,
  elementsInBox,
  findBindTarget,
  focusFor,
  frameChildren,
  hitTest,
  type ImageElement,
  type LinearElement,
  type LocalPoint,
  resizeElements,
  rotateElements,
  routeElbow,
  type SnapGuide,
  snapToElements,
  snapToGrid,
  translateElements,
  updateBoundLines,
} from "@margaya/whiteboard";
import { type BoardController, unionBounds } from "./controller";
import {
  moveWindow,
  type PictureFrame,
  pictureFrame,
  resizeWindow,
  showWindow,
  toPictureFrame,
} from "./crop";
import {
  cursorForHandle,
  draggedEdges,
  frameContains,
  type HandleId,
  handleAt,
  layoutHandles,
  type ResizeHandle,
  resizeKeepsAspect,
  type SelectionFrame,
  snapAngle,
} from "./handles";
import { isPenEraser, touchPolicy } from "./pen-input";
import { defaultShapeSize, shapeChoiceOf } from "./shapes";
import { applyToolEvent, setSelection, toggleInSelection } from "./store";
import {
  type BoxTool,
  clearsSelection,
  isBoxTool,
  isLinearTool,
} from "./tools";
import { panBy, toBoard, toScreen, type Viewport } from "./viewport";

// Pointer handling for the canvas: one gesture at a time, driven by Pointer
// Events so mouse, pen and touch share the code. Every gesture previews its
// result through the controller and commits once when the pointer lifts.

type P = { x: number; y: number };

type Gesture =
  | { kind: "none" }
  | { kind: "pan"; pointerId: number; lastX: number; lastY: number }
  | {
      kind: "pinch";
      startViewport: Viewport;
      startCentre: P;
      startDistance: number;
    }
  | {
      kind: "press";
      pointerId: number;
      origin: P;
      screen: P;
      /** The element pressed, already selected. */
      hitId: string | null;
      shift: boolean;
      alt: boolean;
    }
  | {
      kind: "move";
      pointerId: number;
      origin: P;
      originals: BoardElement[];
      ids: string[];
    }
  | {
      kind: "box";
      pointerId: number;
      origin: P;
      additive: boolean;
      initial: string[];
    }
  | {
      kind: "resize";
      pointerId: number;
      handle: ResizeHandle;
      origin: P;
      originals: BoardElement[];
      /** The selection frame when the drag began. */
      frame: SelectionFrame;
    }
  | {
      kind: "rotate";
      pointerId: number;
      centre: P;
      startAngle: number;
      baseAngle: number;
      originals: BoardElement[];
    }
  | {
      kind: "create";
      pointerId: number;
      tool: BoxTool;
      origin: P;
      base: BoardElement;
      dragged: boolean;
    }
  | {
      kind: "linear";
      pointerId: number | null;
      base: LinearElement;
      /** Fixed points, relative to base.x/y. */
      points: LocalPoint[];
      /** Pointer still down from the first press (drag-to-draw). */
      dragging: boolean;
      startTarget: string | null;
    }
  | {
      kind: "point";
      pointerId: number;
      original: LinearElement;
      index: number;
      /** Dragging a midpoint inserts a new point at index. */
      inserted: boolean;
    }
  | {
      kind: "draw";
      pointerId: number;
      base: BoardElement;
      points: [number, number][];
      pressures: number[];
      pen: boolean;
    }
  | { kind: "erase"; pointerId: number; hits: Set<string> }
  | { kind: "laser"; pointerId: number }
  | {
      kind: "crop";
      pointerId: number;
      /** The crop handle dragged, or null to slide the window. */
      handle: ResizeHandle | null;
      origin: P;
      original: ImageElement;
      frame: PictureFrame;
    };

/** Screen pixels a press may move before it counts as a drag. */
const DRAG_THRESHOLD = 4;
const DOUBLE_CLICK_MS = 400;
const LONG_PRESS_MS = 550;
/** Screen pixels within which a line end binds to a shape. */
const BIND_DISTANCE = 14;
const BINDING_GAP = 6;

const TEXT_CAPABLE = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "shape",
  "sticky",
  "text",
  "arrow",
  "line",
]);

/** Outlined shapes whose label a double click inside them edits. */
const LABELLED_SHAPES = new Set(["rectangle", "ellipse", "diamond", "shape"]);

const DEFAULT_SIZES: Record<
  "sticky" | "frame",
  { width: number; height: number }
> = {
  sticky: { width: 200, height: 200 },
  frame: { width: 480, height: 320 },
};

export type InteractionHooks = {
  /** Opens the text overlay for an element (new elements are previewed). */
  editText: (elementId: string, options?: { isNew?: boolean }) => void;
  openTask: (taskId: string) => void;
  openLink: (url: string) => void;
};

export class Interaction {
  private gesture: Gesture = { kind: "none" };
  private touches = new Map<number, P>();
  /** Touches taken for a palm: every later event of theirs is dropped. */
  private ignoredTouches = new Set<number>();
  /** The pen pointer that is down, if any. */
  private penPointerId: number | null = null;
  /** `performance.now()` when the pen was last down, moving or hovering. */
  private lastPenAt = Number.NEGATIVE_INFINITY;
  private lastDown: { time: number; x: number; y: number } | null = null;
  private longPress: ReturnType<typeof setTimeout> | null = null;
  private modifiers = { shift: false, alt: false, mod: false };
  /** Board point of the pointer, for paste and the polyline preview. */
  pointer: P | null = null;

  constructor(
    private readonly c: BoardController,
    private readonly hooks: InteractionHooks,
  ) {}

  get busy(): boolean {
    return this.gesture.kind !== "none";
  }

  get isDrawingLine(): boolean {
    return this.gesture.kind === "linear";
  }

  private get zoom(): number {
    return this.c.state.viewport.zoom;
  }

  private tolerance(screenPx = 6): number {
    return screenPx / this.zoom;
  }

  private coarse(event: PointerEvent): boolean {
    return event.pointerType === "touch";
  }

  // ----- selection geometry ----------------------------------------------

  /** The frame drawn around the selection, or null when there are no handles. */
  selectionFrame(): SelectionFrame | null {
    const selected = this.c.selectedElements();
    if (selected.length === 0) return null;
    if (selected.length === 1) {
      const only = selected[0] as BoardElement;
      const box = elementBox(only);
      return { ...box, angle: only.angle };
    }
    const box = unionBounds(selected);
    return box ? { ...box, angle: 0 } : null;
  }

  /** Whether the selection shows resize and rotate handles. */
  handlesVisible(): boolean {
    if (this.c.readOnly) return false;
    const selected = this.c.selectedElements();
    if (selected.length === 0) return false;
    if (selected.some((element) => element.locked)) return false;
    if (selected.length === 1 && isLinear(selected[0])) return false;
    return true;
  }

  handleLayout(coarse = false) {
    const frame = this.selectionFrame();
    if (!frame || !this.handlesVisible()) return [];
    const selected = this.c.selectedElements();
    // Crop mode shows only the eight crop handles.
    const rotatable =
      !this.c.state.croppingId &&
      !selected.every((element) => element.type === "frame");
    return layoutHandles(frame, this.zoom, { coarse, rotatable });
  }

  /** The selected line, when exactly one line or arrow is selected. */
  editableLine(): LinearElement | null {
    if (this.c.readOnly) return null;
    const selected = this.c.selectedElements();
    if (selected.length !== 1) return null;
    const only = selected[0];
    return only && isLinear(only) && !only.locked ? only : null;
  }

  // ----- pointer events --------------------------------------------------

  pointerDown(event: PointerEvent): void {
    const c = this.c;
    // The event's own target: React hands over the native event, whose
    // currentTarget is the root its listeners are delegated to, and capturing
    // the pointer there would send every later move past the canvas.
    const target = event.target as Element | null;
    this.modifiers = {
      shift: event.shiftKey,
      alt: event.altKey,
      mod: event.ctrlKey || event.metaKey,
    };
    const screen = this.screenPoint(event);
    const point = toBoard(c.state.viewport, screen.x, screen.y);

    // Palm rejection: a touch while the pen is near is the hand holding it,
    // and with "Draw with pen only" a touch only moves the view.
    let touchPans = false;
    if (event.pointerType === "pen") {
      this.penPointerId = event.pointerId;
      this.lastPenAt = performance.now();
      this.dropTouches();
    } else if (event.pointerType === "touch") {
      const policy = touchPolicy({
        penDown: this.penPointerId !== null,
        lastPenAt: this.lastPenAt,
        now: performance.now(),
        penOnly: c.state.penOnly,
      });
      if (policy === "ignore") {
        this.ignoredTouches.add(event.pointerId);
        return;
      }
      touchPans = policy === "pan";
    }
    this.pointer = point;

    if (event.pointerType === "touch") {
      this.touches.set(event.pointerId, screen);
      if (this.touches.size === 2) {
        this.startPinch();
        return;
      }
      if (this.touches.size > 2) return;
    }

    if (event.button === 2) return;
    target?.setPointerCapture?.(event.pointerId);

    // The pen's eraser end (or eraser button) erases while held, whatever the tool.
    if (isPenEraser(event)) {
      if (!c.canWrite()) return;
      this.gesture = {
        kind: "erase",
        pointerId: event.pointerId,
        hits: new Set(),
      };
      this.eraseAt(point);
      return;
    }

    // Middle button or Space: pan, whatever the tool.
    if (event.button === 1 || c.state.tool === "hand" || touchPans) {
      event.preventDefault();
      this.gesture = {
        kind: "pan",
        pointerId: event.pointerId,
        lastX: screen.x,
        lastY: screen.y,
      };
      this.setCursor("grabbing");
      return;
    }

    const now = performance.now();
    const isDouble =
      this.lastDown &&
      now - this.lastDown.time < DOUBLE_CLICK_MS &&
      Math.hypot(screen.x - this.lastDown.x, screen.y - this.lastDown.y) < 10;
    this.lastDown = isDouble ? null : { time: now, x: screen.x, y: screen.y };

    if (this.gesture.kind === "linear" && !this.gesture.dragging) {
      if (isDouble) {
        this.finishLine();
        return;
      }
      this.addLinePoint(point, event.pointerId);
      return;
    }

    if (isDouble) {
      this.doubleClick(point);
      return;
    }

    if (event.pointerType === "touch" && !c.readOnly) {
      this.armLongPress(event.clientX, event.clientY, point);
    }

    const tool = c.state.tool;
    if (tool === "select") {
      if (c.state.croppingId && this.cropDown(event, point)) return;
      this.selectDown(event, point, screen);
      return;
    }
    if (tool === "laser") {
      this.gesture = { kind: "laser", pointerId: event.pointerId };
      this.addLaserPoint(point);
      return;
    }
    if (!c.canWrite()) return;
    if (clearsSelection(tool)) c.select([]);
    if (isBoxTool(tool)) {
      this.createDown(event, tool, point);
      return;
    }
    if (isLinearTool(tool)) {
      this.lineDown(event, tool, point);
      return;
    }
    if (tool === "draw") {
      this.drawDown(event, point);
      return;
    }
    if (tool === "text") {
      // A click on a text, a note or a labelled shape edits its words
      // instead of stacking a new text on top of them.
      const target = this.textTargetAt(point);
      if (target) {
        c.select([target.id]);
        c.dispatchTool({ type: "created" });
        this.hooks.editText(target.id);
        return;
      }
      this.createText(point);
      return;
    }
    if (tool === "eraser") {
      this.gesture = {
        kind: "erase",
        pointerId: event.pointerId,
        hits: new Set(),
      };
      this.eraseAt(point);
    }
  }

  pointerMove(event: PointerEvent): void {
    const c = this.c;
    if (event.pointerType === "pen") this.lastPenAt = performance.now();
    else if (
      event.pointerType === "touch" &&
      this.ignoredTouches.has(event.pointerId)
    )
      return;
    const screen = this.screenPoint(event);
    const point = toBoard(c.state.viewport, screen.x, screen.y);
    this.pointer = point;
    this.modifiers = {
      shift: event.shiftKey,
      alt: event.altKey,
      mod: event.ctrlKey || event.metaKey,
    };

    if (event.pointerType === "touch" && this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, screen);
      if (this.gesture.kind === "pinch") {
        this.movePinch();
        return;
      }
    }
    if (event.pointerType !== "touch") c.publishCursor(point);

    const gesture = this.gesture;
    if (gesture.kind === "none") {
      this.hover(point, event);
      return;
    }
    if (
      "pointerId" in gesture &&
      gesture.pointerId !== null &&
      gesture.pointerId !== event.pointerId
    )
      return;

    switch (gesture.kind) {
      case "pan": {
        const dx = screen.x - gesture.lastX;
        const dy = screen.y - gesture.lastY;
        gesture.lastX = screen.x;
        gesture.lastY = screen.y;
        c.setViewport(panBy(c.state.viewport, dx, dy));
        return;
      }
      case "press": {
        const moved = Math.hypot(
          screen.x - gesture.screen.x,
          screen.y - gesture.screen.y,
        );
        if (moved < DRAG_THRESHOLD) return;
        this.cancelLongPress();
        this.startDrag(gesture, point);
        return;
      }
      case "move":
        this.moveSelection(gesture, point);
        return;
      case "box":
        this.updateBox(gesture, point);
        return;
      case "resize":
        this.resize(gesture, point);
        return;
      case "rotate":
        this.rotate(gesture, point);
        return;
      case "create":
        this.cancelLongPress();
        this.updateCreate(gesture, point);
        return;
      case "linear":
        this.cancelLongPress();
        this.updateLinePreview(gesture, point);
        return;
      case "point":
        this.movePoint(gesture, point);
        return;
      case "draw": {
        this.cancelLongPress();
        const samples =
          typeof event.getCoalescedEvents === "function"
            ? event.getCoalescedEvents()
            : [];
        const list = samples.length > 0 ? samples : [event];
        for (const sample of list) {
          const s = this.screenPoint(sample);
          const p = toBoard(c.state.viewport, s.x, s.y);
          gesture.points.push([p.x - gesture.base.x, p.y - gesture.base.y]);
          if (gesture.pen) gesture.pressures.push(sample.pressure || 0.5);
        }
        this.previewDraw(gesture);
        return;
      }
      case "erase":
        this.cancelLongPress();
        this.eraseAt(point);
        return;
      case "laser":
        this.addLaserPoint(point);
        return;
      case "crop":
        this.moveCrop(gesture, point);
        return;
      case "pinch":
        return;
    }
  }

  pointerUp(event: PointerEvent): void {
    const c = this.c;
    if (event.pointerType === "touch" && this.forgetIgnored(event.pointerId))
      return;
    if (event.pointerType === "pen") this.penLifted(event.pointerId);
    this.cancelLongPress();
    if (event.pointerType === "touch") {
      this.touches.delete(event.pointerId);
      if (this.gesture.kind === "pinch") {
        if (this.touches.size < 2) this.gesture = { kind: "none" };
        return;
      }
    }
    const gesture = this.gesture;
    if (
      "pointerId" in gesture &&
      gesture.pointerId !== null &&
      gesture.pointerId !== event.pointerId
    )
      return;
    const target = event.target as Element | null;
    if (target?.hasPointerCapture?.(event.pointerId))
      target.releasePointerCapture(event.pointerId);

    switch (gesture.kind) {
      case "none":
        return;
      case "pan":
        this.gesture = { kind: "none" };
        this.setCursor(c.state.tool === "hand" ? "grab" : "default");
        return;
      case "press": {
        this.gesture = { kind: "none" };
        // A plain click on an element of a multi-selection selects just it.
        if (gesture.hitId && !gesture.shift) {
          const ids = c.expandToGroups([gesture.hitId]);
          if (c.state.selectedIds.length > ids.length) c.select(ids);
        }
        if (gesture.hitId && this.modifiers.mod) {
          const link = c.get(gesture.hitId)?.link;
          if (link) this.hooks.openLink(link);
        }
        return;
      }
      case "move":
      case "resize":
      case "rotate": {
        this.gesture = { kind: "none" };
        const ids =
          gesture.kind === "move"
            ? gesture.ids
            : gesture.originals.map((e) => e.id);
        const framed = assignFrames(c.elements() as BoardElement[], ids);
        if (framed.length > 0) c.setPreview(framed, { live: false });
        c.commitPreview();
        c.resetOverlay();
        return;
      }
      case "box":
        this.gesture = { kind: "none" };
        c.resetOverlay();
        return;
      case "create":
        this.finishCreate(gesture);
        return;
      case "linear": {
        if (!gesture.dragging) return;
        const end = this.linePointer(gesture);
        const dragged =
          Math.hypot(end[0], end[1]) * this.zoom > DRAG_THRESHOLD * 2;
        if (dragged) {
          gesture.points = [[0, 0], end];
          this.finishLine();
        } else {
          // A click without a drag starts a polyline: each click adds a point.
          gesture.dragging = false;
          gesture.pointerId = null;
        }
        return;
      }
      case "point":
      case "crop":
        this.gesture = { kind: "none" };
        c.commitPreview();
        c.resetOverlay();
        return;
      case "draw":
        this.finishDraw(gesture);
        return;
      case "erase": {
        this.gesture = { kind: "none" };
        const ids = [...gesture.hits];
        c.cancelPreview();
        c.remove(ids);
        c.resetOverlay();
        return;
      }
      case "laser":
        this.gesture = { kind: "none" };
        return;
      case "pinch":
        return;
    }
  }

  pointerCancel(event: PointerEvent): void {
    if (event.pointerType === "touch" && this.forgetIgnored(event.pointerId))
      return;
    if (event.pointerType === "pen") this.penLifted(event.pointerId);
    this.touches.delete(event.pointerId);
    this.cancel();
  }

  // ----- palm rejection ----------------------------------------------------

  /** A pen came down: whatever resting fingers or a palm started is dropped. */
  private dropTouches(): void {
    if (this.touches.size === 0) return;
    const gesture = this.gesture;
    const fromTouch =
      gesture.kind === "pinch" ||
      ("pointerId" in gesture &&
        gesture.pointerId !== null &&
        this.touches.has(gesture.pointerId));
    for (const id of this.touches.keys()) this.ignoredTouches.add(id);
    this.touches.clear();
    if (fromTouch) this.cancel();
  }

  private forgetIgnored(pointerId: number): boolean {
    return this.ignoredTouches.delete(pointerId);
  }

  private penLifted(pointerId: number): void {
    if (this.penPointerId === pointerId) this.penPointerId = null;
    this.lastPenAt = performance.now();
  }

  pointerLeave(): void {
    if (this.gesture.kind === "none") this.c.publishCursor(null);
    if (this.c.overlay.hoverId) this.c.setOverlay({ hoverId: null });
  }

  /** Escape or a lost pointer: drop whatever was in progress. */
  cancel(): boolean {
    this.cancelLongPress();
    const gesture = this.gesture;
    if (gesture.kind === "none") return false;
    if (
      gesture.kind === "linear" &&
      !gesture.dragging &&
      gesture.points.length >= 2
    ) {
      this.finishLine();
      return true;
    }
    this.gesture = { kind: "none" };
    this.c.cancelPreview();
    this.c.resetOverlay();
    return true;
  }

  /** Enter while drawing a polyline finishes it; in crop mode it ends cropping. */
  finishPending(): boolean {
    if (this.gesture.kind === "linear" && !this.gesture.dragging) {
      this.finishLine();
      return true;
    }
    if (this.gesture.kind === "none" && this.c.state.croppingId)
      return this.c.endCrop();
    return false;
  }

  updateModifiers(event: KeyboardEvent): void {
    this.modifiers = {
      shift: event.shiftKey,
      alt: event.altKey,
      mod: event.ctrlKey || event.metaKey,
    };
  }

  // ----- context menu and long press -------------------------------------

  contextMenu(clientX: number, clientY: number): void {
    const c = this.c;
    this.cancel();
    const point = c.toBoard(clientX, clientY);
    const hit = this.hitAt(point, true);
    if (hit) {
      if (!c.state.selectedIds.includes(hit.id))
        c.select(c.expandToGroups([hit.id]));
    } else {
      c.select([]);
    }
    c.update((state) => ({
      ...state,
      contextMenu: { clientX, clientY, targetId: hit?.id ?? null },
    }));
  }

  private armLongPress(clientX: number, clientY: number, _point: P): void {
    this.cancelLongPress();
    this.longPress = setTimeout(() => {
      this.longPress = null;
      this.contextMenu(clientX, clientY);
    }, LONG_PRESS_MS);
  }

  private cancelLongPress(): void {
    if (this.longPress) clearTimeout(this.longPress);
    this.longPress = null;
  }

  // ----- hit testing -----------------------------------------------------

  /** The top element at a point; locked ones only when asked for. */
  hitAt(point: P, includeLocked = false): BoardElement | null {
    // The list is already in stacking order, so walk it from the top rather
    // than sorting a copy on every pointer move.
    const elements = this.c.elements();
    const tolerance = this.tolerance();
    for (let index = elements.length - 1; index >= 0; index--) {
      const element = elements[index];
      if (!element || (!includeLocked && element.locked)) continue;
      if (hitTest(element, point, tolerance)) return element;
    }
    return null;
  }

  private hover(point: P, event: PointerEvent): void {
    const c = this.c;
    const tool = c.state.tool;
    if (tool !== "select") {
      this.setCursor(cursorForTool(tool));
      if (c.overlay.hoverId) c.setOverlay({ hoverId: null });
      if (this.gesture.kind === "none" && isLinearTool(tool)) {
        const target = this.bindTargetAt(point, null);
        if ((target?.id ?? null) !== c.overlay.bindTargetId)
          c.setOverlay({ bindTargetId: target?.id ?? null });
      }
      return;
    }
    const handles = this.handleLayout(this.coarse(event));
    const handle = handleAt(handles, point.x, point.y);
    if (handle) {
      this.setCursor(
        cursorForHandle(handle, this.selectionFrame()?.angle ?? 0),
      );
      return;
    }
    const line = this.editableLine();
    if (line && this.linePointAt(line, point) !== null) {
      this.setCursor("pointer");
      return;
    }
    const hit = this.hitAt(point);
    const hoverId = hit?.id ?? null;
    if (hoverId !== c.overlay.hoverId) c.setOverlay({ hoverId });
    this.setCursor(
      hit ? (hit.link && this.modifiers.mod ? "pointer" : "move") : "default",
    );
  }

  private setCursor(cursor: string): void {
    const canvas = this.c.overlayElement;
    if (canvas && canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
  }

  private screenPoint(event: { clientX: number; clientY: number }): P {
    const rect = this.c.overlayElement?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  }

  // ----- select tool -----------------------------------------------------

  private selectDown(event: PointerEvent, point: P, screen: P): void {
    const c = this.c;
    const coarse = this.coarse(event);
    const handle = handleAt(
      this.handleLayout(coarse),
      point.x,
      point.y,
      coarse ? 1.8 : 1.4,
    );
    if (handle) {
      this.startTransform(handle, point, event.pointerId);
      return;
    }
    const line = this.editableLine();
    if (line) {
      const index = this.linePointAt(line, point);
      if (index !== null) {
        this.startPointDrag(line, index, event.pointerId);
        return;
      }
      const mid = this.lineMidpointAt(line, point);
      if (mid !== null) {
        this.startPointDrag(line, mid, event.pointerId, true);
        return;
      }
    }

    const hit = this.hitAt(point, true);
    // Inside the selection's box counts as pressing the selection, so an
    // unfilled shape can be dragged by its middle once selected.
    const frame = this.selectionFrame();
    const insideSelection =
      !hit &&
      frame &&
      c.state.selectedIds.length > 0 &&
      frameContains(frame, point.x, point.y);

    if (hit) {
      const ids = c.expandToGroups([hit.id]);
      if (event.shiftKey) {
        c.update((state) => toggleInSelection(state, ids));
      } else if (!c.state.selectedIds.includes(hit.id)) {
        c.update((state) => {
          // Clicking outside the entered group leaves it.
          const inGroup =
            state.editingGroupId && hit.groupIds.includes(state.editingGroupId);
          return setSelection(
            { ...state, editingGroupId: inGroup ? state.editingGroupId : null },
            inGroup ? ids : c.expandToGroups([hit.id], null),
          );
        });
      }
    } else if (!insideSelection && !event.shiftKey) {
      c.update((state) => setSelection({ ...state, editingGroupId: null }, []));
    }

    if (hit || insideSelection) {
      this.gesture = {
        kind: "press",
        pointerId: event.pointerId,
        origin: point,
        screen,
        hitId: hit?.id ?? null,
        shift: event.shiftKey,
        alt: event.altKey,
      };
      return;
    }
    this.gesture = {
      kind: "box",
      pointerId: event.pointerId,
      origin: point,
      additive: event.shiftKey,
      initial: [...c.state.selectedIds],
    };
  }

  private startDrag(
    press: Extract<Gesture, { kind: "press" }>,
    point: P,
  ): void {
    const c = this.c;
    if (c.readOnly) {
      // Read-only: dragging an element pans instead, keeping the selection.
      const screen = toScreen(c.state.viewport, point.x, point.y);
      this.gesture = {
        kind: "pan",
        pointerId: press.pointerId,
        lastX: screen.x,
        lastY: screen.y,
      };
      return;
    }
    let selected = c.selectedElements().filter((element) => !element.locked);
    if (selected.length === 0) {
      this.gesture = { kind: "none" };
      return;
    }
    // Frames carry their children along.
    const all = c.elements() as BoardElement[];
    const ids = new Set(selected.map((element) => element.id));
    for (const element of [...selected]) {
      if (element.type !== "frame") continue;
      for (const child of frameChildren(all, element.id)) {
        if (!ids.has(child.id) && !child.locked) {
          ids.add(child.id);
          selected.push(child);
        }
      }
    }
    if (press.alt) {
      // Alt-drag leaves the originals and drags copies.
      const copies = c.duplicate(selected, { x: 0, y: 0 });
      c.setPreview(copies, { live: false });
      const topLevel = new Set(c.state.selectedIds);
      const copyIds = copies
        .filter((_, index) => topLevel.has(selected[index]?.id ?? ""))
        .map((element) => element.id);
      c.select(
        copyIds.length > 0 ? copyIds : copies.map((element) => element.id),
      );
      selected = copies;
    }
    this.gesture = {
      kind: "move",
      pointerId: press.pointerId,
      origin: press.origin,
      originals: selected,
      ids: selected.map((element) => element.id),
    };
    this.moveSelection(this.gesture, point);
  }

  private moveSelection(
    gesture: Extract<Gesture, { kind: "move" }>,
    point: P,
  ): void {
    const c = this.c;
    let dx = point.x - gesture.origin.x;
    let dy = point.y - gesture.origin.y;
    const guides: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const snapping = !this.modifiers.mod;
    const box = unionBounds(gesture.originals);
    if (box && snapping) {
      const moved = { ...box, x: box.x + dx, y: box.y + dy };
      const grid = c.settings.gridSize;
      if (grid > 0) {
        const snapped = snapToGrid({ x: moved.x, y: moved.y }, grid);
        dx += snapped.x - moved.x;
        dy += snapped.y - moved.y;
      } else if (c.state.snapToObjects) {
        const moving = new Set(gesture.ids);
        const others = this.visibleBoxes(moving);
        const snap = snapToElements(moved, others, this.tolerance(8));
        dx += snap.dx;
        dy += snap.dy;
        for (const guide of snap.guides) guides.push(normaliseGuide(guide));
      }
    }
    const translated = translateElements(gesture.originals, dx, dy);
    const next = translated.length > 0 ? translated : gesture.originals;
    // A moved line lets go of shapes that stay behind.
    const moving = new Set(gesture.ids);
    const released = next.map((element) =>
      releaseStaleBindings(element, moving),
    );
    c.setPreview(released, { live: !this.isAltCopy(gesture) });
    c.followBoundLines(gesture.ids);
    c.setOverlay({ guides });
  }

  private isAltCopy(gesture: Extract<Gesture, { kind: "move" }>): boolean {
    return gesture.originals.every(
      (element) => !this.c.scene.getAny(element.id),
    );
  }

  /** Boxes of on-screen elements other than `exclude`, for snapping. */
  private visibleBoxes(exclude: ReadonlySet<string>) {
    const { viewport, width, height } = this.c.state;
    const left = -viewport.scrollX;
    const top = -viewport.scrollY;
    const right = left + width / viewport.zoom;
    const bottom = top + height / viewport.zoom;
    const boxes = [];
    for (const element of this.c.elements()) {
      if (
        exclude.has(element.id) ||
        isLinear(element) ||
        element.type === "draw"
      )
        continue;
      const box = unionBounds([element]);
      if (!box) continue;
      if (
        box.x > right ||
        box.y > bottom ||
        box.x + box.width < left ||
        box.y + box.height < top
      )
        continue;
      boxes.push(box);
      if (boxes.length > 400) break;
    }
    return boxes;
  }

  private updateBox(
    gesture: Extract<Gesture, { kind: "box" }>,
    point: P,
  ): void {
    const c = this.c;
    const box = normaliseRect(gesture.origin, point);
    c.setOverlay({ box });
    const inside = elementsInBox(c.elements() as BoardElement[], box, {
      fullyInside: true,
    })
      .filter((element) => !element.locked || c.readOnly)
      .map((element) => element.id);
    const expanded = inside.length > 0 ? c.expandToGroups(inside) : [];
    const ids = gesture.additive ? [...gesture.initial, ...expanded] : expanded;
    c.update((state) => setSelection({ ...state, editingGroupId: null }, ids));
  }

  // ----- resize and rotate -----------------------------------------------

  private startTransform(handle: HandleId, point: P, pointerId: number): void {
    const c = this.c;
    const originals = c.selectedElements().filter((element) => !element.locked);
    if (originals.length === 0) return;
    if (handle === "rotate") {
      const frame = this.selectionFrame();
      if (!frame) return;
      const centre = {
        x: frame.x + frame.width / 2,
        y: frame.y + frame.height / 2,
      };
      this.gesture = {
        kind: "rotate",
        pointerId,
        centre,
        startAngle: Math.atan2(point.y - centre.y, point.x - centre.x),
        baseAngle: frame.angle,
        originals,
      };
      this.setCursor("grabbing");
      return;
    }
    const frame = this.selectionFrame();
    if (!frame) return;
    this.gesture = {
      kind: "resize",
      pointerId,
      handle,
      origin: point,
      originals,
      frame,
    };
  }

  private resize(
    gesture: Extract<Gesture, { kind: "resize" }>,
    point: P,
  ): void {
    const c = this.c;
    const { to, guides } = this.snapResize(gesture, point);
    const next = resizeElements(
      gesture.originals,
      gesture.handle,
      gesture.origin,
      to,
      {
        keepAspect: resizeKeepsAspect(
          gesture.originals,
          gesture.handle,
          this.modifiers.shift,
        ),
        fromCenter: this.modifiers.alt,
      },
    );
    c.setPreview(next);
    this.keepOutsideBindings(next);
    c.followBoundLines(next.map((element) => element.id));
    c.setOverlay({ guides });
  }

  /**
   * Lines inside a resized or turned selection stay attached to the shapes
   * outside it that they are bound to, instead of drifting off with a
   * binding that no longer matches.
   */
  private keepOutsideBindings(next: readonly BoardElement[]): void {
    const ids = new Set(next.map((element) => element.id));
    const outside = new Set<string>();
    for (const element of next) {
      if (!isLinear(element)) continue;
      for (const binding of [element.startBinding, element.endBinding]) {
        if (binding && !ids.has(binding.elementId))
          outside.add(binding.elementId);
      }
    }
    if (outside.size === 0) return;
    const lines = updateBoundLines(
      this.c.elements() as BoardElement[],
      outside,
    ).filter((line) => ids.has(line.id));
    if (lines.length > 0) this.c.setPreview(lines);
  }

  /**
   * The pointer position that puts the dragged edges on the grid or on
   * another element's edge or centre. The edges snap, not the pointer: the
   * handle sits a few pixels outside the box. A turned single element and
   * Ctrl/Cmd skip snapping.
   */
  private snapResize(
    gesture: Extract<Gesture, { kind: "resize" }>,
    point: P,
  ): { to: P; guides: { x1: number; y1: number; x2: number; y2: number }[] } {
    const c = this.c;
    const frame = gesture.frame;
    if (this.modifiers.mod || frame.angle !== 0)
      return { to: point, guides: [] };
    const edges = draggedEdges(frame, gesture.handle);
    const moved = {
      x: (edges.x ?? 0) + point.x - gesture.origin.x,
      y: (edges.y ?? 0) + point.y - gesture.origin.y,
    };
    let dx = 0;
    let dy = 0;
    const guides: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const grid = c.settings.gridSize;
    if (grid > 0) {
      const snapped = snapToGrid(moved, grid);
      dx = snapped.x - moved.x;
      dy = snapped.y - moved.y;
    } else if (c.state.snapToObjects) {
      const exclude = new Set(gesture.originals.map((element) => element.id));
      const snap = snapToElements(
        { ...moved, width: 0, height: 0 },
        this.visibleBoxes(exclude),
        this.tolerance(8),
      );
      dx = snap.dx;
      dy = snap.dy;
      for (const guide of snap.guides) {
        if ((guide.axis === "x" ? edges.x : edges.y) === null) continue;
        guides.push(normaliseGuide(guide));
      }
    }
    return {
      to: {
        x: point.x + (edges.x === null ? 0 : dx),
        y: point.y + (edges.y === null ? 0 : dy),
      },
      guides,
    };
  }

  private rotate(
    gesture: Extract<Gesture, { kind: "rotate" }>,
    point: P,
  ): void {
    const c = this.c;
    const angle = Math.atan2(
      point.y - gesture.centre.y,
      point.x - gesture.centre.x,
    );
    let delta = angle - gesture.startAngle;
    if (this.modifiers.shift) {
      delta = snapAngle(gesture.baseAngle + delta) - gesture.baseAngle;
    }
    const next = rotateElements(gesture.originals, gesture.centre, delta);
    c.setPreview(next);
    this.keepOutsideBindings(next);
    c.followBoundLines(next.map((element) => element.id));
  }

  // ----- crop mode ---------------------------------------------------------

  /**
   * A press in crop mode: a handle crops, the kept area slides the window
   * over the picture, anywhere else ends crop mode (false: the press then
   * acts as a normal click).
   */
  private cropDown(event: PointerEvent, point: P): boolean {
    const c = this.c;
    const id = c.state.croppingId;
    const element = id ? c.get(id) : undefined;
    const size = element ? c.imageSize(element) : null;
    const frame =
      element?.type === "image" && size ? pictureFrame(element, size) : null;
    if (element?.type !== "image" || !frame || !c.canWrite(true)) {
      c.endCrop();
      return false;
    }
    const coarse = this.coarse(event);
    const handle = handleAt(
      this.handleLayout(coarse),
      point.x,
      point.y,
      coarse ? 1.8 : 1.4,
    );
    const box = elementBox(element);
    const inside = frameContains(
      { ...box, angle: element.angle },
      point.x,
      point.y,
    );
    if (handle === "rotate" || (!handle && !inside)) {
      c.endCrop();
      return false;
    }
    this.gesture = {
      kind: "crop",
      pointerId: event.pointerId,
      handle: handle ?? null,
      origin: point,
      original: element,
      frame,
    };
    if (!handle) this.setCursor("grabbing");
    return true;
  }

  private moveCrop(gesture: Extract<Gesture, { kind: "crop" }>, point: P) {
    const c = this.c;
    // Crop mode can end under a running drag (a collaborator locked or
    // deleted the image): drop the drag.
    if (c.state.croppingId !== gesture.original.id) {
      this.cancel();
      return;
    }
    const from = toPictureFrame(gesture.frame, gesture.origin);
    const to = toPictureFrame(gesture.frame, point);
    const delta = { x: to.x - from.x, y: to.y - from.y };
    const window = gesture.handle
      ? resizeWindow(
          gesture.frame,
          gesture.frame.window,
          gesture.handle,
          delta,
          {
            keepAspect: this.modifiers.shift,
            fromCenter: this.modifiers.alt,
            minSize: this.tolerance(12),
          },
        )
      : moveWindow(gesture.frame, gesture.frame.window, delta);
    c.setPreview([
      showWindow(gesture.original, gesture.frame, window, {
        userId: c.userId,
      }),
    ]);
    c.followBoundLines([gesture.original.id]);
  }

  // ----- creating shapes -------------------------------------------------

  private createDown(event: PointerEvent, tool: BoxTool, point: P): void {
    const c = this.c;
    const grid = c.settings.gridSize;
    const origin = grid > 0 ? snapToGrid(point, grid) : point;
    const box = { x: origin.x, y: origin.y, width: 0, height: 0 };
    let base: BoardElement;
    if (tool === "shape") {
      // The shape tool draws the library's last pick; a classic pick keeps
      // its own element type.
      const kind = c.state.shapeKind;
      base =
        kind === "rectangle" || kind === "ellipse" || kind === "diamond"
          ? c.newElement(kind, box)
          : c.newElement("shape", { ...box, shape: kind });
    } else {
      base = c.newElement(tool, box);
    }
    this.gesture = {
      kind: "create",
      pointerId: event.pointerId,
      tool,
      origin,
      base,
      dragged: false,
    };
  }

  private updateCreate(
    gesture: Extract<Gesture, { kind: "create" }>,
    point: P,
  ): void {
    const c = this.c;
    const grid = c.settings.gridSize;
    const to =
      grid > 0 && !this.modifiers.mod ? snapToGrid(point, grid) : point;
    let w = to.x - gesture.origin.x;
    let h = to.y - gesture.origin.y;
    if (this.modifiers.shift || gesture.tool === "sticky") {
      const side = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * side;
      h = Math.sign(h || 1) * side;
    }
    let x = gesture.origin.x;
    let y = gesture.origin.y;
    if (this.modifiers.alt) {
      x -= w;
      y -= h;
      w *= 2;
      h *= 2;
    }
    const rect = normaliseRect({ x, y }, { x: x + w, y: y + h });
    gesture.dragged =
      gesture.dragged ||
      rect.width * this.zoom > 3 ||
      rect.height * this.zoom > 3;
    c.setPreview([{ ...gesture.base, ...rect } as BoardElement], {
      live: false,
    });
  }

  private finishCreate(gesture: Extract<Gesture, { kind: "create" }>): void {
    const c = this.c;
    this.gesture = { kind: "none" };
    let element = c.previewed(gesture.base.id) ?? gesture.base;
    if (!gesture.dragged || element.width < 2 || element.height < 2) {
      const size =
        gesture.tool === "sticky" || gesture.tool === "frame"
          ? DEFAULT_SIZES[gesture.tool]
          : defaultShapeSize(shapeChoiceOf(gesture.base) ?? "rectangle");
      element = {
        ...gesture.base,
        x: gesture.origin.x - size.width / 2,
        y: gesture.origin.y - size.height / 2,
        ...size,
      } as BoardElement;
    }
    c.cancelPreview();
    if (!c.insert([element])) return;
    if (element.type === "frame") {
      // A new frame adopts what it was drawn around.
      const inside = elementsInBox(
        c.elements() as BoardElement[],
        elementBox(element),
        {
          fullyInside: true,
        },
      )
        .filter((other) => other.id !== element.id && other.type !== "frame")
        .map((other) => other.id);
      const framed = assignFrames(c.elements() as BoardElement[], inside);
      if (framed.length > 0) c.commit(framed);
    }
    c.dispatchTool({ type: "created" });
    if (element.type === "sticky") this.hooks.editText(element.id);
  }

  /** The element whose words a click with the Text tool edits. */
  private textTargetAt(point: P): BoardElement | null {
    const hit = this.hitAt(point);
    if (
      hit &&
      !hit.locked &&
      (hit.type === "text" ||
        hit.type === "sticky" ||
        LABELLED_SHAPES.has(hit.type))
    )
      return hit;
    // A hollow shape only catches clicks on its outline.
    return findBindTarget(
      this.c
        .elements()
        .filter(
          (element) => LABELLED_SHAPES.has(element.type) && !element.locked,
        ) as BoardElement[],
      point,
      0,
    );
  }

  private createText(point: P): void {
    const c = this.c;
    const style = c.state.style;
    const element = c.newElement("text", {
      x: point.x,
      y: point.y - (style.fontSize * 1.25) / 2,
      width: 1,
      height: style.fontSize * 1.25,
      text: "",
      autoSize: true,
    });
    c.setPreview([element], { live: false });
    c.select([element.id]);
    this.hooks.editText(element.id, { isNew: true });
  }

  // ----- lines and arrows ------------------------------------------------

  private bindTargetAt(
    point: P,
    excludeId: string | null,
  ): BoardElement | null {
    if (this.modifiers.mod) return null;
    const exclude = excludeId ? new Set([excludeId]) : undefined;
    return findBindTarget(
      this.c.elements() as BoardElement[],
      point,
      this.tolerance(BIND_DISTANCE),
      exclude,
    );
  }

  private lineDown(
    event: PointerEvent,
    tool: "arrow" | "line",
    point: P,
  ): void {
    const c = this.c;
    const grid = c.settings.gridSize;
    const start =
      grid > 0 && !this.modifiers.mod ? snapToGrid(point, grid) : point;
    const target = this.bindTargetAt(start, null);
    const base = c.newElement(tool, {
      x: start.x,
      y: start.y,
      width: 0,
      height: 0,
      points: [
        [0, 0],
        [0, 0],
      ],
    }) as LinearElement;
    this.gesture = {
      kind: "linear",
      pointerId: event.pointerId,
      base,
      points: [[0, 0]],
      dragging: true,
      startTarget: target?.id ?? null,
    };
    c.setOverlay({ bindTargetId: target?.id ?? null });
  }

  private linePointer(
    gesture: Extract<Gesture, { kind: "linear" }>,
  ): [number, number] {
    const point = this.pointer ?? { x: gesture.base.x, y: gesture.base.y };
    let local: [number, number] = [
      point.x - gesture.base.x,
      point.y - gesture.base.y,
    ];
    const last = gesture.points[gesture.points.length - 1] ?? [0, 0];
    if (this.modifiers.shift) local = snapToAngle(last, local);
    const grid = this.c.settings.gridSize;
    if (grid > 0 && !this.modifiers.mod) {
      const snapped = snapToGrid(
        { x: gesture.base.x + local[0], y: gesture.base.y + local[1] },
        grid,
      );
      local = [snapped.x - gesture.base.x, snapped.y - gesture.base.y];
    }
    return local;
  }

  private updateLinePreview(
    gesture: Extract<Gesture, { kind: "linear" }>,
    point: P,
  ): void {
    const c = this.c;
    const end = this.linePointer(gesture);
    const target = this.bindTargetAt(point, null);
    const points = [...gesture.points, end];
    const line = withPoints(gesture.base, points);
    c.setPreview([line], { live: false });
    c.setOverlay({ bindTargetId: target?.id ?? gesture.startTarget });
  }

  private addLinePoint(point: P, _pointerId: number): void {
    const gesture = this.gesture;
    if (gesture.kind !== "linear") return;
    this.pointer = point;
    const next = this.linePointer(gesture);
    const last = gesture.points[gesture.points.length - 1] ?? [0, 0];
    // Clicking on the last point again ends the line.
    if (Math.hypot(next[0] - last[0], next[1] - last[1]) * this.zoom < 6) {
      this.finishLine();
      return;
    }
    gesture.points.push(next);
    // Clicking onto a shape binds and ends the line there.
    if (this.bindTargetAt(point, null) && gesture.points.length >= 2)
      this.finishLine();
  }

  private finishLine(): void {
    const c = this.c;
    const gesture = this.gesture;
    if (gesture.kind !== "linear") return;
    this.gesture = { kind: "none" };
    c.cancelPreview();
    c.resetOverlay();
    const points = dedupePoints(gesture.points);
    if (points.length < 2) return;
    let line = withPoints(gesture.base, points);
    const last = points[points.length - 1] ?? [0, 0];
    const endPoint = { x: line.x + last[0], y: line.y + last[1] };
    const endTarget = this.bindTargetAt(endPoint, null);
    const startTarget = gesture.startTarget ? c.get(gesture.startTarget) : null;
    line = {
      ...line,
      startBinding: startTarget
        ? bindingFor(startTarget, { x: line.x, y: line.y })
        : null,
      endBinding:
        endTarget && endTarget.id !== startTarget?.id
          ? bindingFor(endTarget, endPoint)
          : null,
    };
    if (line.routing === "elbow" && !line.startBinding && !line.endBinding) {
      line = withPoints(line, routeElbow({ x: line.x, y: line.y }, endPoint));
    }
    // Bound ends snap onto the outline of their shapes.
    if (line.startBinding || line.endBinding) {
      const ids = [
        line.startBinding?.elementId,
        line.endBinding?.elementId,
      ].filter((id): id is string => Boolean(id));
      const routed = updateBoundLines(
        [...(c.elements() as BoardElement[]), line],
        ids,
      ).find((element) => element.id === line.id);
      if (routed && isLinear(routed)) line = routed;
    }
    if (c.insert([line])) c.dispatchTool({ type: "created" });
  }

  /** Index of the line point under `point`, if any. */
  linePointAt(line: LinearElement, point: P): number | null {
    const reach = this.tolerance(10);
    for (let index = line.points.length - 1; index >= 0; index--) {
      const local = line.points[index];
      if (!local) continue;
      const world = linePointWorld(line, local);
      if (Math.hypot(world.x - point.x, world.y - point.y) <= reach)
        return index;
    }
    return null;
  }

  /** Insert index when the pointer is on a segment midpoint handle. */
  private lineMidpointAt(line: LinearElement, point: P): number | null {
    if (line.routing === "elbow") return null;
    const reach = this.tolerance(8);
    for (let index = 0; index < line.points.length - 1; index++) {
      const a = line.points[index];
      const b = line.points[index + 1];
      if (!a || !b) continue;
      const mid = linePointWorld(line, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * this.zoom;
      if (length < 40) continue;
      if (Math.hypot(mid.x - point.x, mid.y - point.y) <= reach)
        return index + 1;
    }
    return null;
  }

  private startPointDrag(
    line: LinearElement,
    index: number,
    pointerId: number,
    inserted = false,
  ): void {
    let original = line;
    if (inserted) {
      const a = line.points[index - 1] ?? [0, 0];
      const b = line.points[index] ?? [0, 0];
      const points = [...line.points];
      points.splice(index, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      original = { ...line, points };
    }
    this.gesture = { kind: "point", pointerId, original, index, inserted };
  }

  private movePoint(
    gesture: Extract<Gesture, { kind: "point" }>,
    point: P,
  ): void {
    const c = this.c;
    const line = gesture.original;
    const points = [...line.points] as [number, number][];
    const grid = c.settings.gridSize;
    const to =
      grid > 0 && !this.modifiers.mod ? snapToGrid(point, grid) : point;
    const local = worldToLinePoint(line, to);
    points[gesture.index] = local;
    let next: LinearElement = withPoints(
      { ...line, angle: 0 },
      absolutePoints(line, points),
    );
    const isStart = gesture.index === 0;
    const isEnd = gesture.index === points.length - 1;
    let bindTargetId: string | null = null;
    if (isStart || isEnd) {
      const target = this.bindTargetAt(to, null);
      const other = isStart
        ? line.endBinding?.elementId
        : line.startBinding?.elementId;
      const binding =
        target && target.id !== other ? bindingFor(target, to) : null;
      bindTargetId = binding?.elementId ?? null;
      next = isStart
        ? { ...next, startBinding: binding }
        : { ...next, endBinding: binding };
    }
    c.setPreview([next]);
    c.setOverlay({ bindTargetId });
  }

  // ----- pen -------------------------------------------------------------

  private drawDown(event: PointerEvent, point: P): void {
    const c = this.c;
    const pen = event.pointerType === "pen";
    const base = c.newElement("draw", {
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
      points: [[0, 0]],
      pressures: pen ? [event.pressure || 0.5] : [],
      simulatePressure: !pen,
      fillColor: "transparent",
    });
    this.gesture = {
      kind: "draw",
      pointerId: event.pointerId,
      base,
      points: [[0, 0]],
      pressures: pen ? [event.pressure || 0.5] : [],
      pen,
    };
    this.previewDraw(this.gesture);
  }

  private previewDraw(gesture: Extract<Gesture, { kind: "draw" }>): void {
    const extent = extentOf(gesture.points);
    // The points array is shared and grows in place: copying it on every
    // sample would make long strokes quadratic.
    const preview = {
      ...gesture.base,
      points: gesture.points,
      pressures: gesture.pressures,
      width: extent.maxX - extent.minX,
      height: extent.maxY - extent.minY,
    } as BoardElement;
    this.c.setPreview([preview], { live: false });
  }

  private finishDraw(gesture: Extract<Gesture, { kind: "draw" }>): void {
    const c = this.c;
    this.gesture = { kind: "none" };
    c.cancelPreview();
    const points = gesture.points.slice(0, 5_000);
    if (points.length === 1) points.push([0.5, 0.5]);
    const extent = extentOf(points);
    const element = {
      ...gesture.base,
      x: gesture.base.x + extent.minX,
      y: gesture.base.y + extent.minY,
      width: Math.max(1, extent.maxX - extent.minX),
      height: Math.max(1, extent.maxY - extent.minY),
      points: points.map(
        ([x, y]) => [x - extent.minX, y - extent.minY] as const,
      ),
      // Two decimals are all a pen's pressure needs, and keep strokes small.
      pressures: gesture.pen
        ? gesture.pressures
            .slice(0, points.length)
            .map((pressure) => Math.round(pressure * 100) / 100)
        : [],
    } as BoardElement;
    c.insert([element], { select: false });
  }

  // ----- eraser and laser -------------------------------------------------

  private eraseAt(point: P): void {
    const gesture = this.gesture;
    if (gesture.kind !== "erase") return;
    const c = this.c;
    const reach = this.tolerance(8);
    const fresh: BoardElement[] = [];
    for (const element of c.scene.elements) {
      if (gesture.hits.has(element.id) || element.locked) continue;
      if (!hitTest(element, point, reach)) continue;
      for (const id of c.expandToGroups([element.id])) {
        if (gesture.hits.has(id)) continue;
        gesture.hits.add(id);
        const target = c.scene.get(id);
        if (target)
          fresh.push({
            ...target,
            opacity: Math.max(10, target.opacity * 0.25),
          });
      }
    }
    if (fresh.length > 0) c.setPreview(fresh, { live: false });
    const trail = [...c.overlay.eraserTrail, [point.x, point.y] as const].slice(
      -24,
    );
    c.setOverlay({ eraserTrail: trail, erasing: gesture.hits });
  }

  private addLaserPoint(point: P): void {
    const c = this.c;
    const now = performance.now();
    c.laser.push([point.x, point.y, now]);
    if (c.laser.length > 160) c.laser.splice(0, c.laser.length - 160);
    const recent = c.laser.filter((entry) => now - entry[2] < 1000);
    c.publishLaser(recent.map(([x, y]) => [x, y]));
    c.requestRender(false);
  }

  // ----- pinch zoom --------------------------------------------------------

  private startPinch(): void {
    const c = this.c;
    // A second finger cancels whatever the first one started.
    if (this.gesture.kind !== "none" && this.gesture.kind !== "pinch") {
      c.cancelPreview();
      c.resetOverlay();
    }
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return;
    this.cancelLongPress();
    this.gesture = {
      kind: "pinch",
      startViewport: c.state.viewport,
      startCentre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  }

  private movePinch(): void {
    const gesture = this.gesture;
    if (gesture.kind !== "pinch") return;
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return;
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const start = gesture.startViewport;
    const zoom = Math.min(
      30,
      Math.max(0.1, (start.zoom * distance) / gesture.startDistance),
    );
    const anchor = toBoard(start, gesture.startCentre.x, gesture.startCentre.y);
    this.c.setViewport({
      zoom,
      scrollX: centre.x / zoom - anchor.x,
      scrollY: centre.y / zoom - anchor.y,
    });
  }

  // ----- double click -----------------------------------------------------

  private doubleClick(point: P): void {
    const c = this.c;
    this.gesture = { kind: "none" };
    const hit = this.hitAt(point, true);
    if (c.state.croppingId) {
      // Double-clicking the image being cropped finishes, like Enter.
      if (hit?.id === c.state.croppingId) {
        c.endCrop();
        return;
      }
      c.endCrop();
    }
    if (hit?.type === "task") {
      this.hooks.openTask(hit.taskId);
      return;
    }
    if (hit) {
      const outer = hit.groupIds[0];
      const editing = c.state.editingGroupId;
      if (outer && !(editing && hit.groupIds.includes(editing))) {
        // Enter the group: the next clicks select inside it.
        const inner = c.expandToGroups([hit.id], outer);
        c.update((state) =>
          setSelection({ ...state, editingGroupId: outer }, inner),
        );
        return;
      }
      if (
        !c.readOnly &&
        !hit.locked &&
        (TEXT_CAPABLE.has(hit.type) || hit.type === "frame")
      ) {
        c.select([hit.id]);
        this.hooks.editText(hit.id);
        return;
      }
      if (!c.readOnly && !hit.locked && hit.type === "image") {
        c.startCrop(hit.id);
        return;
      }
      return;
    }
    if (c.readOnly || c.state.tool !== "select") return;
    // A hollow shape only catches clicks on its outline, so a double click
    // in its middle would otherwise start a loose text on top of it.
    const shape = findBindTarget(
      c
        .elements()
        .filter(
          (element) => LABELLED_SHAPES.has(element.type) && !element.locked,
        ) as BoardElement[],
      point,
      0,
    );
    if (shape) {
      c.select([shape.id]);
      this.hooks.editText(shape.id);
      return;
    }
    this.createText(point);
  }

  /** Applies a tool pick from the keyboard while a gesture may be running. */
  pickTool(tool: Parameters<typeof applyToolEvent>[1]): void {
    this.cancel();
    this.c.update((state) => applyToolEvent(state, tool));
  }

  /** Where the overlay draws the polyline's next segment. */
  linePreviewPoints(): readonly P[] | null {
    const gesture = this.gesture;
    if (gesture.kind !== "linear") return null;
    return gesture.points.map(([x, y]) => ({
      x: gesture.base.x + x,
      y: gesture.base.y + y,
    }));
  }

  /** Screen point of a board point, for chrome positioned on the canvas. */
  toScreen(point: P): P {
    return toScreen(this.c.state.viewport, point.x, point.y);
  }
}

// ----- helpers ---------------------------------------------------------------

export function isLinear(
  element: BoardElement | undefined,
): element is LinearElement {
  return element?.type === "arrow" || element?.type === "line";
}

function normaliseRect(a: P, b: P) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function normaliseGuide(guide: SnapGuide): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  return guide.axis === "x"
    ? { x1: guide.at, y1: guide.start, x2: guide.at, y2: guide.end }
    : { x1: guide.start, y1: guide.at, x2: guide.end, y2: guide.at };
}

function releaseStaleBindings(
  element: BoardElement,
  moving: ReadonlySet<string>,
): BoardElement {
  if (!isLinear(element)) return element;
  const start =
    element.startBinding && !moving.has(element.startBinding.elementId);
  const end = element.endBinding && !moving.has(element.endBinding.elementId);
  if (!start && !end) return element;
  return {
    ...element,
    startBinding: start ? null : element.startBinding,
    endBinding: end ? null : element.endBinding,
  };
}

function bindingFor(target: BoardElement, point: P): Binding {
  const focus = focusFor(target, point);
  return { elementId: target.id, focus, gap: BINDING_GAP };
}

function extentOf(points: readonly (readonly [number, number])[]) {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** A line with these points (relative to its x/y), first point at 0,0. */
function withPoints(
  line: LinearElement,
  points: readonly (readonly [number, number])[],
): LinearElement {
  const first = points[0] ?? [0, 0];
  const shifted = points.map(([x, y]) => [x - first[0], y - first[1]] as const);
  const extent = extentOf(shifted);
  return {
    ...line,
    x: line.x + first[0],
    y: line.y + first[1],
    points: shifted,
    width: extent.maxX - extent.minX,
    height: extent.maxY - extent.minY,
  };
}

/** Board coordinates of a line point, honouring the line's rotation. */
function linePointWorld(
  line: LinearElement,
  local: readonly [number, number],
): P {
  const x = line.x + local[0];
  const y = line.y + local[1];
  if (!line.angle) return { x, y };
  const box = elementBox(line);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const cos = Math.cos(line.angle);
  const sin = Math.sin(line.angle);
  return {
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  };
}

function worldToLinePoint(line: LinearElement, point: P): [number, number] {
  if (!line.angle) return [point.x - line.x, point.y - line.y];
  const box = elementBox(line);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const cos = Math.cos(-line.angle);
  const sin = Math.sin(-line.angle);
  const x = cx + (point.x - cx) * cos - (point.y - cy) * sin;
  const y = cy + (point.x - cx) * sin + (point.y - cy) * cos;
  return [x - line.x, y - line.y];
}

/** Points of a rotated line baked into unrotated coordinates. */
function absolutePoints(
  line: LinearElement,
  points: readonly (readonly [number, number])[],
) {
  if (!line.angle) return points;
  return points.map((point) => {
    const world = linePointWorld(line, point);
    return [world.x - line.x, world.y - line.y] as const;
  });
}

function dedupePoints(points: readonly LocalPoint[]): LocalPoint[] {
  const result: LocalPoint[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (
      last &&
      Math.abs(last[0] - point[0]) < 0.5 &&
      Math.abs(last[1] - point[1]) < 0.5
    )
      continue;
    result.push(point);
  }
  return result;
}

/** Snaps a segment to 15 degree steps around its start (Shift). */
function snapToAngle(
  from: readonly [number, number],
  to: [number, number],
): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  const angle = snapAngle(Math.atan2(dy, dx));
  return [
    from[0] + Math.cos(angle) * length,
    from[1] + Math.sin(angle) * length,
  ];
}

function cursorForTool(tool: string): string {
  switch (tool) {
    case "hand":
      return "grab";
    case "text":
      return "text";
    case "eraser":
      return "cell";
    case "laser":
      return "crosshair";
    default:
      return "crosshair";
  }
}
