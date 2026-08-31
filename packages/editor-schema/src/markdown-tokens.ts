import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownToken,
  MarkdownTokenizer,
} from "@tiptap/core";
import { readTagAttributes } from "./escape.js";

// Markdown tokenizers for Margaya's custom tags. The markdown parser only
// turns inline HTML into nodes through a DOM, and falls back to literal text
// without one; these tokenizers read the tags directly, so the server parses
// exactly what the web editor writes.

export const CUSTOM_TAGS = {
  margayaMention: "margaya-mention",
  margayaIssueLink: "margaya-issue-link",
  attachmentCard: "margaya-attachment",
  embedBlock: "margaya-embed",
  margayaPageLink: "margaya-page-link",
} as const;

export type CustomNodeName = keyof typeof CUSTOM_TAGS;

const ATTRIBUTES = String.raw`((?:\s+[a-zA-Z][\w-]*="[^"]*")*)`;

/** `<tag a="b" />` or `<tag a="b"></tag>`, at the start of the source. */
function tagPattern(tag: string): RegExp {
  return new RegExp(`^<${tag}${ATTRIBUTES}\\s*(?:\\/>|>\\s*<\\/${tag}>)`);
}

/**
 * The same tag alone on its line (up to 3 spaces of indent). Only the line's
 * own newline is consumed: the web writes these tags wrapped in newlines, and
 * leaving the blank lines to the parser keeps them from reading back as extra
 * empty paragraphs, so a round trip is stable.
 */
function blockTagPattern(tag: string): RegExp {
  return new RegExp(
    `^ {0,3}<${tag}${ATTRIBUTES}\\s*(?:\\/>|>\\s*<\\/${tag}>)[ \\t]*(?:\\n|$)`,
  );
}

export type CustomTagToken = MarkdownToken & {
  type: string;
  raw: string;
  attributes: Record<string, string>;
};

function matchTag(
  pattern: RegExp,
  type: string,
  src: string,
): CustomTagToken | undefined {
  const match = pattern.exec(src);
  if (!match) return undefined;
  return {
    type,
    raw: match[0],
    attributes: readTagAttributes(match[1] ?? ""),
  };
}

/** An inline tokenizer for one custom node, named after the node. */
export function inlineTagTokenizer(node: CustomNodeName): MarkdownTokenizer {
  const tag = CUSTOM_TAGS[node];
  const pattern = tagPattern(tag);
  return {
    name: node,
    level: "inline",
    start: (src: string) => src.indexOf(`<${tag}`),
    tokenize: (src: string) => matchTag(pattern, node, src),
  };
}

/** A block tokenizer for one custom node, named after the node. */
export function blockTagTokenizer(node: CustomNodeName): MarkdownTokenizer {
  const pattern = blockTagPattern(CUSTOM_TAGS[node]);
  return {
    name: node,
    level: "block",
    // Like block HTML, the tag never interrupts a paragraph.
    start: () => -1,
    tokenize: (src: string) => matchTag(pattern, node, src),
  };
}

export const STANDALONE_INLINE_TOKEN = "margayaStandaloneInline";

const STANDALONE_INLINE_NODES = ["margayaIssueLink", "attachmentCard"] as const;
const STANDALONE_PATTERNS = STANDALONE_INLINE_NODES.map(
  (node) => [node, blockTagPattern(CUSTOM_TAGS[node])] as const,
);

/**
 * The task link and the attachment are inline nodes that the web writes on
 * a line of their own. There they read back as a paragraph holding just the
 * node, as block HTML does in the browser.
 */
export const standaloneInlineTokenizer: MarkdownTokenizer = {
  name: STANDALONE_INLINE_TOKEN,
  level: "block",
  start: () => -1,
  tokenize: (src: string) => {
    for (const [node, pattern] of STANDALONE_PATTERNS) {
      const token = matchTag(pattern, STANDALONE_INLINE_TOKEN, src);
      if (token) return { ...token, node };
    }
    return undefined;
  },
};

function text(value: string | undefined): string {
  return value ?? "";
}

/** The node a custom tag reads back as, from its (unescaped) attributes. */
export function customNodeFromAttributes(
  node: CustomNodeName,
  attributes: Record<string, string>,
): JSONContent {
  switch (node) {
    case "margayaMention":
      return {
        type: node,
        attrs: { id: text(attributes.id), label: text(attributes.label) },
      };
    case "margayaIssueLink":
      return {
        type: node,
        attrs: {
          url: text(attributes.url),
          issueKey: text(attributes["issue-key"]),
          taskId: text(attributes["task-id"]),
        },
      };
    case "attachmentCard": {
      const size = Number(attributes.size ?? 0);
      return {
        type: node,
        attrs: {
          url: text(attributes.url),
          filename: text(attributes.filename),
          mimeType: text(attributes["mime-type"]),
          size: Number.isFinite(size) ? size : 0,
        },
      };
    }
    case "embedBlock":
      return {
        type: node,
        attrs: {
          url: text(attributes.url),
          mode: attributes.mode === "link" ? "link" : "embed",
        },
      };
    case "margayaPageLink":
      return {
        type: node,
        attrs: { pageId: text(attributes.id), title: text(attributes.title) },
      };
  }
}

export function parseCustomTag(node: CustomNodeName) {
  return (token: MarkdownToken, _helpers: MarkdownParseHelpers) =>
    customNodeFromAttributes(node, (token as CustomTagToken).attributes ?? {});
}

export function parseStandaloneInline(
  token: MarkdownToken,
  _helpers: MarkdownParseHelpers,
): JSONContent {
  const { node, attributes } = token as CustomTagToken & {
    node: CustomNodeName;
  };
  return {
    type: "paragraph",
    content: [customNodeFromAttributes(node, attributes ?? {})],
  };
}
