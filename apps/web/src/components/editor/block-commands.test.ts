import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { runBlockCommand, topBlockAt } from "./block-commands";
import { BlockKeymap } from "./extensions/block-keymap";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function createEditor(content: string) {
  const editor = new Editor({
    extensions: [StarterKit.configure({ trailingNode: false }), BlockKeymap],
    content,
  });
  editors.push(editor);
  return editor;
}

function blockTexts(editor: Editor): string[] {
  const texts: string[] = [];
  editor.state.doc.forEach((node) => {
    texts.push(node.textContent);
  });
  return texts;
}

/** Puts the cursor `offset` characters into the top-level block at `index`. */
function cursorIn(editor: Editor, index: number, offset = 0) {
  const block = topBlockAt(editor.state.doc, 0);
  let pos = block?.pos ?? 0;
  for (let i = 0; i < index; i += 1) pos += editor.state.doc.child(i).nodeSize;
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.near(editor.state.doc.resolve(pos + 1 + offset)),
    ),
  );
}

function selectedText(editor: Editor) {
  const { $from } = editor.state.selection;
  return { text: $from.parent.textContent, offset: $from.parentOffset };
}

describe("block commands", () => {
  it("moves the cursor's block down and up, keeping the cursor in it", () => {
    const editor = createEditor("<p>one</p><p>two</p><p>three</p>");
    cursorIn(editor, 0, 2);

    expect(runBlockCommand(editor, "moveDown")).toBe(true);
    expect(blockTexts(editor)).toEqual(["two", "one", "three"]);
    expect(selectedText(editor)).toEqual({ text: "one", offset: 2 });

    expect(runBlockCommand(editor, "moveDown")).toBe(true);
    expect(blockTexts(editor)).toEqual(["two", "three", "one"]);

    expect(runBlockCommand(editor, "moveUp")).toBe(true);
    expect(blockTexts(editor)).toEqual(["two", "one", "three"]);
    expect(selectedText(editor)).toEqual({ text: "one", offset: 2 });
  });

  it("does nothing past either end", () => {
    const editor = createEditor("<p>one</p><p>two</p>");
    cursorIn(editor, 0);
    expect(runBlockCommand(editor, "moveUp")).toBe(false);
    cursorIn(editor, 1);
    expect(runBlockCommand(editor, "moveDown")).toBe(false);
    expect(blockTexts(editor)).toEqual(["one", "two"]);
  });

  it("moves a whole list when the cursor is in a nested item", () => {
    const editor = createEditor(
      "<p>intro</p><ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>",
    );
    const listPos = editor.state.doc.child(0).nodeSize;
    // Inside "b", deep in the list.
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.near(editor.state.doc.resolve(listPos + 8)),
      ),
    );
    expect(selectedText(editor).text).toBe("b");
    expect(runBlockCommand(editor, "moveUp")).toBe(true);
    expect(editor.state.doc.child(0).type.name).toBe("bulletList");
    expect(editor.state.doc.child(1).textContent).toBe("intro");
    expect(selectedText(editor).text).toBe("b");
  });

  it("duplicates the block after itself and moves the cursor into the copy", () => {
    const editor = createEditor("<p>one</p><h2>two</h2><p>three</p>");
    cursorIn(editor, 1, 1);
    expect(runBlockCommand(editor, "duplicate")).toBe(true);
    expect(blockTexts(editor)).toEqual(["one", "two", "two", "three"]);
    expect(editor.state.doc.child(2).type.name).toBe("heading");
    expect(editor.state.selection.$from.index(0)).toBe(2);
  });

  it("deletes the block, and leaves an empty paragraph for the last one", () => {
    const editor = createEditor(
      "<p>one</p><blockquote><p>two</p></blockquote>",
    );
    cursorIn(editor, 1);
    expect(runBlockCommand(editor, "delete")).toBe(true);
    expect(blockTexts(editor)).toEqual(["one"]);
    expect(runBlockCommand(editor, "delete")).toBe(true);
    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("acts on the block at a given position (the handle's block)", () => {
    const editor = createEditor("<p>one</p><p>two</p><p>three</p>");
    cursorIn(editor, 0);
    const third =
      editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
    expect(runBlockCommand(editor, "moveUp", third)).toBe(true);
    expect(blockTexts(editor)).toEqual(["one", "three", "two"]);
    // The cursor stays where it was.
    expect(selectedText(editor).text).toBe("one");
  });

  it("refuses to run while the editor is read-only", () => {
    const editor = createEditor("<p>one</p><p>two</p>");
    editor.setEditable(false);
    expect(runBlockCommand(editor, "moveDown", 0)).toBe(false);
    expect(blockTexts(editor)).toEqual(["one", "two"]);
  });

  it("moves blocks with Alt+Shift+Up and Alt+Shift+Down", () => {
    const editor = createEditor("<p>one</p><p>two</p>");
    cursorIn(editor, 0);
    const press = (key: string) =>
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          altKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    press("ArrowDown");
    expect(blockTexts(editor)).toEqual(["two", "one"]);
    press("ArrowUp");
    expect(blockTexts(editor)).toEqual(["one", "two"]);
  });
});

describe("block commands under collaboration", () => {
  function collaborativeEditor(doc: Y.Doc) {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ undoRedo: false, trailingNode: false }),
        Collaboration.configure({ document: doc }),
      ],
    });
    editors.push(editor);
    return editor;
  }

  it("converges when one person moves a block while another types", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = collaborativeEditor(docA);
    a.commands.setContent("<p>one</p><p>two</p><p>three</p>");
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = collaborativeEditor(docB);
    expect(blockTexts(b)).toEqual(["one", "two", "three"]);

    const fromA: Uint8Array[] = [];
    const fromB: Uint8Array[] = [];
    docA.on("update", (update: Uint8Array) => fromA.push(update));
    docB.on("update", (update: Uint8Array) => fromB.push(update));

    // A moves "one" down; at the same time B types into "three".
    cursorIn(a, 0);
    expect(runBlockCommand(a, "moveDown")).toBe(true);
    cursorIn(b, 2, 5);
    b.commands.insertContent("!");

    for (const update of fromA) Y.applyUpdate(docB, update);
    for (const update of fromB) Y.applyUpdate(docA, update);

    expect(blockTexts(a)).toEqual(["two", "one", "three!"]);
    expect(blockTexts(b)).toEqual(blockTexts(a));
  });
});
