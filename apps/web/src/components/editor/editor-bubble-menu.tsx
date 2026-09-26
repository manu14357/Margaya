import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { LucideIcon } from "lucide-react";
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Braces,
  Code,
  Columns3,
  Grid2x2X,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Rows3,
  Strikethrough,
  Table2,
  Underline as UnderlineIcon,
} from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type BubbleButton = {
  key: string;
  Icon: LucideIcon;
  isActive?: boolean;
  destructive?: boolean;
  title?: string;
  onClick: () => void;
};

function BubbleButtons({ groups }: { groups: BubbleButton[][] }) {
  return groups.map((group, index) => (
    <Fragment key={group[0]?.key ?? index}>
      {index > 0 && <span className="margaya-tiptap-bubble-separator" />}
      {group.map(({ key, Icon, isActive, destructive, title, onClick }) => (
        <Button
          key={key}
          type="button"
          variant="ghost"
          size="xs"
          title={title}
          aria-label={title}
          className={cn(
            "margaya-tiptap-bubble-btn",
            isActive && "bg-accent text-accent-foreground",
            destructive && "text-destructive",
          )}
          onClick={onClick}
        >
          <Icon className="size-3.5" />
        </Button>
      ))}
    </Fragment>
  ));
}

/**
 * The formatting bubble over a text selection and the table bubble inside a
 * table, as in the task description editor.
 */
export default function EditorBubbleMenu({
  editor,
  onSetLink,
}: {
  editor: Editor;
  onSetLink: () => void;
}) {
  const { t } = useTranslation();
  // Re-render on every transaction so the active marks stay current.
  useEditorState({ editor, selector: (context) => context.transactionNumber });
  const chain = () => editor.chain().focus();

  const formatting: BubbleButton[][] = [
    [
      {
        key: "heading",
        Icon: Heading2,
        isActive: editor.isActive("heading", { level: 2 }),
        onClick: () => chain().toggleHeading({ level: 2 }).run(),
      },
      {
        key: "bullet",
        Icon: List,
        isActive: editor.isActive("bulletList"),
        onClick: () => chain().toggleBulletList().run(),
      },
      {
        key: "todo",
        Icon: ListTodo,
        isActive: editor.isActive("taskList"),
        onClick: () => chain().toggleTaskList().run(),
      },
      {
        key: "ordered",
        Icon: ListOrdered,
        isActive: editor.isActive("orderedList"),
        onClick: () => chain().toggleOrderedList().run(),
      },
      {
        key: "quote",
        Icon: Quote,
        isActive: editor.isActive("blockquote"),
        onClick: () => chain().toggleBlockquote().run(),
      },
      {
        key: "code-block",
        Icon: Braces,
        isActive: editor.isActive("codeBlock"),
        onClick: () => chain().toggleCodeBlock().run(),
      },
      {
        key: "table",
        Icon: Table2,
        onClick: () => chain().insertTable({ cols: 3, rows: 3 }).run(),
      },
    ],
    [
      {
        key: "bold",
        Icon: Bold,
        isActive: editor.isActive("bold"),
        onClick: () => chain().toggleBold().run(),
      },
      {
        key: "italic",
        Icon: Italic,
        isActive: editor.isActive("italic"),
        onClick: () => chain().toggleItalic().run(),
      },
      {
        key: "underline",
        Icon: UnderlineIcon,
        isActive: editor.isActive("underline"),
        onClick: () => chain().toggleUnderline().run(),
      },
      {
        key: "strike",
        Icon: Strikethrough,
        isActive: editor.isActive("strike"),
        onClick: () => chain().toggleStrike().run(),
      },
      {
        key: "code",
        Icon: Code,
        isActive: editor.isActive("code"),
        onClick: () => chain().toggleCode().run(),
      },
      {
        key: "link",
        Icon: Link2,
        isActive: editor.isActive("link"),
        onClick: onSetLink,
      },
    ],
  ];

  const table: BubbleButton[][] = [
    [
      {
        key: "col-before",
        Icon: BetweenVerticalStart,
        title: t("tasks:editor.table.addColumnBefore", {
          defaultValue: "Insert column left",
        }),
        onClick: () => chain().addColumnBefore().run(),
      },
      {
        key: "col-after",
        Icon: BetweenVerticalEnd,
        title: t("tasks:editor.table.addColumnAfter", {
          defaultValue: "Insert column right",
        }),
        onClick: () => chain().addColumnAfter().run(),
      },
      {
        key: "col-delete",
        Icon: Columns3,
        destructive: true,
        title: t("tasks:editor.table.deleteColumn", {
          defaultValue: "Delete column",
        }),
        onClick: () => chain().deleteColumn().run(),
      },
    ],
    [
      {
        key: "row-before",
        Icon: BetweenHorizontalStart,
        title: t("tasks:editor.table.addRowBefore", {
          defaultValue: "Insert row above",
        }),
        onClick: () => chain().addRowBefore().run(),
      },
      {
        key: "row-after",
        Icon: BetweenHorizontalEnd,
        title: t("tasks:editor.table.addRowAfter", {
          defaultValue: "Insert row below",
        }),
        onClick: () => chain().addRowAfter().run(),
      },
      {
        key: "row-delete",
        Icon: Rows3,
        destructive: true,
        title: t("tasks:editor.table.deleteRow", {
          defaultValue: "Delete row",
        }),
        onClick: () => chain().deleteRow().run(),
      },
    ],
    [
      {
        key: "table-delete",
        Icon: Grid2x2X,
        destructive: true,
        title: t("tasks:editor.table.deleteTable", {
          defaultValue: "Delete table",
        }),
        onClick: () => chain().deleteTable().run(),
      },
    ],
  ];

  return (
    <>
      <BubbleMenu
        editor={editor}
        className="margaya-tiptap-bubble"
        shouldShow={({ editor: activeEditor, from, to }) => {
          if (activeEditor.isActive("embedBlock")) return false;
          if (activeEditor.isActive("image")) return false;
          if (activeEditor.isEmpty) return false;
          return from !== to;
        }}
      >
        <BubbleButtons groups={formatting} />
      </BubbleMenu>
      <BubbleMenu
        editor={editor}
        pluginKey="margaya-table-bubble"
        className="margaya-tiptap-bubble"
        shouldShow={({ editor: activeEditor, from, to }) =>
          activeEditor.isActive("table") && from === to
        }
      >
        <BubbleButtons groups={table} />
      </BubbleMenu>
    </>
  );
}
