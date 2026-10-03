import { Layout, List, ListFilter, Search } from "lucide-react";
import { createElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import {
  activeFilterCount,
  type BoardView,
} from "@/lib/public-board/search-params";
import type { PublicBoard, PublicLayout } from "@/types/public-board";
import PublicBoardSearch from "./public-board-search";
import PublicFilterChips from "./public-filter-chips";
import PublicFilterPopover, { CLEARED_FILTERS } from "./public-filter-popover";
import PublicFilterSections, {
  type BoardViewChange,
} from "./public-filter-sections";
import PublicSortSelect from "./public-sort-select";

type PublicBoardToolbarProps = {
  board: PublicBoard;
  view: BoardView;
  onChange: BoardViewChange;
};

const LAYOUT_ICONS: Record<PublicLayout, typeof Layout> = {
  board: Layout,
  list: List,
};

/**
 * Under the top bar: the layout tabs, then the lens (Filter and its
 * active chips) and Sort on the right. Below `md` the lens folds into a
 * Filters sheet that also holds search and sort; the chips get their own
 * scrolling strip so the active filters stay visible.
 */
export default function PublicBoardToolbar({
  board,
  view,
  onChange,
}: PublicBoardToolbarProps) {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const filterCount = activeFilterCount(view);
  const hasLayouts = board.board.layouts.length > 1;

  return (
    <div className="shrink-0 border-border border-b bg-background">
      <div className="flex h-10 items-center gap-2 px-3 md:px-4">
        {hasLayouts && (
          <Tabs
            value={view.layout}
            onValueChange={(layout) =>
              onChange({ layout: layout as PublicLayout })
            }
          >
            <TabsList
              variant="underline"
              aria-label={t("publicProject:board.layout")}
              className="h-10 gap-1 py-0"
            >
              {board.board.layouts.map((layout) => (
                <TabsTab
                  key={layout}
                  value={layout}
                  className="h-7 grow-0 gap-1.5 px-2 text-xs sm:h-7 sm:text-sm"
                >
                  {createElement(LAYOUT_ICONS[layout], {
                    className: "size-3.5",
                    "aria-hidden": true,
                  })}
                  {layout === "board"
                    ? t("tasks:view.board")
                    : t("tasks:view.list")}
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>
        )}
        {hasLayouts && (
          <div
            className="h-4 w-px shrink-0 bg-border max-md:hidden"
            aria-hidden="true"
          />
        )}

        <div className="flex min-w-0 flex-1 items-center gap-2 max-md:hidden">
          <PublicFilterPopover board={board} view={view} onChange={onChange} />
          <PublicFilterChips
            board={board}
            view={view}
            onChange={onChange}
            className="min-w-0 flex-1 flex-nowrap overflow-x-auto"
          />
        </div>
        <div className="max-md:hidden">
          <PublicSortSelect
            sorts={board.sorts}
            value={view.sort}
            onChange={(sort) => onChange({ sort })}
          />
        </div>

        <div className="ml-auto flex items-center gap-1.5 md:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("publicProject:board.searchPlaceholder")}
            className={cn(view.q && "bg-accent")}
            onClick={() => setSheetOpen(true)}
          >
            <Search className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 gap-1.5",
              filterCount > 0 && "border-primary/30 bg-primary/10 text-primary",
            )}
            onClick={() => setSheetOpen(true)}
          >
            <ListFilter className="size-3.5" />
            <span className="text-xs">{t("publicProject:board.filters")}</span>
            {filterCount > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-medium text-[10px] text-primary-foreground tabular-nums">
                {filterCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {filterCount > 0 && (
        <PublicFilterChips
          board={board}
          view={view}
          onChange={onChange}
          className="flex-nowrap overflow-x-auto border-border border-t px-3 py-1.5 md:hidden"
        />
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{t("publicProject:board.filters")}</SheetTitle>
          </SheetHeader>
          <SheetPanel className="space-y-4">
            <PublicBoardSearch
              value={view.q}
              onChange={(q) => onChange({ q })}
            />
            <PublicSortSelect
              sorts={board.sorts}
              value={view.sort}
              onChange={(sort) => onChange({ sort })}
            />
            <PublicFilterSections
              board={board}
              view={view}
              onChange={onChange}
            />
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={filterCount === 0}
              onClick={() => onChange(CLEARED_FILTERS)}
            >
              {t("publicProject:board.clearFilters")}
            </Button>
          </SheetPanel>
        </SheetContent>
      </Sheet>
    </div>
  );
}
