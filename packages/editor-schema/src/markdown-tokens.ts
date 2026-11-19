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
 * own newline is consumed: these tags can be wrapped in newlines, and
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

const ISSUE_LINK_TAG = CUSTOM_TAGS.margayaIssueLink;

/**
 * A task link inside a paragraph. Older versions wrote the tag with a newline
 * on each side, which reads back as a line break around a link that sat in
 * the middle of a sentence. A newline right before the tag (after at most one
 * space) or right after it is that old wrapping and is dropped; the space is
 * kept. A real line break is written as two trailing spaces, so it survives.
 */
const ISSUE_LINK_INLINE = new RegExp(
  `^(?:( ?)\\n)?<${ISSUE_LINK_TAG}${ATTRIBUTES}\\s*(?:\\/>|>\\s*<\\/${ISSUE_LINK_TAG}>)(?:\\n(?!\\s*$))?`,
);

export const issueLinkInlineTokenizer: MarkdownTokenizer = {
  name: "margayaIssueLink",
  level: "inline",
  // Stops the text before the newline and every space ahead of it, so a
  // line break's two spaces reach the line break rule, not the text.
  start: (src: string) => {
    const index = src.indexOf(`<${ISSUE_LINK_TAG}`);
    if (index <= 0 || src[index - 1] !== "\n") return index;
    let begin = index - 1;
    while (begin > 0 && src[begin - 1] === " ") begin -= 1;
    return begin;
  },
  tokenize: (src: string) => {
    const match = ISSUE_LINK_INLINE.exec(src);
    if (!match) return undefined;
    return {
      type: "margayaIssueLink",
      raw: match[0],
      attributes: readTagAttributes(match[2] ?? ""),
      before: match[1] ?? "",
    };
  },
};

export function parseIssueLink(
  token: MarkdownToken,
  _helpers: MarkdownParseHelpers,
): JSONContent | JSONContent[] {
  const { attributes, before } = token as CustomTagToken & { before?: string };
  const node = customNodeFromAttributes("margayaIssueLink", attributes ?? {});
  return before ? [{ type: "text", text: before }, node] : node;
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
 * The task link and the attachment are inline nodes that can sit on a line
 * of their own: the attachment always does, a task link when it is alone in
 * its paragraph (older versions wrote every task link that way). There they
 * read back as a paragraph holding just the node, as block HTML does in the
 * browser.
 */
export const standaloneInlineTokenizer: MarkdownTokenizer = {
  name: STANDALONE_INLINE_TOKEN,
  level: "block",
  start: () => -1,
  tokenize: (src, _tokens, lexer) => {
    for (const [node, pattern] of STANDALONE_PATTERNS) {
      const token = matchTag(pattern, STANDALONE_INLINE_TOKEN, src);
      if (!token) continue;
      if (
        node === "margayaIssueLink" &&
        continuesParagraph(src.slice(token.raw.length))
      ) {
        return linkFirstParagraph(src, lexer);
      }
      return { ...token, node };
    }
    return undefined;
  },
};

// A line that starts a block of its own, so it ends a paragraph.
const BLOCK_START =
  /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>|[-*+][ \t]|\d{1,9}[.)][ \t]|`{3,}|~{3,}|\||(?:[-*_][ \t]*){3,}$)/;

function continuesParagraph(rest: string): boolean {
  const line = rest.split("\n", 1)[0] ?? "";
  return line.trim() !== "" && !BLOCK_START.test(line);
}

/**
 * A paragraph that starts with a task link and goes on below it (after a
 * line break, or text the old writer put on the next line): one paragraph,
 * so the text doesn't split off into a paragraph of its own.
 */
function linkFirstParagraph(
  src: string,
  lexer: { inlineTokens: (src: string) => MarkdownToken[] },
): MarkdownToken {
  const lines = src.split("\n");
  let end = 0;
  for (const [index, line] of lines.entries()) {
    if (index > 0 && (line.trim() === "" || BLOCK_START.test(line))) break;
    end += line.length + 1;
  }
  const raw = src.slice(0, Math.min(end, src.length));
  const text = raw.replace(/\n+$/, "");
  return { type: "paragraph", raw, text, tokens: lexer.inlineTokens(text) };
}

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
