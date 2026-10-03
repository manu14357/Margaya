import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import type { PageSort, PageSortField } from "@/lib/pages/filter-sort-pages";

const FIELD_KEYS: Record<PageSortField, string> = {
  updatedAt: "pages:list.sort.lastEdited",
  createdAt: "pages:list.sort.created",
  title: "pages:list.sort.name",
};

/** Last edited · Created · Name, ascending or descending. */
export default function PagesSortMenu({
  sort,
  onChange,
}: {
  sort: PageSort;
  onChange: (sort: PageSort) => void;
}) {
  const { t } = useTranslation();
  const DirectionIcon = sort.direction === "asc" ? ArrowUpAZ : ArrowDownAZ;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="xs" className="gap-1" />}
      >
        <DirectionIcon className="size-3" />
        <span className="sr-only sm:not-sr-only">
          {t(FIELD_KEYS[sort.field])}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
            {t("tasks:sort.by")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sort.field}
            onValueChange={(field) =>
              onChange({ ...sort, field: field as PageSortField })
            }
          >
            {(Object.keys(FIELD_KEYS) as PageSortField[]).map((field) => (
              <DropdownMenuRadioItem key={field} value={field}>
                {t(FIELD_KEYS[field])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
            {t("tasks:sort.direction")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sort.direction}
            onValueChange={(direction) =>
              onChange({
                ...sort,
                direction: direction as PageSort["direction"],
              })
            }
          >
            <DropdownMenuRadioItem value="asc">
              {t("tasks:sort.ascending")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="desc">
              {t("tasks:sort.descending")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
