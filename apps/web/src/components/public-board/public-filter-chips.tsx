import { useTranslation } from "react-i18next";
import { ActiveFilterChip } from "@/components/task-filters/filter-primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getPriorityLabel } from "@/lib/i18n/domain";
import {
  activeFilterCount,
  type BoardView,
} from "@/lib/public-board/search-params";
import type { PublicBoard } from "@/types/public-board";
import { CLEARED_FILTERS } from "./public-filter-popover";
import type { BoardViewChange } from "./public-filter-sections";

type PublicFilterChipsProps = {
  board: PublicBoard;
  view: BoardView;
  onChange: BoardViewChange;
  className?: string;
};

/** "Status: In progress ×" chips in the lens bar, and Clear filters. */
export default function PublicFilterChips({
  board,
  view,
  onChange,
  className,
}: PublicFilterChipsProps) {
  const { t } = useTranslation();
  if (activeFilterCount(view) === 0) return null;

  const columnName = (slug: string) =>
    slug === "planned"
      ? t("publicProject:board.backlog")
      : (board.columns.find((column) => column.slug === slug)?.name ?? slug);

  const chips = [
    {
      key: "status",
      subject: t("publicProject:board.sections.status"),
      values: view.status.map(columnName),
      clear: { status: [] },
    },
    {
      key: "priority",
      subject: t("publicProject:board.sections.priority"),
      values: view.priority.map(getPriorityLabel),
      clear: { priority: [] },
    },
    {
      key: "label",
      subject: t("publicProject:board.sections.labels"),
      values: view.label,
      clear: { label: [] },
    },
  ].filter((chip) => chip.values.length > 0);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {chips.map((chip) => {
        const value = chip.values.join(", ");
        return (
          <fieldset
            key={chip.key}
            aria-label={t("publicProject:board.chip", {
              subject: chip.subject,
              value,
            })}
            className="m-0 min-w-0 max-w-full shrink-0 border-0 p-0"
          >
            <ActiveFilterChip
              subject={chip.subject}
              operator={value}
              onClear={() => onChange(chip.clear)}
              clearLabel={t("publicProject:board.removeFilter", {
                subject: chip.subject,
              })}
              className="max-w-full"
            />
          </fieldset>
        );
      })}
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0 text-muted-foreground"
        onClick={() => onChange(CLEARED_FILTERS)}
      >
        {t("publicProject:board.clearFilters")}
      </Button>
    </div>
  );
}
