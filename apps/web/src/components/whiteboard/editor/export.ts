import {
  type BackgroundPattern,
  type BoardElement,
  embedInPng,
  extractFromPng,
  parseBoardFile,
  RenderCache,
  renderScene,
  renderToSvg,
  serializeBoard,
} from "@margaya/whiteboard";
import { placeElements, rehomeImages } from "./commands";
import { type BoardController, hasPattern, unionBounds } from "./controller";
import { measureText } from "./measure";
import type { ExportImageOptions } from "./types";

// Export and import through the editor handle. Images are fetched as blobs
// (with the session cookie) so the export canvas is never tainted and the SVG
// embeds them as data URLs that work outside the app.

const PADDING = 24;
/** Browsers refuse canvases much larger than this per side. */
const MAX_CANVAS_SIDE = 16_384;

function exportElements(
  c: BoardController,
  options: ExportImageOptions,
): BoardElement[] {
  const all = c.scene.elements as BoardElement[];
  if (!options.selectionOnly) return all;
  const ids = new Set(c.state.selectedIds);
  // Selected frames bring their children.
  for (const element of all) {
    if (element.frameId && ids.has(element.frameId)) ids.add(element.id);
  }
  const selected = all.filter((element) => ids.has(element.id));
  return selected.length > 0 ? selected : all;
}

/**
 * The pattern an export draws, or "plain". PNG includes it unless told not
 * to, SVG only when asked; a transparent export never has one.
 */
export function exportPattern(
  c: BoardController,
  options: ExportImageOptions,
  format: "png" | "svg",
): { pattern: BackgroundPattern; patternSize: number } {
  const settings = c.settings;
  const wanted = options.pattern ?? format === "png";
  const draw = wanted && options.background !== false && hasPattern(settings);
  return {
    pattern: draw ? settings.pattern : "plain",
    patternSize: settings.patternSize,
  };
}

async function loadBlobImage(url: string): Promise<{
  image: HTMLImageElement | null;
  dataUrl: string | null;
}> {
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) return { image: null, dataUrl: null };
    const blob = await response.blob();
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    if (!dataUrl) return { image: null, dataUrl: null };
    const image = new Image();
    await new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
      image.src = dataUrl;
    });
    return {
      image: image.complete && image.naturalWidth > 0 ? image : null,
      dataUrl,
    };
  } catch {
    return { image: null, dataUrl: null };
  }
}

async function loadAssets(
  c: BoardController,
  elements: readonly BoardElement[],
) {
  const ids = new Set<string>();
  for (const element of elements) {
    if (element.type === "image" && element.assetId) ids.add(element.assetId);
  }
  const entries = await Promise.all(
    [...ids].map(
      async (assetId) =>
        [assetId, await loadBlobImage(c.options.imageUrl(assetId))] as const,
    ),
  );
  return new Map(entries);
}

export async function exportPng(
  c: BoardController,
  options: ExportImageOptions = {},
): Promise<Blob> {
  const elements = exportElements(c, options);
  const scale = Math.min(3, Math.max(1, Math.round(options.scale ?? 2)));
  const box = unionBounds(elements) ?? { x: 0, y: 0, width: 320, height: 200 };
  const width = Math.ceil(box.width + PADDING * 2);
  const height = Math.ceil(box.height + PADDING * 2);
  const ratio = Math.min(scale, MAX_CANVAS_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * ratio));
  canvas.height = Math.max(1, Math.floor(height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  const assets = await loadAssets(c, elements);
  renderScene(ctx, elements, {
    viewport: { scrollX: PADDING - box.x, scrollY: PADDING - box.y, zoom: 1 },
    width,
    height,
    pixelRatio: ratio,
    theme: options.theme ?? "light",
    background:
      options.background === false ? "transparent" : c.settings.background,
    gridSize: 0,
    ...exportPattern(c, options, "png"),
    measureText,
    cache: new RenderCache(),
    resolveImage: (assetId) => assets.get(assetId)?.image ?? null,
    resolveTask: (taskId) => c.getTaskCard(taskId),
    frameTitle: c.options.frameTitle,
  });
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((result) => resolve(result), "image/png"),
  );
  if (!blob) throw new Error("PNG export failed");
  if (!options.embedScene) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const embedded = embedInPng(
    bytes,
    serializeBoard(elements, c.settings, pictures(assets)),
  );
  return new Blob([embedded as BlobPart], { type: "image/png" });
}

export async function exportSvg(
  c: BoardController,
  options: ExportImageOptions = {},
): Promise<string> {
  const elements = exportElements(c, options);
  const assets = await loadAssets(c, elements);
  return renderToSvg(elements, {
    background:
      options.background === false ? "transparent" : c.settings.background,
    padding: PADDING,
    ...exportPattern(c, options, "svg"),
    theme: options.theme ?? "light",
    resolveTask: (taskId) => c.getTaskCard(taskId),
    imageHref: (assetId) => assets.get(assetId)?.dataUrl ?? null,
    frameTitle: c.options.frameTitle,
    measureText,
  });
}

/** The pictures that loaded, by asset id, for a board file. */
function pictures(
  assets: Map<string, { dataUrl: string | null }>,
): Record<string, string> {
  const images: Record<string, string> = {};
  for (const [assetId, asset] of assets) {
    if (asset.dataUrl) images[assetId] = asset.dataUrl;
  }
  return images;
}

/** The board file, with its pictures so another board can show them. */
export async function exportFile(c: BoardController): Promise<string> {
  const elements = c.scene.elements as BoardElement[];
  const assets = await loadAssets(c, elements);
  return serializeBoard(elements, c.settings, pictures(assets));
}

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/** Reads a board file or a PNG with an embedded board. */
export async function readBoardFile(file: File): Promise<{
  elements: BoardElement[];
  images: Record<string, string>;
} | null> {
  if (file.size > MAX_IMPORT_BYTES) return null;
  const isPng = file.type === "image/png" || /\.png$/i.test(file.name);
  let text: string | null;
  if (isPng) {
    text = extractFromPng(new Uint8Array(await file.arrayBuffer()));
  } else {
    text = await file.text();
  }
  if (!text) return null;
  const parsed = parseBoardFile(text);
  if (!parsed) return null;
  return {
    elements: parsed.elements.filter((element) => !element.deleted),
    images: parsed.images,
  };
}

/**
 * Adds the file's elements to the board, centred in view. `quiet` leaves
 * the confirmation and the "not a board" message to the caller (the board
 * menu), so an import never reports twice.
 */
export async function importFile(
  c: BoardController,
  file: File,
  at?: { x: number; y: number } | null,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<void> {
  if (!c.canWrite()) throw new Error("read-only");
  const board = await readBoardFile(file);
  if (!board || board.elements.length === 0) {
    if (!quiet) c.callbacks.notice?.("importFailed");
    throw new Error("Not a board file");
  }
  if (!(await placeImported(c, board, at, { quiet })))
    throw new Error("Import failed");
}

/** Places a board file's elements, its pictures uploaded here, and confirms it. */
export async function placeImported(
  c: BoardController,
  board: { elements: BoardElement[]; images: Record<string, string> },
  at?: { x: number; y: number } | null,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<boolean> {
  const elements = await rehomeImages(c, board.elements, {
    images: board.images,
  });
  if (!placeElements(c, elements, at)) return false;
  if (!quiet) c.callbacks.notice?.("imported");
  return true;
}

/** Whether a dropped file looks like a board (not just any image). */
export function isBoardFile(file: File): boolean {
  return (
    /\.margaya-board$/i.test(file.name) || file.type === "application/json"
  );
}
