import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CheckSlot } from "@/components/task-filters/filter-primitives";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  INTAKE_SORT_FIELDS,
  type IntakeSortField,
  type IntakeSortOrder,
} from "@/types/intake";

type IntakeSortMenuProps = {
  sortBy: IntakeSortField;
  sortOrder: IntakeSortOrder;
  onChange: (sort: {
    sortBy: IntakeSortField;
    sortOrder: IntakeSortOrder;
  }) => void;
};

/** Submitted, last activity or task key, newest or oldest first. */
export default function IntakeSortMenu({
  sortBy,
  sortOrder,
  onChange,
}: IntakeSortMenuProps) {
  const { t } = useTranslation();
  // The key reads as a number, so its directions are ascending/descending.
  const byKey = sortBy === "number";
  const directions: { value: IntakeSortOrder; label: string }[] = [
    {
      value: "desc",
      label: byKey ? t("intake:sort.descending") : t("intake:sort.newestFirst"),
    },
    {
      value: "asc",
      label: byKey ? t("intake:sort.ascending") : t("intake:sort.oldestFirst"),
    },
  ];
  const Icon = sortOrder === "asc" ? ArrowUpNarrowWide : ArrowDownWideNarrow;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="xs" className="gap-1" />}
      >
        <Icon className="size-3" />
        {t(`intake:sort.fields.${sortBy}`)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
            {t("intake:sort.button")}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {INTAKE_SORT_FIELDS.map((field) => (
          <DropdownMenuItem
            key={field}
            className="h-8 rounded-md text-sm"
            onClick={() => onChange({ sortBy: field, sortOrder })}
          >
            <CheckSlot checked={sortBy === field} />
            {t(`intake:sort.fields.${field}`)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {directions.map((direction) => (
          <DropdownMenuItem
            key={direction.value}
            className="h-8 rounded-md text-sm"
            onClick={() => onChange({ sortBy, sortOrder: direction.value })}
          >
            <CheckSlot checked={sortOrder === direction.value} />
            {direction.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
