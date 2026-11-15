import type {
  ArrowHead,
  FillStyle,
  FontFamily,
  LineRouting,
  PenStyle,
  SketchLevel,
  StrokeStyle,
  TextAlign,
} from "@margaya/whiteboard";
import { PEN_STYLES, SHAPE_KINDS } from "@margaya/whiteboard";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  INITIAL_TOOL_STATE,
  isToolAllowed,
  type ShapeChoice,
  type ToolEvent,
  type ToolState,
  toolForShape,
  toolReducer,
} from "./tools";
import { DEFAULT_VIEWPORT, type Viewport } from "./viewport";

// Editor UI state, kept outside React so the canvas can read it every frame
// without re-rendering. React chrome subscribes to the slices it shows.
// Board content is not here: it lives in the Yjs document (see scene.ts).

/** The style new elements get, and what the properties panel edits. */
export type ItemStyle = {
  strokeColor: string;
  fillColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  sketch: SketchLevel;
  opacity: number;
  cornerRadius: number;
  fontFamily: FontFamily;
  fontSize: number;
  textAlign: TextAlign;
  startHead: ArrowHead;
  endHead: ArrowHead;
  routing: LineRouting;
  stickyColor: string;
  /** Highlighters keep their own colour and width, apart from other strokes. */
  highlighterColor: string;
  highlighterWidth: number;
};

export const DEFAULT_ITEM_STYLE: ItemStyle = {
  strokeColor: "#1e1e1e",
  fillColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  sketch: 1,
  opacity: 100,
  cornerRadius: 8,
  fontFamily: "hand",
  fontSize: 20,
  textAlign: "left",
  startHead: "none",
  endHead: "arrow",
  routing: "straight",
  stickyColor: "#fff3bf",
  highlighterColor: "#facc15",
  // The renderer widens highlighter strokes, so "bold" is already broad.
  highlighterWidth: 4,
};

export type DialogId =
  | "help"
  | "search"
  | "taskPicker"
  | "turnIntoTasks"
  | "link"
  /** The shape picker popover of the toolbar. */
  | "shapes"
  | null;

export type ContextMenuState = {
  /** Client (page) coordinates of the pointer. */
  clientX: number;
  clientY: number;
  /** The element under the pointer, if any (already selected). */
  targetId: string | null;
} | null;

export type EditorState = ToolState & {
  viewport: Viewport;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  selectedIds: readonly string[];
  /** The group the user double-clicked into, if any. */
  editingGroupId: string | null;
  /** The element whose text the overlay edits. */
  editingTextId: string | null;
  /** The image being cropped (crop mode), if any. */
  croppingId: string | null;
  style: ItemStyle;
  /** The last shape picked, which the toolbar's shape button draws. */
  shapeKind: ShapeChoice;
  /** The look of new pen strokes. */
  penStyle: PenStyle;
  snapToObjects: boolean;
  showMinimap: boolean;
  dialog: DialogId;
  contextMenu: ContextMenuState;
  /** Awareness client id being followed. */
  followingClientId: number | null;
  /** Bumped on every scene change so chrome can refresh derived values. */
  sceneVersion: number;
};

export const INITIAL_EDITOR_STATE: EditorState = {
  ...INITIAL_TOOL_STATE,
  viewport: DEFAULT_VIEWPORT,
  width: 0,
  height: 0,
  selectedIds: [],
  editingGroupId: null,
  editingTextId: null,
  croppingId: null,
  style: DEFAULT_ITEM_STYLE,
  shapeKind: "rectangle",
  penStyle: "pen",
  snapToObjects: true,
  showMinimap: false,
  dialog: null,
  contextMenu: null,
  followingClientId: null,
  sceneVersion: 0,
};

export type EditorStore = StoreApi<EditorState>;

export function createEditorStore(
  initial: Partial<EditorState> = {},
): EditorStore {
  return createStore<EditorState>(() => ({
    ...INITIAL_EDITOR_STATE,
    ...initial,
  }));
}

// Reducers. Each returns the next state (or the same object when nothing
// changes) so they are easy to test and cheap to apply.

export function applyToolEvent(
  state: EditorState,
  event: ToolEvent,
): EditorState {
  const next = toolReducer(state, event);
  if (next === state) return state;
  // R, D and O pick a classic shape: the shape button follows them.
  const shapeKind =
    event.type === "pick" &&
    (next.tool === "rectangle" ||
      next.tool === "ellipse" ||
      next.tool === "diamond")
      ? next.tool
      : state.shapeKind;
  return { ...state, ...next, shapeKind };
}

/** Picks a shape from the library: its tool becomes active and is remembered. */
export function pickShape(
  state: EditorState,
  choice: ShapeChoice,
  readOnly: boolean,
): EditorState {
  const tool = toolForShape(choice);
  if (!isToolAllowed(tool, readOnly)) return state;
  const next = applyToolEvent(state, { type: "pick", tool, readOnly });
  return {
    ...next,
    shapeKind: choice,
    dialog: next.dialog === "shapes" ? null : next.dialog,
  };
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function setSelection(
  state: EditorState,
  ids: readonly string[],
): EditorState {
  const unique = Array.from(new Set(ids));
  if (sameIds(unique, state.selectedIds)) return state;
  // Leaving the selection of an entered group exits the group.
  return { ...state, selectedIds: unique };
}

export function toggleInSelection(
  state: EditorState,
  ids: readonly string[],
): EditorState {
  const current = new Set(state.selectedIds);
  const allIn = ids.every((id) => current.has(id));
  for (const id of ids) {
    if (allIn) current.delete(id);
    else current.add(id);
  }
  return { ...state, selectedIds: Array.from(current) };
}

/** Drops ids that no longer exist (deleted here or by a collaborator). */
export function pruneSelection(
  state: EditorState,
  exists: (id: string) => boolean,
): EditorState {
  const kept = state.selectedIds.filter(exists);
  const editingTextId =
    state.editingTextId && exists(state.editingTextId)
      ? state.editingTextId
      : null;
  if (
    kept.length === state.selectedIds.length &&
    editingTextId === state.editingTextId
  )
    return state;
  return { ...state, selectedIds: kept, editingTextId };
}

export function setViewport(
  state: EditorState,
  viewport: Viewport,
): EditorState {
  const v = state.viewport;
  if (
    v.zoom === viewport.zoom &&
    v.scrollX === viewport.scrollX &&
    v.scrollY === viewport.scrollY
  )
    return state;
  return { ...state, viewport };
}

export function patchStyle(
  state: EditorState,
  patch: Partial<ItemStyle>,
): EditorState {
  return { ...state, style: { ...state.style, ...patch } };
}

export function openDialog(state: EditorState, dialog: DialogId): EditorState {
  if (state.dialog === dialog) return state;
  return { ...state, dialog, contextMenu: null };
}

/** Escape: close menus first, then crop mode or text editing, then the group, then the selection. */
export function escapeStep(state: EditorState): EditorState {
  if (state.contextMenu) return { ...state, contextMenu: null };
  // Leaving crop mode keeps the image selected and the crop it has.
  if (state.croppingId) return { ...state, croppingId: null };
  if (state.editingTextId) return { ...state, editingTextId: null };
  if (state.tool !== "select") return applyToolEvent(state, { type: "cancel" });
  if (state.editingGroupId) return { ...state, editingGroupId: null };
  if (state.selectedIds.length > 0) return { ...state, selectedIds: [] };
  return state;
}

/** Persisted per browser: the last style and toggles, never board content. */
const PREFS_KEY = "margaya-whiteboard-editor";

type StoredPrefs = Pick<
  EditorState,
  "style" | "snapToObjects" | "showMinimap" | "shapeKind" | "penStyle"
>;

const SHAPE_CHOICES: readonly unknown[] = [
  "rectangle",
  "ellipse",
  "diamond",
  ...SHAPE_KINDS,
];

export function loadPrefs(): Partial<EditorState> {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
    const prefs: Partial<EditorState> = {};
    if (parsed.style && typeof parsed.style === "object") {
      prefs.style = sanitizeStyle(parsed.style);
    }
    if (typeof parsed.snapToObjects === "boolean")
      prefs.snapToObjects = parsed.snapToObjects;
    if (typeof parsed.showMinimap === "boolean")
      prefs.showMinimap = parsed.showMinimap;
    if (SHAPE_CHOICES.includes(parsed.shapeKind))
      prefs.shapeKind = parsed.shapeKind as ShapeChoice;
    if ((PEN_STYLES as readonly unknown[]).includes(parsed.penStyle))
      prefs.penStyle = parsed.penStyle as PenStyle;
    return prefs;
  } catch {
    return {};
  }
}

export function savePrefs(state: EditorState): void {
  try {
    const prefs: StoredPrefs = {
      style: state.style,
      snapToObjects: state.snapToObjects,
      showMinimap: state.showMinimap,
      shapeKind: state.shapeKind,
      penStyle: state.penStyle,
    };
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage may be blocked; the defaults still work.
  }
}

const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|transparent)$/i;

function sanitizeStyle(raw: Partial<ItemStyle>): ItemStyle {
  const base = DEFAULT_ITEM_STYLE;
  const pick = <K extends keyof ItemStyle>(
    key: K,
    valid: (value: unknown) => boolean,
  ): ItemStyle[K] => (valid(raw[key]) ? (raw[key] as ItemStyle[K]) : base[key]);
  const isColor = (v: unknown) => typeof v === "string" && COLOR.test(v);
  const inList = (list: readonly unknown[]) => (v: unknown) => list.includes(v);
  const inRange = (min: number, max: number) => (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  return {
    strokeColor: pick("strokeColor", isColor),
    fillColor: pick("fillColor", isColor),
    fillStyle: pick("fillStyle", inList(["none", "solid", "hatch", "cross"])),
    strokeWidth: pick("strokeWidth", inRange(0.5, 64)),
    strokeStyle: pick("strokeStyle", inList(["solid", "dashed", "dotted"])),
    sketch: pick("sketch", inList([0, 1, 2])),
    opacity: pick("opacity", inRange(0, 100)),
    cornerRadius: pick("cornerRadius", inRange(0, 200)),
    fontFamily: pick("fontFamily", inList(["hand", "sans", "mono"])),
    fontSize: pick("fontSize", inRange(4, 512)),
    textAlign: pick("textAlign", inList(["left", "center", "right"])),
    startHead: pick(
      "startHead",
      inList(["none", "arrow", "triangle", "dot", "bar"]),
    ),
    endHead: pick(
      "endHead",
      inList(["none", "arrow", "triangle", "dot", "bar"]),
    ),
    routing: pick("routing", inList(["straight", "curved", "elbow"])),
    stickyColor: pick("stickyColor", isColor),
    highlighterColor: pick("highlighterColor", isColor),
    highlighterWidth: pick("highlighterWidth", inRange(0.5, 64)),
  };
}
