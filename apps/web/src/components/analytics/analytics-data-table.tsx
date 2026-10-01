import { parseISO } from "date-fns";
import { ArrowDown, ArrowUp } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isDayKey } from "@/lib/analytics/labels";
import { nextSort, type TableSort } from "@/lib/analytics/sort";
import {
  applyTableSort,
  isNumericColumn,
  type TableCell as ModelCell,
  type TableRow as ModelRow,
  type TableColumn,
  type TableModel,
} from "@/lib/analytics/table-model";
import { cn } from "@/lib/cn";
import { formatDateMedium, formatNumber } from "@/lib/format";

/** Rows shown before "Show all": tables stay short without virtualization. */
export const TABLE_PAGE_SIZE = 100;

/** A table model with its sort: the same rows feed the screen and the CSV. */
export function useSortedTable(
  model: TableModel | null,
  initial: TableSort = null,
) {
  const [sort, setSort] = useState<TableSort>(initial);
  const sorted = useMemo(
    () => (model ? applyTableSort(model, sort) : null),
    [model, sort],
  );
  return { sort, setSort, model: sorted };
}

export function formatTableCell(
  column: TableColumn,
  value: ModelCell,
): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  if (typeof value === "number") {
    return column.kind === "percent" ? `${value}%` : formatNumber(value);
  }
  if (column.kind === "date" && isDayKey(value)) {
    return formatDateMedium(parseISO(value));
  }
  return value;
}

type AnalyticsDataTableProps = {
  model: TableModel;
  sort: TableSort;
  onSortChange: (sort: TableSort) => void;
  /** Custom content for a cell; undefined falls back to the formatted value. */
  renderCell?: (column: TableColumn, row: ModelRow) => ReactNode | undefined;
  onRowClick?: (row: ModelRow) => void;
  className?: string;
};

/**
 * A sortable table of an analytics model: numbers right-aligned, the first
 * column sticky on narrow screens, the distinct "Total" row in the footer.
 */
export default function AnalyticsDataTable({
  model,
  sort,
  onSortChange,
  renderCell,
  onRowClick,
  className,
}: AnalyticsDataTableProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const rows =
    showAll || model.rows.length <= TABLE_PAGE_SIZE
      ? model.rows
      : model.rows.slice(0, TABLE_PAGE_SIZE);

  const cellContent = (column: TableColumn, row: ModelRow) =>
    renderCell?.(column, row) ??
    formatTableCell(column, row.cells[column.id] ?? null);

  const alignClass = (column: TableColumn) =>
    isNumericColumn(column) ? "text-right tabular-nums" : "text-left";
  const stickyClass = (index: number) =>
    index === 0 ? "sticky left-0 z-[1] bg-card" : undefined;

  return (
    <div className={cn("min-w-0", className)}>
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            {model.columns.map((column, index) => {
              const active = sort?.columnId === column.id;
              const ariaSort = active
                ? sort?.direction === "asc"
                  ? "ascending"
                  : "descending"
                : "none";
              return (
                <TableHead
                  key={column.id}
                  aria-sort={ariaSort}
                  className={cn(
                    "h-8 whitespace-nowrap px-2 font-medium text-foreground",
                    alignClass(column),
                    stickyClass(index),
                  )}
                >
                  <button
                    type="button"
                    aria-label={t("analytics:table.sortBy", {
                      column: column.label,
                    })}
                    onClick={() =>
                      onSortChange(
                        nextSort(sort, column.id, isNumericColumn(column)),
                      )
                    }
                    className={cn(
                      "inline-flex items-center gap-1 rounded-sm hover:text-foreground",
                      isNumericColumn(column) && "flex-row-reverse",
                      !active && "text-muted-foreground",
                    )}
                  >
                    <span>{column.label}</span>
                    {active &&
                      (sort?.direction === "asc" ? (
                        <ArrowUp aria-hidden className="size-3" />
                      ) : (
                        <ArrowDown aria-hidden className="size-3" />
                      ))}
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(onRowClick && "cursor-pointer")}
            >
              {model.columns.map((column, index) => (
                <TableCell
                  key={column.id}
                  className={cn(
                    "px-2 py-1.5",
                    alignClass(column),
                    stickyClass(index),
                    index === 0 && "max-w-64",
                    row.alert?.includes(column.id) &&
                      "text-destructive-foreground",
                  )}
                >
                  {cellContent(column, row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {model.total && (
          <TableFooter>
            <TableRow>
              {model.columns.map((column, index) => (
                <TableCell
                  key={column.id}
                  className={cn(
                    "px-2 py-1.5 font-medium",
                    alignClass(column),
                    stickyClass(index),
                  )}
                >
                  {model.total
                    ? formatTableCell(
                        column,
                        model.total.cells[column.id] ?? null,
                      )
                    : null}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        )}
      </Table>
      {rows.length < model.rows.length && (
        <div className="flex justify-center pt-2">
          <Button variant="ghost" size="xs" onClick={() => setShowAll(true)}>
            {t("analytics:table.showAll", { count: model.rows.length })}
          </Button>
        </div>
      )}
    </div>
  );
}
