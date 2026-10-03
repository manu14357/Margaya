import type { Editor } from "@tiptap/core";
import type { TFunction } from "i18next";
import { calloutSlashCommand } from "@/components/editor/callout-slash-command";
import type { EditorRange } from "@/components/editor/use-editor-asset-upload";
import type { SlashCommand } from "@/components/editor/use-slash-menu";

type Actions = {
  /** Opens the file picker; the upload replaces nothing (range deleted). */
  onFile: (editor: Editor) => void;
  /** Opens the page picker for the slash range. */
  onPageLink: (editor: Editor, range: EditorRange) => void;
};

/**
 * The page editor's slash commands (§4.4): Text, Heading 1-3; Bulleted,
 * Numbered and To-do lists; Quote, Callout, Code block, Divider, Table, File
 * and Link to page. Labels reuse the task editor's keys where they exist.
 */
export function pageSlashCommands(
  t: TFunction,
  { onFile, onPageLink }: Actions,
): SlashCommand[] {
  const heading = (level: 1 | 2 | 3) => (editor: Editor, range: EditorRange) =>
    editor.chain().focus().deleteRange(range).toggleHeading({ level }).run();

  return [
    {
      id: "paragraph",
      label: t("tasks:detail.editor.slash.commands.paragraph"),
      group: "text",
      search: "text paragraph normal",
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).setParagraph().run(),
    },
    {
      id: "heading-1",
      label: t("pages:editor.slash.commands.heading-1"),
      group: "text",
      shortcut: "Ctrl Alt 1",
      search: "heading title h1",
      run: heading(1),
    },
    {
      id: "heading-2",
      label: t("pages:editor.slash.commands.heading-2"),
      group: "text",
      shortcut: "Ctrl Alt 2",
      search: "heading subtitle h2",
      run: heading(2),
    },
    {
      id: "heading-3",
      label: t("pages:editor.slash.commands.heading-3"),
      group: "text",
      shortcut: "Ctrl Alt 3",
      search: "heading h3",
      run: heading(3),
    },
    {
      id: "bullet-list",
      label: t("tasks:detail.editor.slash.commands.bullet-list"),
      group: "lists",
      shortcut: "Ctrl Alt 8",
      search: "list bullet unordered",
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      id: "ordered-list",
      label: t("tasks:detail.editor.slash.commands.ordered-list"),
      group: "lists",
      shortcut: "Ctrl Alt 9",
      search: "list ordered numbered",
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      id: "task-list",
      label: t("tasks:detail.editor.slash.commands.task-list"),
      group: "lists",
      search: "todo to-do checklist checkbox task list",
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      id: "blockquote",
      label: t("tasks:detail.editor.slash.commands.blockquote"),
      group: "insert",
      search: "quote blockquote",
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    calloutSlashCommand(t),
    {
      id: "code-block",
      label: t("tasks:detail.editor.slash.commands.code-block"),
      group: "insert",
      shortcut: "Ctrl Alt \\",
      search: "code snippet mermaid",
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
    {
      id: "divider",
      label: t("pages:editor.slash.commands.divider"),
      group: "insert",
      search: "divider horizontal rule line separator hr",
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
    {
      id: "table",
      label: t("tasks:detail.editor.slash.commands.table"),
      group: "insert",
      search: "table grid",
      run: (editor, range) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ cols: 3, rows: 3 })
          .run(),
    },
    {
      id: "file",
      label: t("tasks:detail.editor.slash.commands.file"),
      group: "insert",
      search: "file attachment image photo picture upload",
      run: (editor, range) => {
        editor.chain().focus().deleteRange(range).run();
        onFile(editor);
      },
    },
    {
      id: "page-link",
      label: t("pages:editor.slash.commands.page-link"),
      group: "insert",
      search: "page link wiki doc mention",
      run: (editor, range) => onPageLink(editor, range),
    },
  ];
}
