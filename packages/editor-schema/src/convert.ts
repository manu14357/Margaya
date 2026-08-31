import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Schema } from "@tiptap/pm/model";
import {
  updateYFragment,
  yXmlFragmentToProsemirrorJSON,
} from "@tiptap/y-tiptap";
import type { marked } from "marked";
import * as Y from "yjs";
import { createBoundedMarked } from "./bounded-marked.js";
import { calloutVariant } from "./callout.js";
import { pageExtensions, pageSchema } from "./extensions.js";
import { imageAlign, imageWidth } from "./image.js";

/** The Yjs fragment holding the document (the collaboration extension's default field). */
export const PAGE_FRAGMENT = "default";

export type PageDocument = JSONContent & { type: "doc" };

let manager: MarkdownManager | null = null;

// A private marked instance: the custom tokenizers never leak into the
// process-wide `marked` default.
function markdownManager(): MarkdownManager {
  manager ??= new MarkdownManager({
    marked: createBoundedMarked() as unknown as typeof marked,
    markedOptions: { breaks: true, gfm: true },
    extensions: pageExtensions(),
  });
  return manager;
}

/** A document with one empty paragraph: what an empty page holds. */
export function emptyPageDocument(): PageDocument {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function sanitizeMarks(
  marks: JSONContent["marks"],
  schema: Schema,
): JSONContent["marks"] {
  if (!Array.isArray(marks)) return undefined;
  const kept = marks.filter(
    (mark) => mark && typeof mark.type === "string" && schema.marks[mark.type],
  );
  return kept.length > 0 ? kept : undefined;
}

/**
 * Attribute values the schema can't check itself: anything outside a
 * node's allowlist falls back to its default.
 */
function sanitizeAttributes(
  type: string,
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  if (type === "callout") {
    return { ...attrs, variant: calloutVariant(attrs.variant) };
  }
  if (type === "image") {
    return {
      ...attrs,
      width: imageWidth(attrs.width),
      align: imageAlign(attrs.align),
    };
  }
  return attrs;
}

function sanitizeNode(node: JSONContent, schema: Schema): JSONContent | null {
  if (!node || typeof node !== "object" || typeof node.type !== "string") {
    return null;
  }
  if (node.type === "text") {
    if (typeof node.text !== "string" || node.text.length === 0) return null;
    const marks = sanitizeMarks(node.marks, schema);
    return marks
      ? { type: "text", text: node.text, marks }
      : { type: "text", text: node.text };
  }
  if (!schema.nodes[node.type]) return null;

  const result: JSONContent = { type: node.type };
  if (node.attrs && typeof node.attrs === "object") {
    result.attrs = sanitizeAttributes(node.type, node.attrs);
  }
  const marks = sanitizeMarks(node.marks, schema);
  if (marks) result.marks = marks;
  if (Array.isArray(node.content)) {
    const content = node.content
      .map((child) => sanitizeNode(child, schema))
      .filter((child): child is JSONContent => child !== null);
    if (content.length > 0) result.content = content;
  }
  return result;
}

/**
 * Canonical JSON for a page document: unknown node and mark types are
 * dropped, attributes get their defaults, and an empty document gets one
 * empty paragraph (so concurrent clients never each add their own).
 */
export function normalizeDocument(json: JSONContent): PageDocument {
  const schema = pageSchema();
  const root: JSONContent =
    json?.type === "doc" ? json : { type: "doc", content: json ? [json] : [] };
  const sanitized = sanitizeNode(root, schema) ?? { type: "doc" };
  if (!sanitized.content || sanitized.content.length === 0) {
    sanitized.content = emptyPageDocument().content;
  }
  return schema.nodeFromJSON(sanitized).toJSON() as PageDocument;
}

/** Markdown (as the web editor writes it) to a normalized document. */
export function markdownToJson(markdown: string): PageDocument {
  return normalizeDocument(markdownManager().parse(markdown));
}

/** The markdown the web editor's `getMarkdown()` produces for the document. */
export function jsonToMarkdown(json: JSONContent): string {
  return markdownManager().serialize(json);
}

/** The document held in a Yjs fragment. Reads only; never changes the doc. */
export function yFragmentToJson(fragment: Y.XmlFragment): PageDocument {
  return normalizeDocument(
    yXmlFragmentToProsemirrorJSON(fragment) as JSONContent,
  );
}

/** The document of a page's Yjs doc (its `default` fragment). */
export function yDocToJson(doc: Y.Doc): PageDocument {
  return yFragmentToJson(doc.getXmlFragment(PAGE_FRAGMENT));
}

/**
 * Turns the doc's `default` fragment into exactly `json` with a structural
 * diff, in one transaction with `origin`. Unchanged blocks keep their Yjs
 * items, so concurrent edits elsewhere survive; an empty doc is filled.
 */
export function applyJsonToYDoc(
  doc: Y.Doc,
  json: JSONContent,
  origin: unknown = null,
): void {
  const target = pageSchema().nodeFromJSON(normalizeDocument(json));
  const fragment = doc.getXmlFragment(PAGE_FRAGMENT);
  doc.transact(() => {
    updateYFragment(doc, fragment, target, {
      mapping: new Map(),
      isOMark: new Map(),
    });
  }, origin);
}

/** A fresh Yjs doc holding `json`. */
export function jsonToYDoc(json: JSONContent): Y.Doc {
  const doc = new Y.Doc();
  applyJsonToYDoc(doc, json);
  return doc;
}

/** The encoded state of a fresh Yjs doc holding `json`. */
export function jsonToYjsState(json: JSONContent): Uint8Array {
  const doc = jsonToYDoc(json);
  try {
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/** The document held in an encoded Yjs state. */
export function yjsStateToJson(state: Uint8Array): PageDocument {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return yDocToJson(doc);
  } finally {
    doc.destroy();
  }
}
