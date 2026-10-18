import type { Editor, JSONContent } from "@tiptap/core";
import { type Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";

// Applying an AI suggestion to the editor. Every change is one ordinary
// editor transaction, so it joins undo history and, on pages, syncs to
// co-editors through the collaborative document like any typed edit.

export type EditorAiRange = { from: number; to: number };

/** The range's content as Markdown (plain text if Markdown is unavailable). */
export function rangeMarkdown(editor: Editor, range: EditorAiRange): string {
  const { doc } = editor.state;
  const from = Math.max(0, Math.min(range.from, doc.content.size));
  const to = Math.max(from, Math.min(range.to, doc.content.size));
  const plain = doc.textBetween(from, to, "\n\n", " ").trim();
  if (!editor.markdown) return plain;
  try {
    const slice = doc.slice(from, to);
    const json: JSONContent = {
      type: "doc",
      content: slice.content.toJSON() ?? [],
    };
    const markdown = editor.markdown.serialize(json).trim();
    return markdown || plain;
  } catch {
    return plain;
  }
}

/** A suggestion parsed into nodes of the editor's schema. */
export function parseSuggestion(editor: Editor, markdown: string): Fragment {
  const { schema } = editor;
  const text = markdown.trim();
  if (editor.markdown) {
    try {
      const json = editor.markdown.parse(text);
      return schema.nodeFromJSON(json).content;
    } catch {
      // Fall through to plain paragraphs.
    }
  }
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => schema.nodes.paragraph.create(null, schema.text(part)));
  return schema.nodes.doc.create(null, paragraphs).content;
}

/** Keeps a range on the same content while other edits land around it. */
export function mapRange(
  range: EditorAiRange,
  transaction: Transaction,
): EditorAiRange {
  const from = transaction.mapping.map(range.from, 1);
  const to = transaction.mapping.map(range.to, -1);
  return { from, to: Math.max(from, to) };
}

function finish(editor: Editor, transaction: Transaction, end: number) {
  const position = Math.min(end, transaction.doc.content.size);
  transaction.setSelection(
    TextSelection.near(transaction.doc.resolve(position), -1),
  );
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

/**
 * Replaces the range with the suggestion. A suggestion of one paragraph
 * inside one paragraph replaces just the selected text; anything else
 * replaces the covered blocks.
 */
export function replaceWithSuggestion(
  editor: Editor,
  range: EditorAiRange,
  markdown: string,
): boolean {
  const content = parseSuggestion(editor, markdown);
  if (content.size === 0 || !editor.isEditable) return false;
  const { state } = editor;
  const size = state.doc.content.size;
  const from = Math.max(0, Math.min(range.from, size));
  const to = Math.max(from, Math.min(range.to, size));
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  const transaction = state.tr;
  const only = content.childCount === 1 ? content.firstChild : null;
  if (only?.isTextblock && $from.sameParent($to) && $from.parent.isTextblock) {
    transaction.replaceWith(from, to, only.content);
    finish(editor, transaction, from + only.content.size);
    return true;
  }
  transaction.replaceRange(from, to, new Slice(content, 0, 0));
  finish(editor, transaction, transaction.mapping.map(to, 1));
  return true;
}

/** Inserts the suggestion as blocks after the block that ends the range. */
export function insertSuggestionBelow(
  editor: Editor,
  range: EditorAiRange,
  markdown: string,
): boolean {
  const content = parseSuggestion(editor, markdown);
  if (content.size === 0 || !editor.isEditable) return false;
  const { state } = editor;
  const to = Math.max(0, Math.min(range.to, state.doc.content.size));
  const $to = state.doc.resolve(to);
  const position = $to.depth >= 1 ? $to.after(1) : to;
  const transaction = state.tr.insert(position, content);
  finish(editor, transaction, position + content.size);
  return true;
}

/** The range of the top-level block at `pos` (for the block handle menu). */
export function blockRange(editor: Editor, pos: number): EditorAiRange | null {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return null;
  return { from: pos, to: pos + node.nodeSize };
}

/**
 * Inserts generated blocks where an AI block was asked for: an empty
 * paragraph at `pos` is replaced, otherwise the blocks go after the
 * top-level block that holds `pos`.
 */
export function insertBlockAt(
  editor: Editor,
  pos: number,
  markdown: string,
): boolean {
  const content = parseSuggestion(editor, markdown);
  if (content.size === 0 || !editor.isEditable) return false;
  const { state } = editor;
  const at = Math.max(0, Math.min(pos, state.doc.content.size));
  const $at = state.doc.resolve(at);
  const transaction = state.tr;
  if ($at.depth >= 1) {
    const block = $at.node(1);
    const start = $at.before(1);
    const end = $at.after(1);
    if (block.isTextblock && block.content.size === 0) {
      transaction.replaceWith(start, end, content);
      finish(editor, transaction, start + content.size);
      return true;
    }
    transaction.insert(end, content);
    finish(editor, transaction, end + content.size);
    return true;
  }
  transaction.insert(at, content);
  finish(editor, transaction, at + content.size);
  return true;
}
