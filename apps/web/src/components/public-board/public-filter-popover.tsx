import { ListFilter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import {
  activeFilterCount,
  type BoardView,
} from "@/lib/public-board/search-params";
import type { PublicBoard } from "@/types/public-board";
import PublicFilterSections, {
  type BoardViewChange,
} from "./public-filter-sections";

type PublicFilterPopoverProps = {
  board: PublicBoard;
  view: BoardView;
  onChange: BoardViewChange;
};

export const CLEARED_FILTERS: Partial<BoardView> = {
  status: [],
  priority: [],
  label: [],
};

/** The Filter button: Status, Priority and Labels, with Clear filters. */
export default function PublicFilterPopover({
  board,
  view,
  onChange,
}: PublicFilterPopoverProps) {
  const { t } = useTranslation();
  const count = activeFilterCount(view);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 gap-1.5",
              count > 0 && "border-primary/30 bg-primary/10 text-primary",
            )}
          />
        }
      >
        <ListFilter className="size-3.5" />
        <span className="text-xs">{t("publicProject:board.filter")}</span>
        {count > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-medium text-[10px] text-primary-foreground">
            {count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="max-h-[60vh] overflow-y-auto">
          <PublicFilterSections board={board} view={view} onChange={onChange} />
        </div>
        <div className="mt-2 border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={count === 0}
            onClick={() => onChange(CLEARED_FILTERS)}
          >
            {t("publicProject:board.clearFilters")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
