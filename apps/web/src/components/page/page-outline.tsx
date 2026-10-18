import type { Editor } from "@tiptap/core";
import { ListTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/cn";
import type { OutlineHeading } from "@/lib/pages/editor-document";
import { jumpToHeading, usePageHeadings } from "./use-page-headings";

const LEVEL_CLASS: Record<OutlineHeading["level"], string> = {
  1: "ps-1 font-medium text-[13px] text-foreground/80",
  2: "ps-3 text-muted-foreground text-xs",
  3: "ps-6 text-muted-foreground text-xs",
};

type OutlineRowsProps = {
  headings: OutlineHeading[];
  activePos: number | null;
  onJump: (heading: OutlineHeading) => void;
  /** Hidden rows (a closed hover card) stay out of the tab order. */
  tabIndex?: number;
};

/** The heading rows shared by the side pane and the floating outline. */
export function OutlineRows({
  headings,
  activePos,
  onJump,
  tabIndex,
}: OutlineRowsProps) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-px">
      {headings.map((heading) => {
        const active = heading.pos === activePos;
        return (
          <li key={heading.pos}>
            <button
              type="button"
              tabIndex={tabIndex}
              aria-current={active ? "location" : undefined}
              onClick={() => onJump(heading)}
              className={cn(
                "w-full truncate rounded-md py-1 pe-2 text-left outline-none transition-colors duration-150 hover:bg-accent/50 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring",
                LEVEL_CLASS[heading.level],
                active && "font-medium text-foreground",
              )}
            >
              {heading.text}
              {active && (
                <span className="sr-only">
                  {" "}
                  ({t("pages:detail.currentSection")})
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** H1-H3 of the live document; a click jumps to the heading. */
export default function PageOutline({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation();
  const { headings, activePos } = usePageHeadings(editor);

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
      <OutlineRows
        headings={headings}
        activePos={activePos}
        onJump={(heading) => jumpToHeading(editor, heading)}
      />
    </nav>
  );
}
