// Standalone SVG output for previews and exports, safe to serve as an image:
// every string is escaped, colours are re-formatted after parsing, there are
// no scripts, event attributes, `foreignObject` or links, and the only hrefs
// are image sources the caller hands in (and those must look like images).

import type {
  BackgroundPattern,
  BoardElement,
  FrameElement,
} from "../elements.js";
import { compareRenderOrder, patternSpacing } from "./canvas.js";
import { isTransparentColor, themeColor } from "./color.js";
import {
  buildElementDrawing,
  type DrawItem,
  elementSceneBounds,
  frameClipPolygon,
  type ImageItem,
  imagePlaceholder,
  type PathItem,
  type TextItem,
  textAnchorX,
  textBaseline,
} from "./shapes.js";
import { pathOpsToSvg } from "./sketch.js";
import { estimateTextWidth } from "./text.js";
import type { MeasureText, RenderTheme, TaskCardData } from "./types.js";

export type SvgRenderOptions = {
  /** Canvas colour; defaults to white. `transparent` omits the backdrop. */
  background?: string;
  /** Space around the drawing in board units (default 16). */
  padding?: number;
  theme?: RenderTheme;
  resolveTask?: (taskId: string) => TaskCardData | null;
  /** URL of an uploaded image, or null to draw the placeholder. */
  imageHref?: (assetId: string) => string | null;
  measureText?: MeasureText;
  /** Title of frames without a name, in the viewer's language. */
  frameTitle?: string;
  /** Background pattern behind the drawing; default "plain" (none). */
  pattern?: BackgroundPattern;
  /** Pattern spacing in board units (default 24). */
  patternSize?: number;
};

const SVG_NS = "http://www.w3.org/2000/svg";
/** Whether XML 1.0 allows this code point in a document. */
function isXmlChar(code: number): boolean {
  if (code === 0x9 || code === 0xa || code === 0xd) return true;
  if (code < 0x20) return false;
  // Lone surrogate halves and the two non-characters are not allowed.
  if (code >= 0xd800 && code <= 0xdfff) return false;
  return code !== 0xfffe && code !== 0xffff;
}

function stripInvalidXml(value: string): string {
  let out = "";
  for (const char of value) {
    if (isXmlChar(char.codePointAt(0) ?? 0)) out += char;
  }
  return out;
}

/** Escapes text for XML content and double- or single-quoted attributes. */
export function escapeXml(value: string): string {
  return stripInvalidXml(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function num(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/]+=*$/i;
const PATH_IMAGE = /^\/(?!\/)[a-z0-9\-._~/%?&=+:@]*$/i;
const WEB_IMAGE = /^https?:\/\/[a-z0-9\-._~/%?&=+:@[\]!$,;]+$/i;

/**
 * Accepts the image hrefs a caller may hand in: inline raster data, a
 * same-origin path, or an http(s) URL. Anything else (scripts, SVG data,
 * protocol-relative URLs) is dropped and the placeholder is drawn instead.
 */
export function safeImageHref(href: string | null | undefined): string | null {
  if (typeof href !== "string") return null;
  const value = href.trim();
  if (value.length === 0 || value.length > 16 * 1024 * 1024) return null;
  if (
    DATA_IMAGE.test(value) ||
    PATH_IMAGE.test(value) ||
    WEB_IMAGE.test(value)
  ) {
    return value;
  }
  return null;
}

type SvgState = {
  defs: string[];
  blurIds: Map<number, string>;
  clipIds: Map<string, string>;
  options: SvgRenderOptions;
  theme: RenderTheme;
};

function blurFilter(state: SvgState, blur: number): string {
  const key = Math.max(0, Math.round(blur));
  let id = state.blurIds.get(key);
  if (!id) {
    id = `wb-blur-${state.blurIds.size}`;
    state.blurIds.set(key, id);
    state.defs.push(
      `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${num(key / 2)}"/></filter>`,
    );
  }
  return id;
}

function frameClip(state: SvgState, frame: FrameElement): string {
  let id = state.clipIds.get(frame.id);
  if (!id) {
    id = `wb-clip-${state.clipIds.size}`;
    state.clipIds.set(frame.id, id);
    const points = frameClipPolygon(frame)
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${num(point[0])} ${num(point[1])}`,
      )
      .join("");
    state.defs.push(`<clipPath id="${id}"><path d="${points}Z"/></clipPath>`);
  }
  return id;
}

function pathMarkup(state: SvgState, item: PathItem): string {
  const d = pathOpsToSvg(item.ops);
  if (!d) return "";
  const parts: string[] = [];
  const hasFill = item.fill !== undefined && !isTransparentColor(item.fill);
  const hasStroke =
    item.stroke !== undefined &&
    !isTransparentColor(item.stroke) &&
    (item.lineWidth ?? 1) > 0;
  if (hasFill && item.shadow) {
    const filter = blurFilter(state, item.shadow.blur);
    parts.push(
      `<path d="${d}" transform="translate(${num(item.shadow.offsetX)} ${num(item.shadow.offsetY)})" fill="${escapeXml(themeColor(item.shadow.color, "light", "#000000"))}" filter="url(#${filter})"/>`,
    );
  }
  const attributes = [`d="${d}"`];
  attributes.push(
    `fill="${hasFill ? escapeXml(themeColor(item.fill, "light", "#000000")) : "none"}"`,
  );
  if (hasStroke) {
    attributes.push(
      `stroke="${escapeXml(themeColor(item.stroke, "light", "#000000"))}"`,
      `stroke-width="${num(item.lineWidth ?? 1)}"`,
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
    );
    if (item.dash?.length) {
      attributes.push(`stroke-dasharray="${item.dash.map(num).join(" ")}"`);
    }
  }
  if (!hasFill && !hasStroke) return parts.join("");
  if (item.alpha !== undefined) {
    const alpha = Number.isFinite(item.alpha)
      ? Math.min(1, Math.max(0, item.alpha))
      : 1;
    attributes.push(`opacity="${num(alpha)}"`);
  }
  if (item.blend === "multiply" || item.blend === "screen") {
    attributes.push(`style="mix-blend-mode:${item.blend}"`);
  }
  parts.push(`<path ${attributes.join(" ")}/>`);
  return parts.join("");
}

function textMarkup(item: TextItem): string {
  const anchor =
    item.align === "center"
      ? "middle"
      : item.align === "right"
        ? "end"
        : "start";
  const x = num(textAnchorX(item));
  const shared = [
    `font-family="${escapeXml(item.fontFamily)}"`,
    `font-size="${num(item.fontSize)}"`,
    item.fontWeight ? `font-weight="${num(item.fontWeight)}"` : "",
    `fill="${escapeXml(themeColor(item.color, "light", "#000000"))}"`,
    `text-anchor="${anchor}"`,
  ]
    .filter(Boolean)
    .join(" ");
  return item.lines
    .map((line, index) =>
      line
        ? `<text x="${x}" y="${num(textBaseline(item, index))}" ${shared} xml:space="preserve">${escapeXml(line)}</text>`
        : "",
    )
    .join("");
}

function imageMarkup(state: SvgState, item: ImageItem): string {
  const href = item.assetId
    ? safeImageHref(state.options.imageHref?.(item.assetId))
    : null;
  if (!href || item.width <= 0 || item.height <= 0) {
    return imagePlaceholder(item.width, item.height, state.theme)
      .map((part) => pathMarkup(state, part))
      .join("");
  }
  const safeHref = escapeXml(href);
  if (item.crop) {
    // The nested viewport maps crop pixels onto the element box; the image
    // keeps its intrinsic size so crop coordinates are image pixels.
    return `<svg x="${num(item.x)}" y="${num(item.y)}" width="${num(item.width)}" height="${num(item.height)}" viewBox="${num(item.crop.x)} ${num(item.crop.y)} ${num(item.crop.width)} ${num(item.crop.height)}" preserveAspectRatio="none" overflow="hidden"><image href="${safeHref}"/></svg>`;
  }
  return `<image href="${safeHref}" x="${num(item.x)}" y="${num(item.y)}" width="${num(item.width)}" height="${num(item.height)}" preserveAspectRatio="none"/>`;
}

function itemsMarkup(state: SvgState, items: readonly DrawItem[]): string {
  let out = "";
  for (const item of items) {
    if (item.kind === "path") out += pathMarkup(state, item);
    else if (item.kind === "text") out += textMarkup(item);
    else out += imageMarkup(state, item);
  }
  return out;
}

/**
 * A pattern fill for the backdrop, tiled on board coordinates. Tiles start
 * half a step before the origin so marks land on multiples of the spacing.
 */
function patternMarkup(
  state: SvgState,
  pattern: BackgroundPattern | undefined,
  size: number,
): string[] {
  if (pattern !== "dots" && pattern !== "grid" && pattern !== "lines") {
    return [];
  }
  const dark = state.theme === "dark";
  const ink = (alpha: number) =>
    dark
      ? `rgba(255, 255, 255, ${num(alpha)})`
      : `rgba(0, 0, 0, ${num(alpha)})`;
  const half = num(size / 2);
  const tile = (id: string, step: number, content: string) =>
    `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${num(-step / 2)}" y="${num(-step / 2)}" width="${num(step)}" height="${num(step)}">${content}</pattern>`;
  if (pattern === "dots") {
    state.defs.push(
      tile(
        "wb-pattern",
        size,
        `<circle cx="${half}" cy="${half}" r="1" fill="${ink(dark ? 0.2 : 0.24)}"/>`,
      ),
    );
    return ["url(#wb-pattern)"];
  }
  const line = (step: number, alpha: number, vertical: boolean) => {
    const middle = num(step / 2);
    const across = `M0 ${middle}H${num(step)}`;
    const down = vertical ? `M${middle} 0V${num(step)}` : "";
    return `<path d="${across}${down}" stroke="${ink(alpha)}" stroke-width="1" fill="none"/>`;
  };
  if (pattern === "lines") {
    state.defs.push(tile("wb-pattern", size, line(size, 0.11, false)));
    return ["url(#wb-pattern)"];
  }
  const major = size * 5;
  state.defs.push(tile("wb-pattern-minor", size, line(size, 0.07, true)));
  state.defs.push(tile("wb-pattern", major, line(major, 0.13, true)));
  return ["url(#wb-pattern-minor)", "url(#wb-pattern)"];
}

/** Renders the live elements as a standalone SVG document string. */
export function renderToSvg(
  elements: readonly BoardElement[],
  options: SvgRenderOptions = {},
): string {
  const theme: RenderTheme = options.theme === "dark" ? "dark" : "light";
  const measure = options.measureText ?? estimateTextWidth;
  const padding = Math.max(
    0,
    Math.min(
      1000,
      Number.isFinite(options.padding) ? (options.padding as number) : 16,
    ),
  );
  const background = themeColor(
    options.background ?? "#ffffff",
    theme,
    "#ffffff",
  );
  const live = elements.filter((el) => !el.deleted).sort(compareRenderOrder);
  const frames = new Map<string, FrameElement>();
  for (const el of live) if (el.type === "frame") frames.set(el.id, el);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const el of live) {
    const box = elementSceneBounds(el);
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) continue;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  const left = minX - padding;
  const top = minY - padding;
  const width = Math.max(1, Math.ceil(maxX - minX + padding * 2));
  const height = Math.max(1, Math.ceil(maxY - minY + padding * 2));

  const state: SvgState = {
    defs: [],
    blurIds: new Map(),
    clipIds: new Map(),
    options,
    theme,
  };
  const body: string[] = [];
  for (const el of live) {
    const task =
      el.type === "task"
        ? (options.resolveTask?.(el.taskId) ?? null)
        : undefined;
    const drawing = buildElementDrawing(el, {
      theme,
      measure,
      background,
      task,
      frameTitle: options.frameTitle,
    });
    if (drawing.items.length === 0) continue;
    const content = itemsMarkup(state, drawing.items);
    if (!content) continue;
    const x = Number.isFinite(el.x) ? el.x : 0;
    const y = Number.isFinite(el.y) ? el.y : 0;
    const angle = Number.isFinite(el.angle) ? el.angle : 0;
    let transform = `translate(${num(x)} ${num(y)})`;
    if (angle !== 0) {
      transform += ` rotate(${num((angle * 180) / Math.PI)} ${num(drawing.pivotX)} ${num(drawing.pivotY)})`;
    }
    const opacity =
      Math.min(
        100,
        Math.max(0, Number.isFinite(el.opacity) ? el.opacity : 100),
      ) / 100;
    const opacityAttr = opacity < 1 ? ` opacity="${num(opacity)}"` : "";
    let group = `<g transform="${transform}"${opacityAttr}>${content}</g>`;
    const frame =
      el.frameId && el.frameId !== el.id ? frames.get(el.frameId) : undefined;
    if (frame)
      group = `<g clip-path="url(#${frameClip(state, frame)})">${group}</g>`;
    body.push(group);
  }

  const rect = `x="${num(left)}" y="${num(top)}" width="${width}" height="${height}"`;
  let backdrop = isTransparentColor(background)
    ? ""
    : `<rect ${rect} fill="${escapeXml(background)}"/>`;
  for (const fill of patternMarkup(
    state,
    options.pattern,
    patternSpacing(options.patternSize),
  )) {
    backdrop += `<rect ${rect} fill="${fill}"/>`;
  }
  const defs = state.defs.length ? `<defs>${state.defs.join("")}</defs>` : "";
  return `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="${num(left)} ${num(top)} ${width} ${height}">${defs}${backdrop}${body.join("")}</svg>`;
}
