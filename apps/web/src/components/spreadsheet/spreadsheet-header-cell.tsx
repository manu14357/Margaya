import { ArrowDown, ArrowUp, EyeOff, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import type { OrderBy, OrderByField } from "@/lib/task-query/model";

type SpreadsheetHeaderCellProps = {
  label: string;
  width: number;
  sortField: OrderByField | null;
  orderBy: OrderBy;
  onSort: (orderBy: OrderBy | null) => void;
  onHide: () => void;
};

/** A column header: sort ascending or descending, clear the sort, hide. */
export default function SpreadsheetHeaderCell({
  label,
  width,
  sortField,
  orderBy,
  onSort,
  onHide,
}: SpreadsheetHeaderCellProps) {
  const { t } = useTranslation();
  const isSorted = sortField !== null && orderBy.field === sortField;
  const direction = isSorted ? orderBy.direction : null;

  return (
    <th
      scope="col"
      aria-sort={
        direction === "asc"
          ? "ascending"
          : direction === "desc"
            ? "descending"
            : "none"
      }
      style={{ width, minWidth: width, maxWidth: width }}
      className="sticky top-0 z-10 h-8 border-border border-b border-l bg-muted p-0 text-left align-middle font-medium text-muted-foreground text-xs pointer-coarse:h-11"
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="flex h-8 w-full items-center gap-1 px-2 text-left outline-none hover:bg-accent/60 hover:text-foreground pointer-coarse:h-11"
            />
          }
        >
          <span className="truncate">{label}</span>
          {direction === "asc" && <ArrowUp className="size-3 shrink-0" />}
          {direction === "desc" && <ArrowDown className="size-3 shrink-0" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          {sortField && (
            <>
              <DropdownMenuItem
                className="h-8 text-sm"
                onClick={() => onSort({ field: sortField, direction: "asc" })}
              >
                <ArrowUp className="size-3.5" />
                {t("tasks:spreadsheet.sortAsc")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="h-8 text-sm"
                onClick={() => onSort({ field: sortField, direction: "desc" })}
              >
                <ArrowDown className="size-3.5" />
                {t("tasks:spreadsheet.sortDesc")}
              </DropdownMenuItem>
              {isSorted && (
                <DropdownMenuItem
                  className="h-8 text-sm"
                  onClick={() => onSort(null)}
                >
                  <X className="size-3.5" />
                  {t("tasks:spreadsheet.clearSort")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem className="h-8 text-sm" onClick={onHide}>
            <EyeOff className="size-3.5" />
            {t("tasks:spreadsheet.hideColumn")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </th>
  );
}
