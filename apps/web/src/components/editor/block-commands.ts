import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  type EditorState,
  NodeSelection,
  Selection,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";

// Commands on one top-level block (a paragraph, a list, a table, a callout):
// the block handle's menu and the Alt+Shift+Up/Down keys. Each is a single
// ordinary transaction, so collaboration syncs it like any other edit; a
// move deletes the block and inserts it again next to its neighbour, which
// keeps the neighbour itself untouched.

export type TopBlock = { node: ProseMirrorNode; pos: number; index: number };

export type BlockCommand = "moveUp" | "moveDown" | "duplicate" | "delete";

/** The top-level block at `pos` (clamped into the document). */
export function topBlockAt(doc: ProseMirrorNode, pos: number): TopBlock | null {
  if (doc.childCount === 0) return null;
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  const index = Math.min($pos.index(0), doc.childCount - 1);
  return { node: doc.child(index), pos: $pos.posAtIndex(index, 0), index };
}

/** Keeps a selection inside the block at the same spot after it moves. */
function carrySelection(
  tr: Transaction,
  selection: Selection,
  block: TopBlock,
  newPos: number,
) {
  const end = block.pos + block.node.nodeSize;
  if (selection.from < block.pos || selection.to > end) return;
  const offset = newPos - block.pos;
  if (selection instanceof NodeSelection) {
    tr.setSelection(NodeSelection.create(tr.doc, selection.from + offset));
  } else if (selection instanceof TextSelection) {
    tr.setSelection(
      TextSelection.create(
        tr.doc,
        selection.anchor + offset,
        selection.head + offset,
      ),
    );
  } else {
    tr.setSelection(NodeSelection.create(tr.doc, newPos));
  }
}

function move(
  state: EditorState,
  block: TopBlock,
  direction: -1 | 1,
): Transaction | null {
  const targetIndex = block.index + direction;
  if (targetIndex < 0 || targetIndex >= state.doc.childCount) return null;
  const neighbour = state.doc.child(targetIndex);
  const newPos =
    direction < 0
      ? block.pos - neighbour.nodeSize
      : block.pos + neighbour.nodeSize;
  const tr = state.tr
    .delete(block.pos, block.pos + block.node.nodeSize)
    .insert(newPos, block.node);
  carrySelection(tr, state.selection, block, newPos);
  return tr.scrollIntoView();
}

function duplicate(state: EditorState, block: TopBlock): Transaction {
  const newPos = block.pos + block.node.nodeSize;
  const tr = state.tr.insert(newPos, block.node.copy(block.node.content));
  carrySelection(tr, state.selection, block, newPos);
  return tr.scrollIntoView();
}

function remove(state: EditorState, block: TopBlock): Transaction | null {
  const tr = state.tr;
  if (state.doc.childCount === 1) {
    const paragraph = state.schema.nodes.paragraph?.create();
    if (!paragraph) return null;
    tr.replaceWith(0, state.doc.content.size, paragraph);
  } else {
    tr.delete(block.pos, block.pos + block.node.nodeSize);
  }
  const near = Math.min(block.pos, tr.doc.content.size);
  tr.setSelection(Selection.near(tr.doc.resolve(near)));
  return tr.scrollIntoView();
}

/** The transaction for `command` on the block at `pos`, or null when it can't run. */
export function blockCommandTransaction(
  state: EditorState,
  command: BlockCommand,
  pos: number = state.selection.from,
): Transaction | null {
  const block = topBlockAt(state.doc, pos);
  if (!block) return null;
  switch (command) {
    case "moveUp":
      return move(state, block, -1);
    case "moveDown":
      return move(state, block, 1);
    case "duplicate":
      return duplicate(state, block);
    case "delete":
      return remove(state, block);
  }
}

/** Runs `command` on the block at `pos` (the selection's by default). */
export function runBlockCommand(
  editor: Editor,
  command: BlockCommand,
  pos?: number,
): boolean {
  if (!editor.isEditable || editor.isDestroyed) return false;
  const tr = blockCommandTransaction(editor.state, command, pos);
  if (!tr) return false;
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}
