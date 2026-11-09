import type { Editor } from "@tiptap/core";
import { Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { ComponentProps } from "react";
import CommentEditor from "@/components/activity/comment-editor";

/** A key typed into the preview before the editor was there to take it. */
export type StickyKey =
  | { text: string }
  | { key: "Enter" | "Shift-Enter" | "Backspace" | "Delete" };

/**
 * Where the caret goes once the editor shows: a point (relative to the text
 * area's top left corner) the preview was clicked at, the document's end, or
 * wherever the editor puts it itself.
 */
export type StickyCaret = { x: number; y: number } | "end" | "keep";

/** What gets focus: the text, or the n-th to-do's checkbox. */
export type StickyFocusTarget = "text" | { checkbox: number };

/** The loaded editor, as the card drives it while taking over from the preview. */
export type StickyEditorHandle = {
  /** False until every to-do's checkbox is drawn. */
  isSettled(): boolean;
  hasFocus(): boolean;
  placeCaret(caret: StickyCaret, scrollTop: number): void;
  focus(target: StickyFocusTarget): void;
  /** Applies to-do clicks (by index) and replays keys, as the editor would have. */
  applyEdits(toggles: ReadonlyMap<number, boolean>, keys: StickyKey[]): void;
};

type StickyEditorProps = Omit<
  ComponentProps<typeof CommentEditor>,
  "onEditorReady"
> & {
  onReady: (handle: StickyEditorHandle) => void;
};

/**
 * The comment editor for a sticky, loaded the first time someone works in
 * one. The card mounts it hidden behind the preview and calls `onReady`'s
 * handle to move focus, caret and anything typed meanwhile into it.
 */
export default function StickyEditor({ onReady, ...props }: StickyEditorProps) {
  return (
    <CommentEditor
      {...props}
      onEditorReady={(editor) => onReady(createHandle(editor))}
    />
  );
}

function taskItemPositions(editor: Editor) {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "taskItem") positions.push(pos);
  });
  return positions;
}

function checkboxes(editor: Editor) {
  return Array.from(
    editor.view.dom.querySelectorAll<HTMLElement>(
      '[data-type="taskItem"] > .margaya-task-item-checkbox [data-slot="checkbox"]',
    ),
  );
}

function typeText(view: EditorView, text: string) {
  // Through the input rules, as typing does ("- " starts a list).
  for (const character of text) {
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(character, from, to);
    const handled = view.someProp("handleTextInput", (handler) =>
      handler(view, from, to, character, insert),
    );
    if (!handled) view.dispatch(insert());
  }
}

function pressKey(
  view: EditorView,
  key: Exclude<StickyKey, { text: string }>["key"],
) {
  const event = new KeyboardEvent("keydown", {
    key: key === "Shift-Enter" ? "Enter" : key,
    shiftKey: key === "Shift-Enter",
    bubbles: true,
    cancelable: true,
  });
  view.someProp("handleKeyDown", (handler) => handler(view, event));
}

function createHandle(editor: Editor): StickyEditorHandle {
  return {
    isSettled: () =>
      editor.isDestroyed ||
      checkboxes(editor).length >= taskItemPositions(editor).length,
    hasFocus: () => !editor.isDestroyed && editor.view.hasFocus(),
    placeCaret: (caret, scrollTop) => {
      if (editor.isDestroyed) return;
      const { view } = editor;
      view.dom.scrollTop = scrollTop;
      let selection: Selection | null = null;
      if (caret === "end") {
        selection = Selection.atEnd(view.state.doc);
      } else if (caret !== "keep") {
        const rect = view.dom.getBoundingClientRect();
        const hit = view.posAtCoords({
          left: rect.left + caret.x,
          top: rect.top + caret.y,
        });
        if (hit)
          selection = TextSelection.near(view.state.doc.resolve(hit.pos));
      }
      if (selection) view.dispatch(view.state.tr.setSelection(selection));
    },
    focus: (target) => {
      if (editor.isDestroyed) return;
      if (target === "text") {
        // The view's own focus is synchronous (the editor's focus command
        // waits a frame), so no key lands on the page in between.
        editor.view.focus();
        return;
      }
      const box = checkboxes(editor)[target.checkbox];
      if (box) box.focus({ preventScroll: true });
      else editor.view.focus();
    },
    applyEdits: (toggles, keys) => {
      if (editor.isDestroyed) return;
      const { view } = editor;
      if (toggles.size > 0) {
        const positions = taskItemPositions(editor);
        const tr = view.state.tr;
        for (const [index, checked] of toggles) {
          const pos = positions[index];
          if (pos === undefined) continue;
          const node = tr.doc.nodeAt(pos);
          if (!node || node.attrs.checked === checked) continue;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
        }
        if (tr.docChanged) view.dispatch(tr);
      }
      for (const key of keys) {
        if ("text" in key) typeText(view, key.text);
        else pressKey(view, key.key);
      }
    },
  };
}
