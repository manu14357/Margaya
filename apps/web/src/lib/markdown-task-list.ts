// "- [ ] item" and "- [x] item" as checkboxes for react-markdown, without a
// full extended-Markdown dependency: a list item whose text starts with a
// box gets `checked`, which react-markdown renders as a disabled checkbox
// (class "task-list-item", its list "contains-task-list").

type MarkdownNode = {
  type: string;
  value?: string;
  checked?: boolean | null;
  children?: MarkdownNode[];
};

const BOX = /^\[([ xX])\](?:[ \t]+|$)/;

function markItem(item: MarkdownNode) {
  const first = item.children?.[0];
  if (first?.type !== "paragraph") return;
  const text = first.children?.[0];
  if (text?.type !== "text" || typeof text.value !== "string") return;
  const match = BOX.exec(text.value);
  if (!match) return;
  item.checked = match[1] !== " ";
  text.value = text.value.slice(match[0].length);
}

function visit(node: MarkdownNode) {
  if (node.type === "listItem" && typeof node.checked !== "boolean") {
    markItem(node);
  }
  for (const child of node.children ?? []) visit(child);
}

/** A remark plugin: list items starting with "[ ]" or "[x]" become tasks. */
export function remarkTaskListItems() {
  return (tree: MarkdownNode) => {
    visit(tree);
  };
}
