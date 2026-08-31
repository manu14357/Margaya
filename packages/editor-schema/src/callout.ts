import type { JSONContent, MarkdownTokenizer } from "@tiptap/core";
import { mergeAttributes, Node } from "@tiptap/core";

// A callout: a coloured box around block content. In markdown it is a
// GitHub alert (`> [!NOTE]` and the quoted lines below it), so other
// markdown readers show it as a quote, or as GitHub's own alert.

export const CALLOUT_VARIANTS = [
  "info",
  "warning",
  "success",
  "danger",
] as const;

export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

const ALERT_BY_VARIANT: Record<CalloutVariant, string> = {
  info: "NOTE",
  warning: "WARNING",
  success: "TIP",
  danger: "CAUTION",
};

// GitHub's IMPORTANT has no variant of its own; it reads as info.
const VARIANT_BY_ALERT: Record<string, CalloutVariant> = {
  NOTE: "info",
  IMPORTANT: "info",
  WARNING: "warning",
  TIP: "success",
  CAUTION: "danger",
};

/** The variant, or `info` for anything that isn't one. */
export function calloutVariant(value: unknown): CalloutVariant {
  return CALLOUT_VARIANTS.includes(value as CalloutVariant)
    ? (value as CalloutVariant)
    : "info";
}

const ALERT_HEAD =
  /^ {0,3}>[ \t]?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;
const QUOTED_LINE = / {0,3}>[ \t]?(.*)(?:\n|$)/y;

/**
 * `> [!NOTE]` followed by quoted lines. The callout ends at the first line
 * that doesn't start with `>` (lazy continuation lines are not followed).
 */
export const calloutTokenizer: MarkdownTokenizer = {
  name: "callout",
  level: "block",
  // Like a custom tag, a callout never interrupts a paragraph; marked's own
  // paragraph already stops before a `>` line.
  start: () => -1,
  tokenize: (src, _tokens, lexer) => {
    const head = ALERT_HEAD.exec(src);
    if (!head) return undefined;
    const lines: string[] = [];
    let position = head[0].length;
    while (position < src.length) {
      QUOTED_LINE.lastIndex = position;
      const match = QUOTED_LINE.exec(src);
      if (!match) break;
      lines.push(match[1] ?? "");
      position += match[0].length;
    }
    return {
      type: "callout",
      raw: src.slice(0, position),
      variant: VARIANT_BY_ALERT[(head[1] ?? "").toUpperCase()] ?? "info",
      tokens: lexer.blockTokens(lines.join("\n")),
    };
  },
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Wraps the selected blocks in a callout. */
      setCallout: (attributes?: { variant?: CalloutVariant }) => ReturnType;
      /** Wraps the selected blocks in a callout, or lifts them out of one. */
      toggleCallout: (attributes?: { variant?: CalloutVariant }) => ReturnType;
      /** Changes the variant of the callout around the selection. */
      setCalloutVariant: (variant: CalloutVariant) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: "info",
        parseHTML: (element: HTMLElement) =>
          calloutVariant(element.getAttribute("data-variant")),
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-variant": calloutVariant(attributes.variant),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "callout" }, HTMLAttributes),
      0,
    ];
  },

  markdownTokenizer: calloutTokenizer,

  parseMarkdown: (token, helpers) => {
    const parse = helpers.parseBlockChildren ?? helpers.parseChildren;
    const content: JSONContent[] = parse(token.tokens ?? []);
    return helpers.createNode(
      "callout",
      { variant: calloutVariant(token.variant) },
      content.length > 0 ? content : [{ type: "paragraph" }],
    );
  },

  renderMarkdown: (node, helpers) => {
    const head = `> [!${ALERT_BY_VARIANT[calloutVariant(node.attrs?.variant)]}]`;
    const children = (node.content ?? []).map((child, index) =>
      (helpers.renderChild?.(child, index) ?? helpers.renderChildren([child]))
        .split("\n")
        .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
        .join("\n"),
    );
    return children.length > 0 ? `${head}\n${children.join("\n>\n")}` : head;
  },

  addCommands() {
    return {
      setCallout:
        (attributes) =>
        ({ commands }) =>
          commands.wrapIn(this.name, {
            variant: calloutVariant(attributes?.variant),
          }),
      toggleCallout:
        (attributes) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, {
            variant: calloutVariant(attributes?.variant),
          }),
      setCalloutVariant:
        (variant) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, {
            variant: calloutVariant(variant),
          }),
    };
  },
});
