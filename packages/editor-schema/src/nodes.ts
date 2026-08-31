import { Extension, Node } from "@tiptap/core";
import { escapeHtml } from "./escape.js";
import {
  blockTagTokenizer,
  inlineTagTokenizer,
  parseCustomTag,
  parseStandaloneInline,
  STANDALONE_INLINE_TOKEN,
  standaloneInlineTokenizer,
} from "./markdown-tokens.js";

// Schema-only copies of the web editor's custom nodes: the same names, group,
// inline and atom flags, attribute names and defaults, and markdown output
// byte-identical to the web extensions. No node views, no DOM.

type Attrs = Record<string, unknown> | undefined;

function stringAttr(attrs: Attrs, key: string): string {
  return String(attrs?.[key] || "");
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const MargayaMention = Node.create({
  name: "margayaMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { id: { default: "" }, label: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "margaya-mention[id]" }];
  },

  renderHTML({ node }) {
    return [
      "span",
      { "data-type": "margaya-mention", "data-id": node.attrs.id },
      `@${node.attrs.label || ""}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.label || ""}`;
  },

  markdownTokenizer: inlineTagTokenizer("margayaMention"),
  parseMarkdown: parseCustomTag("margayaMention"),

  // The web writes mention values unescaped; a label with a double quote is
  // a known limitation of that format.
  renderMarkdown(node: { attrs?: Attrs }) {
    const id = stringAttr(node.attrs, "id");
    const label = stringAttr(node.attrs, "label");
    if (!id) return `@${label}`;
    return `<margaya-mention id="${id}" label="${label}"></margaya-mention>`;
  },
});

export const MargayaIssueLink = Node.create({
  name: "margayaIssueLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      url: { default: "" },
      issueKey: { default: "" },
      taskId: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "margaya-issue-link[url]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["margaya-issue-link", HTMLAttributes];
  },

  markdownTokenizer: inlineTagTokenizer("margayaIssueLink"),
  parseMarkdown: parseCustomTag("margayaIssueLink"),

  renderMarkdown(node: { attrs?: Attrs }) {
    const url = stringAttr(node.attrs, "url");
    const issueKey = stringAttr(node.attrs, "issueKey");
    const taskId = stringAttr(node.attrs, "taskId");
    if (!url) return "";
    return `\n<margaya-issue-link url="${escapeHtml(url)}" issue-key="${escapeHtml(issueKey)}" task-id="${escapeHtml(taskId)}" />\n`;
  },
});

export const AttachmentCard = Node.create({
  name: "attachmentCard",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      url: { default: "" },
      filename: { default: "" },
      mimeType: { default: "" },
      size: { default: 0 },
    };
  },

  parseHTML() {
    return [{ tag: "margaya-attachment[url]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["margaya-attachment", HTMLAttributes];
  },

  markdownTokenizer: inlineTagTokenizer("attachmentCard"),
  parseMarkdown: parseCustomTag("attachmentCard"),

  renderMarkdown(node: { attrs?: Attrs }) {
    const url = stringAttr(node.attrs, "url");
    const filename = stringAttr(node.attrs, "filename");
    const mimeType = stringAttr(node.attrs, "mimeType");
    const size = Number(node.attrs?.size || 0);
    if (!url) return "";
    return `\n<margaya-attachment url="${escapeHtml(url)}" filename="${escapeHtml(filename)}" mime-type="${escapeHtml(mimeType)}" size="${size}" />\n`;
  },
});

export const EmbedBlock = Node.create({
  name: "embedBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return { url: { default: "" }, mode: { default: "embed" } };
  },

  parseHTML() {
    return [{ tag: "margaya-embed[url]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      { "data-type": "margaya-embed", "data-url": HTMLAttributes.url },
    ];
  },

  markdownTokenizer: blockTagTokenizer("embedBlock"),
  parseMarkdown: parseCustomTag("embedBlock"),

  renderMarkdown(node: { attrs?: Attrs }) {
    const url = stringAttr(node.attrs, "url");
    const mode = node.attrs?.mode === "link" ? "link" : "embed";
    if (!isValidUrl(url)) {
      return `\n<span class="margaya-embed-invalid-link">${escapeHtml(url)}</span>\n`;
    }
    return `\n<margaya-embed url="${escapeHtml(url)}" mode="${mode}" />\n`;
  },
});

/**
 * A link to another page. `title` is a snapshot for markdown readers only;
 * the editor shows the linked page's live title.
 */
export const MargayaPageLink = Node.create({
  name: "margayaPageLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { pageId: { default: "" }, title: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "margaya-page-link[id]" }];
  },

  renderHTML({ node }) {
    return [
      "span",
      { "data-type": "margaya-page-link", "data-page-id": node.attrs.pageId },
      node.attrs.title || "",
    ];
  },

  renderText({ node }) {
    return node.attrs.title || "";
  },

  markdownTokenizer: inlineTagTokenizer("margayaPageLink"),
  parseMarkdown: parseCustomTag("margayaPageLink"),

  // Both values are escaped (ids are generated, so that only matters for a
  // crafted document).
  renderMarkdown(node: { attrs?: Attrs }) {
    const pageId = stringAttr(node.attrs, "pageId");
    const title = stringAttr(node.attrs, "title");
    return `<margaya-page-link id="${escapeHtml(pageId)}" title="${escapeHtml(title)}"></margaya-page-link>`;
  },
});

/** Reads a task link or attachment written on a line of its own. */
export const StandaloneInlineTags = Extension.create({
  name: "margayaStandaloneInlineTags",
  markdownTokenName: STANDALONE_INLINE_TOKEN,
  markdownTokenizer: standaloneInlineTokenizer,
  parseMarkdown: parseStandaloneInline,
});

export const CUSTOM_NODES = [
  MargayaMention,
  MargayaIssueLink,
  AttachmentCard,
  EmbedBlock,
  MargayaPageLink,
];
