import { ListFilter, Search, Star } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import {
  CREATED_WITHIN,
  type CreatedWithin,
} from "@/lib/pages/filter-sort-pages";
import MemberAvatar from "./member-avatar";
import type { PageMember } from "./use-page-members";

export const CREATED_WITHIN_KEYS: Record<CreatedWithin, string> = {
  any: "pages:filters.date.any",
  today: "pages:filters.date.today",
  last7: "pages:filters.date.last7",
  last30: "pages:filters.date.last30",
  older: "pages:filters.date.older",
};

export type PageListFilterState = {
  ownerIds: string[];
  favoritesOnly: boolean;
  createdWithin: CreatedWithin;
};

export const EMPTY_PAGE_FILTERS: PageListFilterState = {
  ownerIds: [],
  favoritesOnly: false,
  createdWithin: "any",
};

type PageFiltersMenuProps = {
  /** People who own at least one page of the project. */
  owners: PageMember[];
  filters: PageListFilterState;
  onChange: (filters: PageListFilterState) => void;
  /** Favorites filter only once the user's favorites have loaded. */
  favoritesReady: boolean;
};

function GroupLabel({ children }: { children: string }) {
  return (
    <p className="px-2 pt-2 pb-1 font-semibold text-[11px] text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * "Filters": Favorites, Created by (the page owner) and Created date, with a
 * search over the options. The trigger counts the filters in use.
 */
export default function PageFiltersMenu({
  owners,
  filters,
  onChange,
  favoritesReady,
}: PageFiltersMenuProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const dateGroupId = useId();
  const needle = query.trim().toLowerCase();
  const matches = (label: string) =>
    !needle || label.toLowerCase().includes(needle);

  const visibleOwners = useMemo(
    () => owners.filter((owner) => owner.name.toLowerCase().includes(needle)),
    [needle, owners],
  );
  const favoritesLabel = t("pages:filters.favorites");
  const createdByLabel = t("pages:info.createdBy");
  const createdDateLabel = t("pages:filters.createdDate");
  const dateOptions = CREATED_WITHIN.filter(
    (value) =>
      matches(t(CREATED_WITHIN_KEYS[value])) || matches(createdDateLabel),
  );
  const activeCount =
    filters.ownerIds.length +
    (filters.favoritesOnly ? 1 : 0) +
    (filters.createdWithin !== "any" ? 1 : 0);

  const toggleOwner = (ownerId: string) =>
    onChange({
      ...filters,
      ownerIds: filters.ownerIds.includes(ownerId)
        ? filters.ownerIds.filter((id) => id !== ownerId)
        : [...filters.ownerIds, ownerId],
    });

  return (
    <Popover onOpenChange={(open) => !open && setQuery("")}>
      <PopoverTrigger
        // Same size as the sort button beside it.
        render={<Button variant="outline" size="xs" className="gap-1" />}
      >
        <ListFilter className="size-3" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">
          {t("pages:filters.button")}
        </span>
        {activeCount > 0 && (
          <>
            <span
              aria-hidden="true"
              className="text-muted-foreground text-xs tabular-nums"
            >
              {activeCount}
            </span>
            <span className="sr-only">{t("pages:filters.active")}</span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-65 p-1">
        <div className="relative p-1">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3.5 z-10 size-3.5 text-muted-foreground" />
          <Input
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("pages:filters.search")}
            aria-label={t("pages:filters.search")}
            className="[&_[data-slot=input]]:pl-8"
          />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {matches(favoritesLabel) && (
            // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is the control
            <label
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent data-disabled:cursor-default data-disabled:opacity-60"
              data-disabled={!favoritesReady || undefined}
            >
              <Checkbox
                checked={filters.favoritesOnly}
                disabled={!favoritesReady}
                onCheckedChange={(checked) =>
                  onChange({ ...filters, favoritesOnly: Boolean(checked) })
                }
              />
              <Star className="size-3.5 text-muted-foreground" />
              {favoritesLabel}
            </label>
          )}
          {(visibleOwners.length > 0 || matches(createdByLabel)) &&
            owners.length > 0 && (
              <fieldset
                aria-label={createdByLabel}
                className="m-0 min-w-0 border-0 p-0"
              >
                <GroupLabel>{createdByLabel}</GroupLabel>
                {(visibleOwners.length > 0 ? visibleOwners : owners).map(
                  (owner) => (
                    // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is the control
                    <label
                      key={owner.id}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      <Checkbox
                        checked={filters.ownerIds.includes(owner.id)}
                        onCheckedChange={() => toggleOwner(owner.id)}
                      />
                      <MemberAvatar name={owner.name} image={owner.image} />
                      <span className="truncate">{owner.name}</span>
                    </label>
                  ),
                )}
              </fieldset>
            )}
          {dateOptions.length > 0 && (
            <div>
              <GroupLabel>{createdDateLabel}</GroupLabel>
              <RadioGroup
                aria-labelledby={dateGroupId}
                value={filters.createdWithin}
                onValueChange={(value) =>
                  onChange({
                    ...filters,
                    createdWithin: value as CreatedWithin,
                  })
                }
                className="gap-0"
              >
                <span id={dateGroupId} className="sr-only">
                  {createdDateLabel}
                </span>
                {dateOptions.map((value) => (
                  // biome-ignore lint/a11y/noLabelWithoutControl: the radio inside is the control
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <Radio value={value} />
                    {t(CREATED_WITHIN_KEYS[value])}
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
