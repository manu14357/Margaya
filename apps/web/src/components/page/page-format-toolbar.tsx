import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Braces,
  Code,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  MessageSquareQuote,
  Minus,
  MoreHorizontal,
  Quote,
  Strikethrough,
  Table2,
  Underline,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import TextStyleMenu, {
  currentTextStyle,
  type TextStyleId,
} from "@/components/editor/text-style-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  openFilePicker,
  promptForLink,
} from "./page-editor/page-editor-actions";
import { useIsWideLayout } from "./page-side-panel";

const MOD =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform)
    ? "⌘"
    : "Ctrl";

type ActiveState = {
  style: TextStyleId | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  callout: boolean;
};

/**
 * What the toolbar shows as pressed. `useEditorState` compares the result
 * deeply, so the toolbar re-renders only when this set changes, not on
 * every keystroke.
 */
function selectActive(editor: Editor | null): ActiveState | null {
  if (!editor || editor.isDestroyed) return null;
  return {
    style: currentTextStyle(editor),
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    taskList: editor.isActive("taskList"),
    blockquote: editor.isActive("blockquote"),
    codeBlock: editor.isActive("codeBlock"),
    callout: editor.isActive("callout"),
  };
}

type Item = {
  id: string;
  label: string;
  Icon: LucideIcon;
  /** Toggles report their state; insert actions don't. */
  pressed?: boolean;
  disabled?: boolean;
  shortcut?: string[];
  run: () => void;
};

const BUTTON_CLASS =
  "relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-disabled:opacity-50 pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11";

function FormatButton({ item }: { item: Item }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ToolbarButton
            aria-label={item.label}
            aria-pressed={item.pressed}
            disabled={item.disabled}
            className={BUTTON_CLASS}
            onClick={item.run}
          />
        }
      >
        <item.Icon className="size-4" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {item.label}
        {item.shortcut && (
          <KbdGroup>
            {item.shortcut.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function Separator() {
  return (
    <ToolbarSeparator orientation="vertical" className="mx-1 h-4 self-center" />
  );
}

/**
 * Whether a page gets the formatting row at all: only while it can be
 * edited live, so never when read-only, locked, archived or showing an old
 * version. The user's preference then opens or collapses it.
 */
export function isFormatToolbarAvailable({
  editable,
  isLocked,
  isArchived,
  isPreviewingVersion,
}: {
  editable: boolean;
  isLocked: boolean;
  isArchived: boolean;
  isPreviewingVersion: boolean;
}) {
  return editable && !isLocked && !isArchived && !isPreviewingVersion;
}

type PageFormatToolbarProps = {
  editor: Editor | null;
  /** Off: the row collapses (it stays mounted so the collapse animates). */
  open: boolean;
  /** The panel toggle, pinned at the row's right edge. */
  trailing?: ReactNode;
};

/**
 * The fixed formatting row above an editable page (§3.3): text style,
 * marks, lists, blocks and inserts, aligned with the text column. Every
 * command runs through `editor.chain()`, like the slash and bubble menus,
 * so collaboration and undo see one kind of edit. Below 1024px the blocks
 * and inserts fold into "More".
 */
export default function PageFormatToolbar({
  editor,
  open,
  trailing,
}: PageFormatToolbarProps) {
  const { t } = useTranslation();
  const isWide = useIsWideLayout();
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => selectActive(current),
  });

  const chain = () => editor?.chain().focus();
  const inCode = Boolean(active?.codeBlock);

  const marks: Item[] = [
    {
      id: "bold",
      label: t("pages:toolbar.bold"),
      Icon: Bold,
      pressed: Boolean(active?.bold),
      disabled: inCode,
      shortcut: [MOD, "B"],
      run: () => chain()?.toggleBold().run(),
    },
    {
      id: "italic",
      label: t("pages:toolbar.italic"),
      Icon: Italic,
      pressed: Boolean(active?.italic),
      disabled: inCode,
      shortcut: [MOD, "I"],
      run: () => chain()?.toggleItalic().run(),
    },
    {
      id: "underline",
      label: t("pages:toolbar.underline"),
      Icon: Underline,
      pressed: Boolean(active?.underline),
      disabled: inCode,
      shortcut: [MOD, "U"],
      run: () => chain()?.toggleUnderline().run(),
    },
    {
      id: "strike",
      label: t("pages:toolbar.strike"),
      Icon: Strikethrough,
      pressed: Boolean(active?.strike),
      disabled: inCode,
      shortcut: [MOD, "Shift", "S"],
      run: () => chain()?.toggleStrike().run(),
    },
    {
      id: "code",
      label: t("pages:toolbar.inlineCode"),
      Icon: Code,
      pressed: Boolean(active?.code),
      disabled: inCode,
      shortcut: [MOD, "E"],
      run: () => chain()?.toggleCode().run(),
    },
  ];

  const lists: Item[] = [
    {
      id: "bulletList",
      label: t("tasks:detail.editor.slash.commands.bullet-list"),
      Icon: List,
      pressed: Boolean(active?.bulletList),
      shortcut: [MOD, "Shift", "8"],
      run: () => chain()?.toggleBulletList().run(),
    },
    {
      id: "orderedList",
      label: t("tasks:detail.editor.slash.commands.ordered-list"),
      Icon: ListOrdered,
      pressed: Boolean(active?.orderedList),
      shortcut: [MOD, "Shift", "7"],
      run: () => chain()?.toggleOrderedList().run(),
    },
    {
      id: "taskList",
      label: t("tasks:detail.editor.slash.commands.task-list"),
      Icon: ListTodo,
      pressed: Boolean(active?.taskList),
      shortcut: [MOD, "Shift", "9"],
      run: () => chain()?.toggleTaskList().run(),
    },
  ];

  const blocks: Item[] = [
    {
      id: "blockquote",
      label: t("tasks:detail.editor.slash.commands.blockquote"),
      Icon: Quote,
      pressed: Boolean(active?.blockquote),
      shortcut: [MOD, "Shift", "B"],
      run: () => chain()?.toggleBlockquote().run(),
    },
    {
      id: "codeBlock",
      label: t("tasks:detail.editor.slash.commands.code-block"),
      Icon: Braces,
      pressed: Boolean(active?.codeBlock),
      shortcut: [MOD, "Alt", "C"],
      run: () => chain()?.toggleCodeBlock().run(),
    },
    {
      id: "callout",
      label: t("tasks:detail.editor.slash.commands.callout"),
      Icon: MessageSquareQuote,
      pressed: Boolean(active?.callout),
      run: () => chain()?.toggleCallout().run(),
    },
  ];

  const inserts: Item[] = [
    {
      id: "link",
      label: t("pages:toolbar.link"),
      Icon: Link2,
      disabled: inCode,
      shortcut: [MOD, "K"],
      run: () => {
        if (editor) promptForLink(editor);
      },
    },
    {
      id: "table",
      label: t("tasks:detail.editor.slash.commands.table"),
      Icon: Table2,
      run: () => chain()?.insertTable({ cols: 3, rows: 3 }).run(),
    },
    {
      id: "image",
      label: t("pages:toolbar.image"),
      Icon: ImagePlus,
      run: () => {
        if (editor) openFilePicker(editor);
      },
    },
    {
      id: "divider",
      label: t("pages:editor.slash.commands.divider"),
      Icon: Minus,
      run: () => chain()?.setHorizontalRule().run(),
    },
  ];

  const groups = isWide ? [marks, lists, blocks, inserts] : [marks, lists];
  const overflow = isWide ? [] : [...blocks, ...inserts];

  return (
    <div
      className="margaya-page-format-row hidden md:grid"
      data-open={open}
      data-slot="page-format-toolbar"
      inert={!open}
    >
      <div>
        <div className="flex h-11 items-center border-border/80 border-b bg-background pe-3">
          <div className="margaya-page-format-inner min-w-0 flex-1">
            <TooltipProvider>
              <Toolbar
                aria-label={t("pages:toolbar.ariaLabel")}
                className="items-center gap-0.5 rounded-none border-0 bg-transparent p-0 not-dark:bg-transparent"
              >
                {editor && (
                  <TextStyleMenu
                    editor={editor}
                    current={active?.style ?? null}
                    trigger={<ToolbarButton />}
                    className={cn(inCode && "opacity-50")}
                  />
                )}
                {groups.map((group) => (
                  <Fragment key={group[0]?.id}>
                    <Separator />
                    <ToolbarGroup className="gap-0.5">
                      {group.map((item) => (
                        <FormatButton key={item.id} item={item} />
                      ))}
                    </ToolbarGroup>
                  </Fragment>
                ))}
                {overflow.length > 0 && (
                  <>
                    <Separator />
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <ToolbarButton
                            aria-label={t("pages:toolbar.more")}
                            className={BUTTON_CLASS}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48">
                        {overflow.map((item) => (
                          <DropdownMenuItem
                            key={item.id}
                            disabled={item.disabled}
                            onClick={item.run}
                            className={cn(
                              item.pressed && "font-medium text-foreground",
                            )}
                          >
                            <item.Icon className="size-3.5" />
                            {item.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </Toolbar>
            </TooltipProvider>
          </div>
          {trailing}
        </div>
      </div>
    </div>
  );
}
