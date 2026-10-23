import fs from "node:fs";
import path from "node:path";
import { escapeHtml } from "./highlight";

// Product screenshots on docs pages. scripts/docs-shots/capture.mjs writes
// public/images/docs/<name>-light.webp plus a manifest with each shot's size
// in CSS pixels (the files are captured at twice that), which the page uses
// for width and height so nothing shifts while the image loads. Shots are
// light mode only, by product decision: the dark site shows them too.

export type DocsShot = {
  width: number;
  height: number;
  /** File extension, without the dot: webp, or png when sharp was missing. */
  format?: string;
};

export type DocsShotManifest = Record<string, DocsShot>;

export const DOCS_SHOTS_URL = "/images/docs";

function manifestFile(): string {
  return path.join(process.cwd(), "public", "images", "docs", "manifest.json");
}

let cached: { mtime: number; manifest: DocsShotManifest } | null = null;

/** The screenshot manifest, re-read when the file changes (for `next dev`). */
export function readDocsShotManifest(): DocsShotManifest {
  const file = manifestFile();
  let mtime: number;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return {};
  }
  if (cached?.mtime !== mtime) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      shots?: DocsShotManifest;
    };
    cached = { mtime, manifest: parsed.shots ?? {} };
  }
  return cached.manifest;
}

export function docsShotUrl(
  name: string,
  shot: Pick<DocsShot, "format">,
): string {
  return `${DOCS_SHOTS_URL}/${name}-light.${shot.format ?? "webp"}`;
}

/**
 * Looks a screenshot up, throwing for an unknown name so a typo in `src`
 * fails the site build instead of shipping a broken image.
 */
export function requireDocsShot(
  name: string | undefined,
  source: string,
  manifest: DocsShotManifest = readDocsShotManifest(),
): DocsShot {
  const shot = name ? manifest[name] : undefined;
  if (!name || !shot) {
    throw new Error(
      `[docs] ${source}: <Screenshot src="${name ?? ""}"> is not in public/images/docs/manifest.json. Capture it with \`node apps/site/scripts/docs-shots/capture.mjs <section> ${name ?? "<name>"}\`, or fix the name.`,
    );
  }
  return shot;
}

/**
 * The figure for `<Screenshot src alt caption />`: the image inside a button
 * that opens the zoom dialog, and an optional caption.
 */
export function screenshotHtml(
  attributes: Record<string, string>,
  source: string,
  manifest?: DocsShotManifest,
): string {
  const name = attributes.src;
  let shot: DocsShot;
  try {
    shot = requireDocsShot(name, source, manifest);
  } catch (error) {
    // `next dev` keeps the page usable while a shot is still being captured;
    // builds and tests fail on the same error.
    if (process.env.NODE_ENV !== "development") throw error;
    console.error((error as Error).message);
    return `<p class="docs-shot-missing" role="alert">Missing screenshot: ${escapeHtml(name ?? "")}</p>`;
  }
  const alt = escapeHtml(attributes.alt ?? "");
  const image = `<img class="docs-shot-img" src="${escapeHtml(docsShotUrl(name as string, shot))}" alt="${alt}" width="${shot.width}" height="${shot.height}" loading="lazy" decoding="async" />`;
  const caption = attributes.caption
    ? `<figcaption>${escapeHtml(attributes.caption)}</figcaption>`
    : "";
  // The figure is only as wide as the capture, so small crops stay sharp.
  return `<figure class="docs-shot" style="--shot-w:${shot.width}px"><button type="button" class="docs-shot-zoom" aria-label="Enlarge image${alt ? `: ${alt}` : ""}">${image}</button>${caption}</figure>`;
}
