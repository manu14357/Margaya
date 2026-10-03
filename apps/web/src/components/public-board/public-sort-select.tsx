import { ArrowDownWideNarrow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import type { PublicSort } from "@/types/public-board";

const SORT_KEYS: Record<PublicSort, string> = {
  manual: "publicProject:board.sort.manual",
  newest: "publicProject:board.sort.newest",
  updated: "publicProject:board.sort.updated",
  dueDate: "publicProject:board.sort.dueDate",
  priority: "publicProject:board.sort.priority",
  votes: "publicProject:board.sort.votes",
};

type PublicSortSelectProps = {
  sorts: readonly PublicSort[];
  value: PublicSort;
  onChange: (sort: PublicSort) => void;
};

/** The board's sorts (Most votes only while votes are on). */
export default function PublicSortSelect({
  sorts,
  value,
  onChange,
}: PublicSortSelectProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 gap-1.5",
              value !== "manual" &&
                "border-primary/30 bg-primary/10 text-primary",
            )}
            aria-label={`${t("publicProject:board.sort.label")}: ${t(SORT_KEYS[value])}`}
          />
        }
      >
        <ArrowDownWideNarrow className="size-3.5" />
        <span className="text-xs">{t(SORT_KEYS[value])}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {/* Base UI group parts (the label) must sit inside a group. */}
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as PublicSort)}
        >
          <DropdownMenuLabel>
            {t("publicProject:board.sort.label")}
          </DropdownMenuLabel>
          {sorts.map((sort) => (
            <DropdownMenuRadioItem key={sort} value={sort}>
              {t(SORT_KEYS[sort])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
