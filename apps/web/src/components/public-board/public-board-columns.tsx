import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import { remainingInGroup } from "@/lib/public-board/board-state";
import type {
  PublicBoard,
  PublicBoardColumn,
  PublicTaskPage,
} from "@/types/public-board";
import PublicTaskCard from "./public-task-card";

export type PublicBoardLayoutProps = {
  board: PublicBoard;
  page: PublicTaskPage;
  onOpenTask: (number: number) => void;
  onLoadMore: (group: string) => void;
  isLoadingMore: (group: string) => boolean;
};

export function columnLabel(
  column: PublicBoardColumn,
  backlog: string,
): string {
  return column.slug === "planned" ? backlog : column.name;
}

const columnDomId = (slug: string) => `public-column-${slug}`;

/**
 * One 296px well per board column, scrolling sideways. Below `md` it is a
 * column pager: a strip of stage chips over one snapped column at a time.
 */
export default function PublicBoardColumns({
  board,
  page,
  onOpenTask,
  onLoadMore,
  isLoadingMore,
}: PublicBoardLayoutProps) {
  const { t } = useTranslation();
  const backlog = t("publicProject:board.backlog");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeSlug, setActiveSlug] = useState(board.columns[0]?.slug ?? "");
  const slugs = board.columns.map((column) => column.slug).join(" ");

  // The pager follows swipes: the column that fills most of the scroller
  // is the active chip.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const slug = visible?.target.getAttribute("data-column");
        if (slug) setActiveSlug(slug);
      },
      { root, threshold: [0.6] },
    );
    for (const slug of slugs.split(" ")) {
      const section = document.getElementById(columnDomId(slug));
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, [slugs]);

  const jumpTo = (slug: string) => {
    setActiveSlug(slug);
    const target = document.getElementById(columnDomId(slug));
    target?.scrollIntoView({
      behavior: "smooth",
      inline: "start",
      block: "nearest",
    });
  };

  return (
    <TooltipProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        <nav
          aria-label={t("publicProject:board.sections.status")}
          className="flex shrink-0 gap-1.5 overflow-x-auto px-3 pt-2 md:hidden"
        >
          {board.columns.map((column) => {
            const group = page.groups.find(
              (entry) => entry.key === column.slug,
            );
            const active = activeSlug === column.slug;
            return (
              <button
                key={column.slug}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => jumpTo(column.slug)}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                  active
                    ? "border-primary/30 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {getColumnIcon(
                  column.slug,
                  column.isFinal,
                  column.icon,
                  column.group,
                  { neutral: true },
                )}
                <span className="max-w-32 truncate">
                  {columnLabel(column, backlog)}
                </span>
                <span className="tabular-nums">{group?.count ?? 0}</span>
              </button>
            );
          })}
        </nav>

        <div
          ref={scrollerRef}
          className="min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] md:snap-none"
        >
          <div className="flex h-full w-max gap-2 p-2 md:gap-3 md:p-3">
            {board.columns.map((column) => {
              const group = page.groups.find(
                (entry) => entry.key === column.slug,
              );
              const taskIds = group?.taskIds ?? [];
              const remaining = group ? remainingInGroup(group) : 0;
              const name = columnLabel(column, backlog);
              return (
                <section
                  key={column.slug}
                  id={columnDomId(column.slug)}
                  data-column={column.slug}
                  aria-label={name}
                  className="flex h-full w-[calc(100vw-(--spacing(4)))] shrink-0 snap-start flex-col rounded-xl bg-muted md:w-74"
                >
                  <header className="flex h-9 shrink-0 items-center gap-2 px-3">
                    {getColumnIcon(
                      column.slug,
                      column.isFinal,
                      column.icon,
                      column.group,
                      { neutral: true },
                    )}
                    <h3 className="truncate font-medium text-foreground text-sm">
                      {name}
                    </h3>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {group?.count ?? 0}
                    </span>
                  </header>
                  <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2 [-webkit-overflow-scrolling:touch]">
                    <div className="flex flex-col gap-1.5">
                      {taskIds.map((id) => {
                        const row = page.tasks[id];
                        if (!row) return null;
                        return (
                          <PublicTaskCard
                            key={id}
                            row={row}
                            board={board.board}
                            group={column.group}
                            isCompleted={column.isFinal}
                            onOpen={onOpenTask}
                          />
                        );
                      })}
                    </div>
                    {taskIds.length === 0 && (
                      <p className="mt-1 rounded-lg border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-xs">
                        {t("publicProject:board.emptyColumn")}
                      </p>
                    )}
                    {remaining > 0 && group?.nextCursor && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1.5 w-full"
                        disabled={isLoadingMore(column.slug)}
                        onClick={() => onLoadMore(column.slug)}
                      >
                        {t("publicProject:board.loadMore", {
                          count: remaining,
                        })}
                      </Button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
