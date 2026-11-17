// The URLs the file preview opens, and what a browser tab shows of a file
// by itself. Pure helpers: the dialog lives in components/file-preview and
// the renderers in @margaya/file-preview.

import { getApiUrl } from "@/fetchers/get-api-url";
import { imageDownloadUrl } from "@/lib/editor-image";

export type PreviewFile = {
  url: string;
  name: string;
  mimeType?: string;
  size?: number;
  /** Set by callers that already know (an editor image is an image). */
  kind?: "image";
};

export type PreviewKind = "image" | "pdf" | "text" | "audio" | "video" | "none";

// The types the API serves inline (apps/api/src/utils/asset-response.ts);
// SVG is missing on purpose: the API serves it as a download, and only the
// preview's sanitising renderer shows it.
const IMAGE_TYPES = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const AUDIO_TYPES = new Set([
  "audio/aac",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-wav",
]);
const VIDEO_TYPES = new Set([
  "video/mp4",
  "video/ogg",
  "video/quicktime",
  "video/webm",
]);
const TEXT_TYPES = new Set([
  "application/json",
  "application/x-ndjson",
  "application/x-sh",
  "application/x-yaml",
  "application/yaml",
  "application/javascript",
  "application/typescript",
  "application/sql",
  "application/toml",
]);
// Text a tab shows as text even without a type.
const TEXT_EXTENSIONS = new Set([
  "c",
  "cfg",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "diff",
  "env",
  "go",
  "h",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "log",
  "md",
  "mjs",
  "patch",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsv",
  "tsx",
  "txt",
  "yaml",
  "yml",
]);

const EXTENSION_TYPES: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4a: "audio/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  png: "image/png",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
};

function baseType(mimeType: string | undefined) {
  return (mimeType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
}

function extension(name: string) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

// Any other text/* type too.
function isTextType(type: string) {
  return TEXT_TYPES.has(type) || type.startsWith("text/");
}

/**
 * What a browser tab shows of `file` on its own, which decides whether
 * "Open in new tab" is offered. PDFs and text count on this server only (a
 * file elsewhere may need a session it doesn't have); "none" means a tab
 * would only download it.
 */
export function previewKind(
  file: PreviewFile,
  win: Window = window,
): PreviewKind {
  if (file.kind === "image") return "image";
  const ext = extension(file.name);
  // Older cards lost their type; the name still tells.
  const type = baseType(file.mimeType) || EXTENSION_TYPES[ext] || "";
  if (IMAGE_TYPES.has(type)) return "image";
  if (AUDIO_TYPES.has(type)) return "audio";
  if (VIDEO_TYPES.has(type)) return "video";
  const onServer = isServerFileUrl(file.url, win);
  if (type === "application/pdf") return onServer ? "pdf" : "none";
  if (type === "image/svg+xml" || type === "text/html") return "none";
  const untyped = !type || type === "application/octet-stream";
  if (isTextType(type) || (untyped && TEXT_EXTENSIONS.has(ext))) {
    return onServer ? "text" : "none";
  }
  return "none";
}

function apiOrigin(win: Window) {
  try {
    return new URL(getApiUrl(""), win.location.href).origin;
  } catch {
    return null;
  }
}

/**
 * The absolute URL of a file link, or null when it must not be opened:
 * only http(s), no user name or password. A relative `/api/...` path
 * (copied descriptions keep their own host, older content may not) goes to
 * the API; any other path to this page's origin.
 */
export function resolveFileUrl(
  raw: string | null | undefined,
  win: Window = window,
): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  // Protocol-relative and backslash tricks would leave the server.
  if (/^[/\\]{2}/.test(value) || value.includes("\\")) return null;
  let base = win.location.href;
  if (value.startsWith("/api/")) {
    const origin = apiOrigin(win);
    if (origin) base = origin;
  }
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  // A bare relative word ("file.pdf") is not a link anyone stored on purpose.
  if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) return null;
  return url.href;
}

/** True for a URL on this server: the web app's origin or the API's. */
export function isServerFileUrl(url: string, win: Window = window): boolean {
  try {
    const origin = new URL(url, win.location.href).origin;
    return origin === win.location.origin || origin === apiOrigin(win);
  } catch {
    return false;
  }
}

/** The link that downloads `url`: `download=1` on this server's assets. */
export function fileDownloadUrl(url: string): string {
  return imageDownloadUrl(url);
}

/** A file name from a URL's last path segment, else `fallback`. */
export function fileNameFromUrl(url: string, fallback: string): string {
  try {
    const last = new URL(url, window.location.href).pathname
      .split("/")
      .filter(Boolean)
      .pop();
    if (last && /\.[a-z0-9]{1,8}$/i.test(last)) return decodeURIComponent(last);
  } catch {
    // The fallback below.
  }
  return fallback;
}

/**
 * The files an editor shows, in document order: its images and file
 * cards, so the preview can step through them. `index` is `current`'s
 * place among them (0 when it isn't one).
 */
export function collectEditorFiles(
  root: Element,
  current?: Element | null,
  imageName = "image",
): { files: PreviewFile[]; index: number } {
  const files: PreviewFile[] = [];
  let index = 0;
  for (const element of root.querySelectorAll(
    "img.margaya-editor-image, [data-file-preview-url]",
  )) {
    let file: PreviewFile | null = null;
    if (element instanceof HTMLImageElement) {
      const url = resolveFileUrl(element.currentSrc || element.src);
      if (url) {
        file = {
          url,
          name: fileNameFromUrl(url, element.alt || imageName),
          kind: "image",
        };
      }
    } else {
      const data = (element as HTMLElement).dataset;
      const url = resolveFileUrl(data.filePreviewUrl);
      if (url) {
        file = {
          url,
          name: data.filePreviewName || fileNameFromUrl(url, "file"),
          mimeType: data.filePreviewType || undefined,
          size: Number(data.filePreviewSize) || undefined,
        };
      }
    }
    if (!file) continue;
    if (current && (element === current || element.contains(current))) {
      index = files.length;
    }
    files.push(file);
  }
  return { files, index };
}
