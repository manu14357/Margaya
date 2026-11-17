import { type ComponentType, type LazyExoticComponent, lazy } from "react";
import type { FileKind } from "./detect";
import type { RendererProps } from "./types";

type RendererModule = { default: ComponentType<RendererProps> };

export type PreviewRendererEntry = {
  /** Starts downloading the renderer's code; safe to call repeatedly. */
  preload: () => Promise<RendererModule>;
  Component: LazyExoticComponent<ComponentType<RendererProps>>;
};

function entry(load: () => Promise<RendererModule>): PreviewRendererEntry {
  let pending: Promise<RendererModule> | null = null;
  const preload = () => {
    pending ??= load().catch((error: unknown) => {
      // A failed chunk (offline, a new deployment) may be retried.
      pending = null;
      throw error;
    });
    return pending;
  };
  return { preload, Component: lazy(preload) };
}

const spreadsheet = entry(() => import("./renderers/spreadsheet"));
const media = entry(() => import("./renderers/media"));

/**
 * Which renderer shows each kind. Each is its own chunk, so a library such
 * as the PDF reader or the 3D engine downloads only when its first file opens.
 * `unknown` has none: those files get the file card.
 */
export const PreviewRendererRegistry: Readonly<
  Partial<Record<FileKind, PreviewRendererEntry>>
> = {
  pdf: entry(() => import("./renderers/pdf")),
  word: entry(() => import("./renderers/word")),
  spreadsheet,
  csv: spreadsheet,
  presentation: entry(() => import("./renderers/presentation")),
  image: entry(() => import("./renderers/image")),
  svg: entry(() => import("./renderers/svg")),
  markdown: entry(() => import("./renderers/markdown")),
  text: entry(() => import("./renderers/text")),
  code: entry(() => import("./renderers/code")),
  html: entry(() => import("./renderers/html")),
  video: media,
  audio: media,
  archive: entry(() => import("./renderers/archive")),
  model3d: entry(() => import("./renderers/model3d")),
};

export function getPreviewRenderer(
  kind: FileKind,
): PreviewRendererEntry | null {
  return PreviewRendererRegistry[kind] ?? null;
}

/**
 * How a kind gets its file: "url" kinds play or show straight from the
 * address (the browser streams them); "bytes" kinds are read and parsed.
 */
export function deliveryOf(kind: FileKind): "url" | "bytes" | "none" {
  switch (kind) {
    case "image":
    case "video":
    case "audio":
      return "url";
    case "unknown":
      return "none";
    default:
      return "bytes";
  }
}
