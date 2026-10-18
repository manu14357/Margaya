import type { ChainedCommands, Editor } from "@tiptap/core";
import {
  ChevronDown,
  Heading1,
  Heading2,
  Heading3,
  type LucideIcon,
  Pilcrow,
} from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/cn";

export type TextStyleId = "paragraph" | "heading1" | "heading2" | "heading3";

type TextStyle = {
  id: TextStyleId;
  Icon: LucideIcon;
  labelKey: string;
  level?: 1 | 2 | 3;
};

export const TEXT_STYLES: readonly TextStyle[] = [
  {
    id: "paragraph",
    Icon: Pilcrow,
    labelKey: "tasks:detail.editor.slash.commands.paragraph",
  },
  {
    id: "heading1",
    Icon: Heading1,
    labelKey: "pages:editor.slash.commands.heading-1",
    level: 1,
  },
  {
    id: "heading2",
    Icon: Heading2,
    labelKey: "pages:editor.slash.commands.heading-2",
    level: 2,
  },
  {
    id: "heading3",
    Icon: Heading3,
    labelKey: "pages:editor.slash.commands.heading-3",
    level: 3,
  },
];

/** The text style of the block holding the selection, if it has one. */
export function currentTextStyle(editor: Editor): TextStyleId | null {
  for (const style of TEXT_STYLES) {
    if (
      style.level
        ? editor.isActive("heading", { level: style.level })
        : editor.isActive("paragraph")
    ) {
      return style.id;
    }
  }
  return null;
}

/** Turns the selection's block into `style`, through the shared chain. */
export function applyTextStyle(editor: Editor, style: TextStyleId) {
  const definition = TEXT_STYLES.find((entry) => entry.id === style);
  if (!definition) return;
  const chain: ChainedCommands = editor.chain().focus();
  if (definition.level) chain.setHeading({ level: definition.level }).run();
  else chain.setParagraph().run();
}

type TextStyleMenuProps = {
  editor: Editor;
  current: TextStyleId | null;
  /** The trigger element, e.g. a toolbar button; a plain button otherwise. */
  trigger?: ReactElement;
  className?: string;
};

/**
 * "Text ▾": turns the current block into Text or Heading 1-3; the current
 * style is the checked radio item.
 */
export default function TextStyleMenu({
  editor,
  current,
  trigger,
  className,
}: TextStyleMenuProps) {
  const { t } = useTranslation();
  const active = TEXT_STYLES.find((style) => style.id === current);
  const label = active
    ? t(active.labelKey)
    : t("tasks:detail.editor.slash.commands.paragraph");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={trigger ?? <button type="button" />}
        className={cn(
          "group/text-style inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 font-medium text-[13px] text-foreground outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent",
          className,
        )}
      >
        <span className="sr-only">{t("pages:toolbar.textStyle")}: </span>
        <span className="max-w-24 truncate">{label}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3 text-muted-foreground transition-transform duration-150 group-data-popup-open/text-style:rotate-180 motion-reduce:transition-none"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuRadioGroup
          value={current ?? ""}
          onValueChange={(value) =>
            applyTextStyle(editor, value as TextStyleId)
          }
        >
          {TEXT_STYLES.map((style) => (
            <DropdownMenuRadioItem key={style.id} value={style.id} closeOnClick>
              <span className="flex items-center gap-2">
                <style.Icon className="size-3.5 text-muted-foreground" />
                {t(style.labelKey)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
