import {
  type AlignEdge,
  alignElements,
  type BoardElement,
  type BoardSettings,
  bringForward,
  bringToFront,
  type DistributeAxis,
  distributeElements,
  elementBox,
  type FlipAxis,
  flipElements,
  frameChildren,
  groupElements,
  type ImageElement,
  layoutText,
  randomNonce,
  sendBackward,
  sendToBack,
  translateElements,
  ungroupElements,
  updateBoundLines,
  updateElement,
} from "@margaya/whiteboard";
import {
  isWhiteboardImageType,
  UnsupportedWhiteboardImageError,
} from "@/lib/whiteboards/upload-whiteboard-image";
import { whiteboardAssetUrl } from "@/lib/whiteboards/whiteboard-paths";
import {
  parseClipboardText,
  readClipboard,
  serializeClipboard,
  writeClipboardText,
} from "./clipboard";
import { type BoardController, unionBounds } from "./controller";
import { pictureFrame, uncropped } from "./crop";
import { measureText } from "./measure";
import { defaultShapeSize, isSwappableShape } from "./shapes";
import type { CommandId } from "./shortcuts";
import { escapeStep, openDialog, setSelection } from "./store";
import { measureTextElement } from "./text-overlay";
import { isClassicShape, type ShapeChoice } from "./tools";
import { nextZoomStep, visibleRect } from "./viewport";

// Every command the toolbar, keyboard, context menu and panel can run. Each
// one checks write access through the controller, so a read-only board
// refuses edits however they are triggered.

export type CommandContext = {
  /** Board point to paste at (the pointer), when known. */
  at?: { x: number; y: number } | null;
  editText?: (elementId: string) => void;
  event?: ClipboardEvent | null;
};

/** Default grid when the grid is switched on. */
export const GRID_SIZE = 20;

export function selectionWithChildren(c: BoardController): BoardElement[] {
  const selected = c.selectedElements();
  const all = c.elements() as BoardElement[];
  const ids = new Set(selected.map((element) => element.id));
  const result = [...selected];
  for (const element of selected) {
    if (element.type !== "frame") continue;
    for (const child of frameChildren(all, element.id)) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        result.push(child);
      }
    }
  }
  return result;
}

export async function copySelection(
  c: BoardController,
  event?: ClipboardEvent | null,
): Promise<boolean> {
  const elements = selectionWithChildren(c);
  if (elements.length === 0) return false;
  const ok = await writeClipboardText(
    serializeClipboard(elements, c.options.whiteboardId),
    event,
  );
  if (ok) c.callbacks.notice?.("copied");
  return ok;
}

/** The board point pasted content centres on. */
function pasteTarget(c: BoardController, at?: { x: number; y: number } | null) {
  const { viewport, width, height } = c.state;
  const visible = visibleRect(viewport, width, height);
  if (
    at &&
    at.x >= visible.x &&
    at.y >= visible.y &&
    at.x <= visible.x + visible.width &&
    at.y <= visible.y + visible.height
  )
    return at;
  return {
    x: visible.x + visible.width / 2,
    y: visible.y + visible.height / 2,
  };
}

/** Inserts copies of `elements` centred on a point and selects them. */
export function placeElements(
  c: BoardController,
  elements: readonly BoardElement[],
  at?: { x: number; y: number } | null,
): boolean {
  const box = unionBounds(elements);
  if (!box) return false;
  const target = pasteTarget(c, at);
  const offset = {
    x: Math.round(target.x - (box.x + box.width / 2)),
    y: Math.round(target.y - (box.y + box.height / 2)),
  };
  const copies = c.duplicate(elements, offset);
  // Frames and groups that were not copied must not claim the copies.
  const copyIds = new Set(copies.map((element) => element.id));
  const cleaned = copies.map((element) =>
    element.frameId && !copyIds.has(element.frameId)
      ? ({ ...element, frameId: null } as BoardElement)
      : element,
  );
  if (!c.insert(cleaned, { select: false })) return false;
  // Select the top-level copies (not the children of copied frames).
  const framed = new Set(
    cleaned.filter((element) => element.frameId).map((element) => element.id),
  );
  c.update((state) =>
    setSelection(
      { ...state, editingGroupId: null },
      cleaned.filter((element) => !framed.has(element.id)).map((e) => e.id),
    ),
  );
  return true;
}

/** A text element sized to its content. */
export function textElement(
  c: BoardController,
  text: string,
  at: { x: number; y: number },
  link: string | null = null,
): BoardElement {
  const style = c.state.style;
  const layout = layoutText(
    text,
    { fontSize: style.fontSize, fontFamily: style.fontFamily, maxWidth: 800 },
    measureText,
  );
  return c.newElement("text", {
    x: at.x - layout.width / 2,
    y: at.y - layout.height / 2,
    width: Math.max(1, layout.width),
    height: Math.max(1, layout.height),
    text: text.slice(0, 20_000),
    autoSize: layout.width < 800,
    link,
  });
}

export async function pasteContent(
  c: BoardController,
  content: { text: string | null; files: File[] },
  at?: { x: number; y: number } | null,
): Promise<void> {
  if (!c.canWrite()) return;
  const images = content.files.filter((file) =>
    isWhiteboardImageType(file.type),
  );
  // Files the board can't hold (an SVG, a PDF) say so instead of "Nothing to
  // paste", unless the clipboard also carries text to paste instead.
  const refused = content.files.length > images.length;
  if (refused && (images.length > 0 || !content.text?.trim())) {
    c.callbacks.notice?.("imageType");
  }
  if (images.length > 0) {
    let index = 0;
    for (const file of images.slice(0, 10)) {
      const point = pasteTarget(c, at);
      await insertImage(c, file, {
        x: point.x + index * 24,
        y: point.y + index * 24,
      });
      index++;
    }
    return;
  }
  const parsed = parseClipboardText(content.text);
  if (refused && parsed.kind === "empty") return;
  if (parsed.kind === "elements") {
    const elements = await rehomeImages(c, parsed.elements, {
      sourceBoardId: parsed.sourceBoardId,
      images: parsed.images,
    });
    placeElements(c, elements, at);
    return;
  }
  if (parsed.kind === "text") {
    const element = textElement(c, parsed.text, pasteTarget(c, at), parsed.url);
    c.insert([element]);
    return;
  }
  c.callbacks.notice?.("pasteEmpty");
}

/** A picture's bytes, or null when they can't be had. */
async function pictureBlob(url: string): Promise<Blob | null> {
  // Decoded here: the page's content policy doesn't let fetch read data: URLs.
  const inline = /^data:([^;,]+);base64,(.*)$/.exec(url);
  if (inline) {
    const [, type = "", data = ""] = inline;
    if (!isWhiteboardImageType(type)) return null;
    try {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      return new Blob([bytes], { type });
    } catch {
      return null;
    }
  }
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) return null;
    const blob = await response.blob();
    return isWhiteboardImageType(blob.type) ? blob : null;
  } catch {
    return null;
  }
}

/**
 * Images pasted or imported from another board point at that board's
 * uploads, which this board can't show. Each picture is uploaded here again,
 * from the file that carries it or from the board it was copied from, and
 * the elements point at the new uploads. A picture that can't be had keeps
 * its element as it was.
 */
export async function rehomeImages(
  c: BoardController,
  elements: BoardElement[],
  source: { sourceBoardId?: string | null; images?: Record<string, string> },
): Promise<BoardElement[]> {
  const upload = c.options.uploadImage;
  const sourceBoardId = source.sourceBoardId ?? null;
  if (!upload || c.options.isPublic) return elements;
  if (sourceBoardId === c.options.whiteboardId) return elements;
  const assetIds = new Set<string>();
  for (const element of elements) {
    if (element.type === "image" && element.assetId)
      assetIds.add(element.assetId);
  }
  const moved = new Map<string, string>();
  let announced = false;
  let uploaded: (() => void) | undefined;
  let missing = false;
  for (const assetId of assetIds) {
    const embedded = source.images?.[assetId];
    const url =
      embedded ??
      (sourceBoardId ? whiteboardAssetUrl(sourceBoardId, assetId) : null);
    if (!url) continue;
    const blob = await pictureBlob(url);
    if (!blob) {
      missing = true;
      continue;
    }
    if (!announced) {
      uploaded = c.callbacks.notice?.("uploading");
      announced = true;
    }
    try {
      const result = await upload(
        new File([blob], "image", { type: blob.type }),
      );
      moved.set(assetId, result.assetId);
    } catch {
      missing = true;
    }
  }
  uploaded?.();
  // The elements still come; their pictures show as placeholders.
  if (missing) c.callbacks.notice?.("imageMissing");
  if (moved.size === 0) return elements;
  return elements.map((element) =>
    element.type === "image" && element.assetId && moved.has(element.assetId)
      ? { ...element, assetId: moved.get(element.assetId) ?? element.assetId }
      : element,
  );
}

/** Uploads an image and places it, scaled to a comfortable size. */
export async function insertImage(
  c: BoardController,
  file: File,
  at: { x: number; y: number },
): Promise<boolean> {
  if (!c.canWrite()) return false;
  const upload = c.options.uploadImage;
  if (!upload || c.options.isPublic) {
    c.callbacks.notice?.("imagesOff");
    return false;
  }
  if (!isWhiteboardImageType(file.type)) {
    c.callbacks.notice?.("imageType");
    return false;
  }
  const uploaded = c.callbacks.notice?.("uploading");
  try {
    const result = await upload(file);
    uploaded?.();
    const max = 600;
    const scale = Math.min(
      1,
      max / Math.max(result.width || max, result.height || max),
    );
    const width = Math.max(8, (result.width || max) * scale);
    const height = Math.max(8, (result.height || max) * scale);
    const element = c.newElement("image", {
      x: at.x - width / 2,
      y: at.y - height / 2,
      width,
      height,
      assetId: result.assetId,
    });
    return c.insert([element]);
  } catch (error) {
    // The failure takes the place of the progress notice.
    uploaded?.();
    c.callbacks.notice?.(
      error instanceof UnsupportedWhiteboardImageError
        ? "imageType"
        : "uploadFailed",
    );
    return false;
  }
}

function changed(c: BoardController, next: BoardElement[]): boolean {
  if (next.length === 0) return false;
  return c.commit(next);
}

export function reorder(
  c: BoardController,
  direction: "forward" | "backward" | "front" | "back",
): boolean {
  if (!c.canWrite()) return false;
  const ids = selectionWithChildren(c).map((element) => element.id);
  if (ids.length === 0) return false;
  const all = c.scene.elements as BoardElement[];
  const fn =
    direction === "forward"
      ? bringForward
      : direction === "backward"
        ? sendBackward
        : direction === "front"
          ? bringToFront
          : sendToBack;
  return changed(c, fn(all, ids));
}

export function align(c: BoardController, edge: AlignEdge): boolean {
  if (!c.canWrite()) return false;
  const selected = c.selectedElements().filter((element) => !element.locked);
  if (selected.length < 2) return false;
  const next = alignElements(selected, edge, { userId: c.userId });
  return commitWithLines(c, next);
}

export function distribute(c: BoardController, axis: DistributeAxis): boolean {
  if (!c.canWrite()) return false;
  const selected = c.selectedElements().filter((element) => !element.locked);
  if (selected.length < 3) return false;
  return commitWithLines(
    c,
    distributeElements(selected, axis, { userId: c.userId }),
  );
}

export function flip(c: BoardController, axis: FlipAxis): boolean {
  if (!c.canWrite()) return false;
  const selected = c.selectedElements().filter((element) => !element.locked);
  if (selected.length === 0) return false;
  return commitWithLines(c, flipElements(selected, axis, { userId: c.userId }));
}

/**
 * Commits moved elements together with the lines bound to them (to those
 * in `moved`, when only some of them changed shape or place).
 */
export function commitWithLines(
  c: BoardController,
  next: BoardElement[],
  moved: readonly string[] = next.map((element) => element.id),
): boolean {
  if (next.length === 0) return false;
  const byId = new Map(next.map((element) => [element.id, element]));
  const all = (c.scene.elements as BoardElement[]).map(
    (element) => byId.get(element.id) ?? element,
  );
  const lines = updateBoundLines(all, moved, { userId: c.userId }).filter(
    (line) => !byId.has(line.id),
  );
  return c.commit([...next, ...lines]);
}

export function nudge(c: BoardController, dx: number, dy: number): boolean {
  if (!c.canWrite()) return false;
  const selected = selectionWithChildren(c).filter(
    (element) => !element.locked,
  );
  if (selected.length === 0) return false;
  return commitWithLines(
    c,
    translateElements(selected, dx, dy, { userId: c.userId }),
  );
}

export function setLocked(c: BoardController, locked: boolean): boolean {
  const selected = c.selectedElements();
  if (selected.length === 0) return false;
  return c.patch(selected, { locked });
}

export function duplicateSelection(c: BoardController): boolean {
  if (!c.canWrite()) return false;
  const elements = selectionWithChildren(c);
  if (elements.length === 0) return false;
  const copies = c.duplicate(elements, { x: 16, y: 16 });
  if (!c.insert(copies, { select: false })) return false;
  const top = new Set(c.state.selectedIds);
  const selected = copies.filter((_, index) =>
    top.has(elements[index]?.id ?? ""),
  );
  c.select(
    (selected.length > 0 ? selected : copies).map((element) => element.id),
  );
  return true;
}

export function selectAll(c: BoardController): void {
  const ids = c.scene.elements
    .filter((element) => !element.locked)
    .map((element) => element.id);
  c.update((state) => setSelection({ ...state, editingGroupId: null }, ids));
}

const STYLE_KEYS = [
  "strokeColor",
  "fillColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "sketch",
  "opacity",
  "fontFamily",
  "fontSize",
  "textAlign",
  "cornerRadius",
  "startHead",
  "endHead",
  "routing",
] as const;

export function copyStyle(c: BoardController): void {
  const first = c.selectedElements()[0];
  if (!first) return;
  const style: Record<string, unknown> = {};
  for (const key of STYLE_KEYS) {
    if (key in first) style[key] = (first as Record<string, unknown>)[key];
  }
  c.copiedStyle = style as Partial<BoardElement>;
}

/** A text element sized to its words again, after its font changed. */
export function refitText(element: BoardElement): BoardElement {
  if (element.type !== "text") return element;
  return { ...element, ...measureTextElement(element, element.text) };
}

export function pasteStyle(c: BoardController): boolean {
  const style = c.copiedStyle;
  if (!style || !c.canWrite()) return false;
  const next = c
    .selectedElements()
    .filter((element) => !element.locked)
    .map((element) => {
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(style)) {
        if (key in element) patch[key] = value;
      }
      return refitText(
        updateElement(element, patch as never, { userId: c.userId }),
      );
    });
  return changed(c, next);
}

/** The one selected image, when it can be cropped. */
export function croppableImage(c: BoardController): ImageElement | null {
  const selected = c.selectedElements();
  const only = selected[0];
  if (selected.length !== 1 || only?.type !== "image" || only.locked)
    return null;
  return only.assetId ? only : null;
}

/** Shows the whole picture of the selected images again, where it lay. */
export function resetCrop(c: BoardController): boolean {
  if (!c.canWrite()) return false;
  const next: BoardElement[] = [];
  for (const element of c.selectedElements()) {
    if (element.type !== "image" || element.locked || !element.crop) continue;
    const size = c.imageSize(element);
    const frame = size ? pictureFrame(element, size) : null;
    if (frame) next.push(uncropped(element, frame, { userId: c.userId }));
  }
  if (next.length === 0) return false;
  return commitWithLines(c, next);
}

export function zoomStep(c: BoardController, direction: 1 | -1): void {
  c.zoomTo(nextZoomStep(c.state.viewport.zoom, direction));
}

export function toggleGrid(c: BoardController): void {
  c.writeSettings({ gridSize: c.settings.gridSize > 0 ? 0 : GRID_SIZE });
}

// ----- shapes ------------------------------------------------------------------

/**
 * The element with another outline. The id, text, colours, size, links and
 * groups stay, so arrows bound to it stay bound; only the type's own fields
 * change (a rectangle's corners, a shape's kind).
 */
export function withShape(
  element: BoardElement,
  choice: ShapeChoice,
  options: { userId?: string | null; cornerRadius?: number } = {},
): BoardElement {
  const {
    shape: _shape,
    cornerRadius,
    ...rest
  } = element as BoardElement & {
    shape?: unknown;
    cornerRadius?: number;
  };
  const stamp = {
    version: element.version + 1,
    nonce: randomNonce(),
    updatedAt: Date.now(),
    updatedBy:
      options.userId !== undefined ? options.userId : element.updatedBy,
  };
  if (choice === "rectangle")
    return {
      ...rest,
      ...stamp,
      type: "rectangle",
      cornerRadius: cornerRadius ?? options.cornerRadius ?? 8,
    } as BoardElement;
  if (isClassicShape(choice))
    return { ...rest, ...stamp, type: choice } as BoardElement;
  return { ...rest, ...stamp, type: "shape", shape: choice } as BoardElement;
}

/** "Change shape": swaps the outline of the selected shapes. */
export function changeShape(c: BoardController, choice: ShapeChoice): boolean {
  if (!c.canWrite()) return false;
  const next = c
    .selectedElements()
    .filter((element) => isSwappableShape(element.type) && !element.locked)
    .map((element) =>
      withShape(element, choice, {
        userId: c.userId,
        cornerRadius: c.state.style.cornerRadius,
      }),
    );
  if (next.length === 0) return false;
  // Bound arrows end on the new outline.
  return commitWithLines(c, next);
}

/** A new shape of the default size centred on a board point, selected. */
export function addShape(
  c: BoardController,
  choice: ShapeChoice,
  at?: { x: number; y: number } | null,
): boolean {
  if (!c.canWrite()) return false;
  const centre = pasteTarget(c, at);
  const size = defaultShapeSize(choice);
  const box = {
    x: Math.round(centre.x - size.width / 2),
    y: Math.round(centre.y - size.height / 2),
    ...size,
  };
  const element = isClassicShape(choice)
    ? c.newElement(choice, box)
    : c.newElement("shape", { ...box, shape: choice });
  const ok = c.insert([element]);
  if (ok) c.update((state) => ({ ...state, shapeKind: choice }));
  return ok;
}

// ----- board background ------------------------------------------------------

/** Pattern spacings the background control offers (board units). */
export const PATTERN_SIZES = { small: 16, medium: 24, large: 40 } as const;

/** Writes the background for everyone on the board; refused when read-only. */
export function setBackground(
  c: BoardController,
  patch: Partial<Pick<BoardSettings, "background" | "pattern" | "patternSize">>,
): boolean {
  return c.writeSettings(patch);
}

export function runCommand(
  c: BoardController,
  command: CommandId,
  context: CommandContext = {},
): void {
  switch (command) {
    case "undo":
      c.undo();
      return;
    case "redo":
      c.redo();
      return;
    case "copy":
      void copySelection(c, context.event);
      return;
    case "cut":
      if (!c.canWrite()) return;
      void copySelection(c, context.event).then((ok) => {
        if (ok) c.remove([...c.state.selectedIds]);
      });
      return;
    case "paste":
      if (!c.canWrite()) return;
      void readClipboard().then((content) =>
        pasteContent(c, content, context.at),
      );
      return;
    case "duplicate":
      duplicateSelection(c);
      return;
    case "delete":
      c.remove([...c.state.selectedIds]);
      return;
    case "selectAll":
      selectAll(c);
      return;
    case "deselect":
      c.update(escapeStep);
      return;
    case "group": {
      if (!c.canWrite()) return;
      const ids = c.state.selectedIds;
      if (ids.length < 2) return;
      changed(c, groupElements(c.scene.elements as BoardElement[], ids));
      return;
    }
    case "ungroup": {
      if (!c.canWrite()) return;
      changed(
        c,
        ungroupElements(
          c.scene.elements as BoardElement[],
          c.state.selectedIds,
        ),
      );
      return;
    }
    case "bringForward":
      reorder(c, "forward");
      return;
    case "sendBackward":
      reorder(c, "backward");
      return;
    case "bringToFront":
      reorder(c, "front");
      return;
    case "sendToBack":
      reorder(c, "back");
      return;
    case "zoomIn":
      zoomStep(c, 1);
      return;
    case "zoomOut":
      zoomStep(c, -1);
      return;
    case "zoomReset":
      c.zoomTo(1);
      return;
    case "zoomFit":
      c.zoomToFit();
      return;
    case "zoomSelection": {
      const selected = c.selectedElements();
      if (selected.length > 0) c.zoomToElements(selected, 4);
      else c.zoomToFit();
      return;
    }
    case "toggleGrid":
      toggleGrid(c);
      return;
    case "toggleSnap":
      c.update((state) => ({ ...state, snapToObjects: !state.snapToObjects }));
      return;
    case "search":
      c.update((state) => openDialog(state, "search"));
      return;
    case "help":
      c.update((state) => openDialog(state, "help"));
      return;
    case "toggleToolLock":
      c.dispatchTool({ type: "toggleLock" });
      return;
    case "toggleElementLock": {
      const selected = c.selectedElements();
      if (selected.length === 0) return;
      setLocked(c, !selected.every((element) => element.locked));
      return;
    }
    case "flipHorizontal":
      flip(c, "horizontal");
      return;
    case "flipVertical":
      flip(c, "vertical");
      return;
    case "copyStyle":
      copyStyle(c);
      return;
    case "pasteStyle":
      pasteStyle(c);
      return;
    case "alignLeft":
      align(c, "left");
      return;
    case "alignRight":
      align(c, "right");
      return;
    case "alignTop":
      align(c, "top");
      return;
    case "alignBottom":
      align(c, "bottom");
      return;
    case "editText": {
      const selected = c.selectedElements();
      const only = selected[0];
      if (selected.length === 1 && only && !only.locked && c.canWrite(true)) {
        if (only.type === "task") c.callbacks.openTask?.(only.taskId);
        else if (only.type === "image") c.startCrop(only.id);
        else if (only.type !== "draw") context.editText?.(only.id);
      }
      return;
    }
    case "toggleMinimap":
      c.update((state) => ({ ...state, showMinimap: !state.showMinimap }));
      return;
    case "shapePicker":
      if (!c.canWrite()) return;
      c.update((state) => openDialog(state, "shapes"));
      return;
  }
}

// ----- flowchart quick add ---------------------------------------------------

const FLOW_GAP = 100;
const NODE_TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "shape",
  "sticky",
  "task",
]);

/**
 * Ctrl+Arrow: a copy of the selected shape beside it, joined by an arrow.
 * When something already sits there, the copy slides sideways to the
 * nearest free slot so repeated presses fan out.
 */
export function flowchartAdd(
  c: BoardController,
  direction: "up" | "down" | "left" | "right",
): boolean {
  if (!c.canWrite()) return false;
  const selected = c.selectedElements();
  const source = selected[0];
  if (selected.length !== 1 || !source || !NODE_TYPES.has(source.type))
    return false;
  const box = elementBox(source);
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  const step = horizontal ? box.width + FLOW_GAP : box.height + FLOW_GAP;
  const cross = horizontal
    ? box.height + FLOW_GAP / 2
    : box.width + FLOW_GAP / 2;
  const others = c.scene.elements
    .filter((element) => element.id !== source.id && element.type !== "frame")
    .map((element) => unionBounds([element]))
    .filter((other): other is NonNullable<typeof other> => other !== null);
  let candidate = { x: box.x, y: box.y };
  for (let attempt = 0; attempt < 12; attempt++) {
    // 0, +1, -1, +2, -2, ... slots across the direction of travel.
    const slot =
      attempt === 0 ? 0 : Math.ceil(attempt / 2) * (attempt % 2 ? 1 : -1);
    candidate = horizontal
      ? { x: box.x + sign * step, y: box.y + slot * cross }
      : { x: box.x + slot * cross, y: box.y + sign * step };
    const overlaps = others.some(
      (other) =>
        candidate.x < other.x + other.width &&
        candidate.x + box.width > other.x &&
        candidate.y < other.y + other.height &&
        candidate.y + box.height > other.y,
    );
    if (!overlaps) break;
  }
  // A task card's copy is a plain shape: a second card of the same task
  // would only duplicate it.
  const node =
    source.type === "task"
      ? c.newElement("rectangle", {
          x: candidate.x,
          y: candidate.y,
          width: box.width,
          height: box.height,
        })
      : ({
          ...(c.duplicate([source], {
            x: candidate.x - box.x,
            y: candidate.y - box.y,
          })[0] as BoardElement),
          text: "",
          groupIds: [],
        } as BoardElement);
  const style = c.state.style;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const end = {
    x: candidate.x + box.width / 2,
    y: candidate.y + box.height / 2,
  };
  const arrow = c.newElement("arrow", {
    x: start.x,
    y: start.y,
    points: [
      [0, 0],
      [end.x - start.x, end.y - start.y],
    ],
    routing: style.routing,
    startHead: "none",
    endHead: style.endHead === "none" ? "arrow" : style.endHead,
    startBinding: { elementId: source.id, focus: [0.5, 0.5], gap: 6 },
    endBinding: { elementId: node.id, focus: [0.5, 0.5], gap: 6 },
  });
  const routed =
    updateBoundLines(
      [...(c.scene.elements as BoardElement[]), node, arrow],
      [node.id],
    ).find((element) => element.id === arrow.id) ?? arrow;
  if (!c.insert([node, routed], { select: false })) return false;
  c.select([node.id]);
  // Keep the new node on screen.
  const { viewport, width, height } = c.state;
  const visible = visibleRect(viewport, width, height);
  if (
    candidate.x < visible.x ||
    candidate.y < visible.y ||
    candidate.x + box.width > visible.x + visible.width ||
    candidate.y + box.height > visible.y + visible.height
  ) {
    c.scrollToElement(node.id, false);
  }
  return true;
}
