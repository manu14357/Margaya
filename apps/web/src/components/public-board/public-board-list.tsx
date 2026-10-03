import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getColumnIcon } from "@/lib/column";
import { remainingInGroup } from "@/lib/public-board/board-state";
import {
  columnLabel,
  type PublicBoardLayoutProps,
} from "./public-board-columns";
import PublicTaskRow from "./public-task-row";

const STORAGE_PREFIX = "margaya-public-board-collapsed:";

// Collapsed sections are a per-viewer convenience: storage may be missing
// (private windows) and the list must render without it.
function readCollapsed(token: string): string[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${token}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function writeCollapsed(token: string, slugs: string[]) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${token}`, JSON.stringify(slugs));
  } catch {
    // Not saved; the sections still collapse for this visit.
  }
}

/**
 * One collapsible section per column under a sticky overline header,
 * with compact rows and the same paging as the board.
 */
export default function PublicBoardList({
  token,
  board,
  page,
  onOpenTask,
  onLoadMore,
  isLoadingMore,
}: PublicBoardLayoutProps & { token: string }) {
  const { t } = useTranslation();
  const backlog = t("publicProject:board.backlog");
  const [collapsed, setCollapsed] = useState(() => readCollapsed(token));

  const toggle = useCallback(
    (slug: string) => {
      setCollapsed((current) => {
        const next = current.includes(slug)
          ? current.filter((entry) => entry !== slug)
          : [...current, slug];
        writeCollapsed(token, next);
        return next;
      });
    },
    [token],
  );

  return (
    <TooltipProvider>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {board.columns.map((column) => {
          const group = page.groups.find((entry) => entry.key === column.slug);
          const taskIds = group?.taskIds ?? [];
          const remaining = group ? remainingInGroup(group) : 0;
          const name = columnLabel(column, backlog);
          const isCollapsed = collapsed.includes(column.slug);
          const sectionId = `public-list-${column.slug}`;
          return (
            <section key={column.slug} aria-label={name}>
              <button
                type="button"
                className="sticky top-0 z-[1] flex h-8 w-full items-center gap-2 border-border border-b bg-[linear-gradient(var(--color-muted),var(--color-muted))] bg-background px-3 text-left md:px-4 [&:hover_h3]:text-foreground"
                aria-expanded={!isCollapsed}
                aria-controls={sectionId}
                onClick={() => toggle(column.slug)}
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                )}
                {getColumnIcon(
                  column.slug,
                  column.isFinal,
                  column.icon,
                  column.group,
                )}
                <h3 className="truncate font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
                  {name}
                </h3>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {group?.count ?? 0}
                </span>
              </button>
              {!isCollapsed && (
                <div id={sectionId} className="px-1 py-1 md:px-2">
                  <ul className="divide-y divide-border/60">
                    {taskIds.map((id) => {
                      const row = page.tasks[id];
                      if (!row) return null;
                      return (
                        <li key={id} className="py-px">
                          <PublicTaskRow
                            row={row}
                            board={board.board}
                            isCompleted={column.isFinal}
                            onOpen={onOpenTask}
                          />
                        </li>
                      );
                    })}
                  </ul>
                  {taskIds.length === 0 && (
                    <p className="px-2 py-3 text-muted-foreground text-xs">
                      {t("publicProject:board.emptyColumn")}
                    </p>
                  )}
                  {remaining > 0 && group?.nextCursor && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-muted-foreground"
                      disabled={isLoadingMore(column.slug)}
                      onClick={() => onLoadMore(column.slug)}
                    >
                      {t("publicProject:board.loadMore", {
                        count: remaining,
                      })}
                    </Button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
