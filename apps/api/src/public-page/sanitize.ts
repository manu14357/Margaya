import type { PageDocument } from "@margaya/editor-schema";

// What a public page shows (spec: no private data). The document is rebuilt
// from an allowlist of nodes, marks and attributes, so anything new in the
// editor stays hidden until it is added here. People, task and page links and
// file cards become a `redacted` placeholder the web renders in the reader's
// language; a link to another page survives only when that page is published
// too. Images keep their place only when they are the page's own uploads
// (served through the public link) or plain web images.

type Node = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  text?: string;
};

export type RedactedKind = "mention" | "task" | "page" | "attachment";

export type PublicPageLinks = {
  /** Asset ids this page may serve publicly, mapped to their public URL. */
  assetUrl: (assetId: string) => string | null;
  /** The public token of a linked page, when that page is published. */
  publishedPage: (pageId: string) => { token: string; title: string } | null;
};

const PLAIN_NODES = new Set([
  "doc",
  "paragraph",
  "blockquote",
  "bulletList",
  "listItem",
  "taskList",
  "horizontalRule",
  "hardBreak",
  "table",
  "tableRow",
]);

const ASSET_URL = /\/asset\/([A-Za-z0-9_-]+)(?:[?#].*)?$/;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function webUrl(value: unknown): string | null {
  const raw = str(value).trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function safeHref(value: unknown): string | null {
  const raw = str(value).trim();
  if (/^mailto:/i.test(raw)) return raw;
  return webUrl(raw);
}

function marksOf(node: Node): Node["marks"] {
  const marks: NonNullable<Node["marks"]> = [];
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
      case "italic":
      case "strike":
      case "code":
      case "underline":
        marks.push({ type: mark.type });
        break;
      case "link": {
        const href = safeHref(mark.attrs?.href);
        if (href) marks.push({ type: "link", attrs: { href } });
        break;
      }
    }
  }
  return marks.length > 0 ? marks : undefined;
}

function redacted(kind: RedactedKind): Node {
  return { type: "redacted", attrs: { kind } };
}

function cellAttrs(attrs: Record<string, unknown> | undefined) {
  const span = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) && value > 0
      ? Math.min(value, 50)
      : 1;
  const widths = Array.isArray(attrs?.colwidth)
    ? attrs.colwidth.filter(
        (width): width is number => typeof width === "number",
      )
    : null;
  return {
    colspan: span(attrs?.colspan),
    rowspan: span(attrs?.rowspan),
    colwidth: widths && widths.length > 0 ? widths : null,
  };
}

function children(node: Node, links: PublicPageLinks): Node[] | undefined {
  if (!Array.isArray(node.content)) return undefined;
  const out: Node[] = [];
  for (const child of node.content) {
    const clean = sanitizeNode(child, links);
    if (clean) out.push(clean);
  }
  return out;
}

function withContent(base: Node, node: Node, links: PublicPageLinks): Node {
  const content = children(node, links);
  return content ? { ...base, content } : base;
}

function sanitizeNode(node: Node, links: PublicPageLinks): Node | null {
  if (!node || typeof node !== "object") return null;
  const type = node.type ?? "";
  const attrs = node.attrs ?? {};

  if (PLAIN_NODES.has(type)) return withContent({ type }, node, links);

  switch (type) {
    case "text": {
      const text = str(node.text);
      if (!text) return null;
      const marks = marksOf(node);
      return marks ? { type, text, marks } : { type, text };
    }
    case "heading": {
      const level = [1, 2, 3].includes(attrs.level as number)
        ? (attrs.level as number)
        : 1;
      return withContent({ type, attrs: { level } }, node, links);
    }
    case "orderedList": {
      const start =
        typeof attrs.start === "number" && Number.isInteger(attrs.start)
          ? attrs.start
          : 1;
      return withContent({ type, attrs: { start } }, node, links);
    }
    case "taskItem":
      return withContent(
        { type, attrs: { checked: attrs.checked === true } },
        node,
        links,
      );
    case "codeBlock": {
      const language = str(attrs.language).slice(0, 40) || null;
      return withContent({ type, attrs: { language } }, node, links);
    }
    case "callout":
      return withContent(
        { type, attrs: { variant: str(attrs.variant) || "info" } },
        node,
        links,
      );
    case "tableCell":
    case "tableHeader":
      return withContent({ type, attrs: cellAttrs(attrs) }, node, links);
    case "image": {
      const raw = str(attrs.src);
      const asset = ASSET_URL.exec(raw);
      const src = asset?.[1] ? links.assetUrl(asset[1]) : webUrl(raw);
      if (!src) return null;
      return {
        type,
        attrs: {
          src,
          alt: str(attrs.alt) || null,
          title: str(attrs.title) || null,
          width: typeof attrs.width === "number" ? attrs.width : null,
          align: str(attrs.align) || null,
        },
      };
    }
    case "embedBlock": {
      const url = webUrl(attrs.url);
      if (!url) return null;
      return {
        type,
        attrs: { url, mode: attrs.mode === "link" ? "link" : "embed" },
      };
    }
    case "margayaMention":
      return redacted("mention");
    case "margayaIssueLink":
      return redacted("task");
    case "attachmentCard":
      return redacted("attachment");
    case "margayaPageLink": {
      const target = links.publishedPage(str(attrs.pageId));
      return target
        ? { type: "redacted", attrs: { kind: "page", ...target } }
        : redacted("page");
    }
    default:
      return null;
  }
}

/** The public copy of a page document. */
export function sanitizePublicDocument(
  doc: PageDocument,
  links: PublicPageLinks,
): Node {
  return sanitizeNode(doc as Node, links) ?? { type: "doc", content: [] };
}

/** Page ids linked from the document (to look up which are published). */
export function linkedPageIds(doc: PageDocument): string[] {
  const ids = new Set<string>();
  const walk = (node: Node) => {
    if (node?.type === "margayaPageLink") {
      const id = str(node.attrs?.pageId);
      if (id) ids.add(id);
    }
    for (const child of node?.content ?? []) walk(child);
  };
  walk(doc as Node);
  return [...ids];
}

/** Asset ids the document's images point at. */
export function imageAssetIds(doc: PageDocument): string[] {
  const ids = new Set<string>();
  const walk = (node: Node) => {
    if (node?.type === "image") {
      const id = ASSET_URL.exec(str(node.attrs?.src))?.[1];
      if (id) ids.add(id);
    }
    for (const child of node?.content ?? []) walk(child);
  };
  walk(doc as Node);
  return [...ids];
}
