import type { JSONContent } from "@tiptap/core";

// Projections the server derives from a page document on every persist:
// plain text for search, and the entities the document references.

function inlineText(node: JSONContent): string {
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "margayaMention":
      return `@${String(node.attrs?.label ?? "")}`;
    case "margayaIssueLink":
      return String(node.attrs?.issueKey ?? "");
    case "margayaPageLink":
      return String(node.attrs?.title ?? "");
    default:
      return (node.content ?? []).map(inlineText).join("");
  }
}

// Images are left out: they are blocks in a page, so counting them would
// flatten a document with a top-level image into one line.
function isTextBlock(node: JSONContent): boolean {
  return (node.content ?? []).some(
    (child) =>
      child.type === "text" ||
      child.type === "hardBreak" ||
      child.type === "margayaMention" ||
      child.type === "margayaIssueLink" ||
      child.type === "margayaPageLink" ||
      child.type === "attachmentCard",
  );
}

function collectBlocks(node: JSONContent, lines: string[]) {
  if (isTextBlock(node)) {
    const text = inlineText(node).trim();
    if (text) lines.push(text);
    return;
  }
  for (const child of node.content ?? []) collectBlocks(child, lines);
}

/**
 * Plain text: text, "@label" for mentions, task keys and page-link titles,
 * with one newline between blocks. Empty blocks are skipped.
 */
export function jsonToPlainText(json: JSONContent): string {
  const lines: string[] = [];
  collectBlocks(json, lines);
  return lines.join("\n");
}

export type DocumentReferences = {
  /** Mentioned members. */
  userIds: string[];
  /** Linked tasks, by id. */
  taskIds: string[];
  /** Task links that carry only a key (for example WEB-12); resolve them in the workspace. */
  taskKeys: string[];
  /** Linked pages. */
  pageIds: string[];
};

/**
 * The members, tasks and pages a document references, each once, in
 * document order. A page linking to itself (`selfPageId`) is ignored.
 */
export function referencesFromJson(
  json: JSONContent,
  { selfPageId }: { selfPageId?: string } = {},
): DocumentReferences {
  const userIds = new Set<string>();
  const taskIds = new Set<string>();
  const taskKeys = new Set<string>();
  const pageIds = new Set<string>();

  const visit = (node: JSONContent) => {
    const attrs = node.attrs ?? {};
    if (node.type === "margayaMention" && attrs.id) {
      userIds.add(String(attrs.id));
    } else if (node.type === "margayaIssueLink") {
      if (attrs.taskId) taskIds.add(String(attrs.taskId));
      else if (attrs.issueKey) taskKeys.add(String(attrs.issueKey));
    } else if (node.type === "margayaPageLink" && attrs.pageId) {
      const pageId = String(attrs.pageId);
      if (pageId !== selfPageId) pageIds.add(pageId);
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(json);

  return {
    userIds: [...userIds],
    taskIds: [...taskIds],
    taskKeys: [...taskKeys],
    pageIds: [...pageIds],
  };
}
