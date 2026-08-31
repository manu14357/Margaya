import type { JSONContent, MarkdownTokenizer } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { escapeHtml, readTagAttributes } from "./escape.js";

// The image node with a display width (a percentage of the text column, so
// it holds on any screen and in print) and an alignment. Markdown keeps the
// plain `![alt](src)` form until one of them is set; then it writes an
// `<img>` tag, which GitHub and most markdown readers also display.

export const IMAGE_ALIGNMENTS = ["left", "center", "right"] as const;

export type ImageAlign = (typeof IMAGE_ALIGNMENTS)[number];

export const IMAGE_MIN_WIDTH = 10;
export const IMAGE_MAX_WIDTH = 100;

/** A whole percentage from 10 to 100, or null (the image's natural size). */
export function imageWidth(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\s*\d+(?:\.\d+)?\s*%?\s*$/.test(value)
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  return rounded >= IMAGE_MIN_WIDTH && rounded <= IMAGE_MAX_WIDTH
    ? rounded
    : null;
}

/** An HTML width attribute: only a percentage counts (pixel widths don't). */
function percentWidth(value: string | null | undefined): number | null {
  return value && /%\s*$/.test(value) ? imageWidth(value) : null;
}

export function imageAlign(value: unknown): ImageAlign | null {
  return IMAGE_ALIGNMENTS.includes(value as ImageAlign)
    ? (value as ImageAlign)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The node an `<img>` tag reads back as: its allowlisted attributes only. */
export function imageFromTagAttributes(
  attributes: Record<string, string>,
): JSONContent | null {
  const src = attributes.src ?? "";
  if (!src || /^\s*data:/i.test(src)) return null;
  return {
    type: "image",
    attrs: {
      src,
      alt: attributes.alt ?? null,
      title: attributes.title ?? null,
      width: percentWidth(attributes.width),
      align: imageAlign(attributes["data-align"]),
    },
  };
}

const IMAGE_TAG_TOKEN = "margayaImageTag";
const IMAGE_TAG =
  /^ {0,3}<img((?:\s+[a-zA-Z][\w-]*="[^"]*")*)\s*\/?>[ \t]*(?:\n|$)/i;

/** An `<img>` tag alone on its line (how a sized or aligned image is written). */
export const imageTagTokenizer: MarkdownTokenizer = {
  name: IMAGE_TAG_TOKEN,
  level: "block",
  start: () => -1,
  tokenize: (src) => {
    const match = IMAGE_TAG.exec(src);
    if (!match) return undefined;
    const node = imageFromTagAttributes(readTagAttributes(match[1] ?? ""));
    if (!node) return undefined;
    return { type: IMAGE_TAG_TOKEN, raw: match[0], node };
  },
};

/** Reads image tags without a DOM, on the server and in the browser alike. */
export const ImageTags = Extension.create({
  name: "margayaImageTags",
  markdownTokenName: IMAGE_TAG_TOKEN,
  markdownTokenizer: imageTagTokenizer,
  parseMarkdown: (token) => token.node as JSONContent,
});

/** The markdown for an image node: `![alt](src)` or an `<img>` tag. */
export function imageMarkdown(attrs: Record<string, unknown> | undefined) {
  const src = text(attrs?.src);
  const alt = text(attrs?.alt);
  const title = text(attrs?.title);
  const width = imageWidth(attrs?.width);
  const align = imageAlign(attrs?.align);
  if (width === null && align === null) {
    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  }
  const parts = [`src="${escapeHtml(src)}"`, `alt="${escapeHtml(alt)}"`];
  if (title) parts.push(`title="${escapeHtml(title)}"`);
  if (width !== null) parts.push(`width="${width}%"`);
  if (align !== null) parts.push(`data-align="${align}"`);
  return `<img ${parts.join(" ")} />`;
}

export const MargayaImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          percentWidth(element.getAttribute("width")),
        renderHTML: (attributes: Record<string, unknown>) => {
          const width = imageWidth(attributes.width);
          return width === null ? {} : { width: `${width}%` };
        },
      },
      align: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          imageAlign(element.getAttribute("data-align")),
        renderHTML: (attributes: Record<string, unknown>) => {
          const align = imageAlign(attributes.align);
          return align === null ? {} : { "data-align": align };
        },
      },
    };
  },

  renderMarkdown: (node) => imageMarkdown(node.attrs),

  addExtensions() {
    return [ImageTags];
  },
});
