import type { Editor } from "@tiptap/core";
import { ListTree } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/cn";
import {
  type OutlineHeading,
  outlineFromDoc,
} from "@/lib/pages/editor-document";
import { useEditorRevision } from "./use-editor-revision";

const INDENT: Record<OutlineHeading["level"], string> = {
  1: "ps-2",
  2: "ps-5",
  3: "ps-8",
};

/** H1-H3 of the live document; a click jumps to the heading. */
export default function PageOutline({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation();
  const revision = useEditorRevision(editor);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision tracks document changes
  const headings = useMemo(
    () =>
      editor && !editor.isDestroyed ? outlineFromDoc(editor.state.doc) : [],
    [editor, revision],
  );

  const jumpTo = (heading: OutlineHeading) => {
    if (!editor || editor.isDestroyed) return;
    const inside = heading.pos + 1;
    editor.chain().focus().setTextSelection(inside).run();
    const dom = editor.view.nodeDOM(heading.pos);
    if (dom instanceof HTMLElement) {
      dom.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };

  if (headings.length === 0) {
    return (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListTree />
          </EmptyMedia>
          <EmptyTitle>{t("pages:outline.empty.title")}</EmptyTitle>
          <EmptyDescription>
            {t("pages:outline.empty.description")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <nav aria-label={t("pages:panel.outline")}>
      <ul className="space-y-0.5">
        {headings.map((heading) => (
          <li key={heading.pos}>
            <button
              type="button"
              onClick={() => jumpTo(heading)}
              className={cn(
                "w-full truncate rounded-md py-1 pe-2 text-left text-sm hover:bg-accent",
                INDENT[heading.level],
                heading.level === 1 ? "font-medium" : "text-muted-foreground",
              )}
            >
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
