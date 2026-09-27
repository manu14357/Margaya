import { Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterOptionRow } from "./filter-primitives";
import type { FilterOption, FilterSubject } from "./subjects";

/** Lists with more options than this get a search box. */
const SEARCH_THRESHOLD = 10;

type FilterOptionListProps = {
  subject: FilterSubject;
  selected: readonly string[];
  onToggle: (value: string) => void;
  /** Focus the search box when it mounts (popovers). */
  autoFocus?: boolean;
};

function OptionRows({
  options,
  selected,
  onToggle,
}: {
  options: readonly FilterOption[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}) {
  let lastSection: string | undefined;
  return (
    <>
      {options.map((option) => {
        const header =
          option.section && option.section !== lastSection
            ? option.section
            : null;
        lastSection = option.section ?? lastSection;
        return (
          <Fragment key={`${option.section ?? ""}:${option.value}`}>
            {header && (
              <div className="px-2 pt-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                {header}
              </div>
            )}
            <FilterOptionRow
              checked={selected.includes(option.value)}
              icon={option.icon}
              label={option.label}
              onClick={() => onToggle(option.value)}
            />
          </Fragment>
        );
      })}
    </>
  );
}

/** Tasks found by typing, for subjects with too many values to list. */
function RemoteOptions({
  subject,
  search,
  selected,
  onToggle,
}: {
  subject: FilterSubject & {
    useSearchOptions: NonNullable<FilterSubject["useSearchOptions"]>;
  };
  search: string;
  selected: readonly string[];
  onToggle: (value: string) => void;
}) {
  const { t } = useTranslation();
  const { options, isLoading } = subject.useSearchOptions(search);
  if (!search.trim()) return null;
  if (options.length === 0) {
    return (
      <p className="px-2 py-1.5 text-muted-foreground text-xs">
        {isLoading ? t("common:empty.loading") : t("tasks:filters.noOptions")}
      </p>
    );
  }
  return (
    <OptionRows options={options} selected={selected} onToggle={onToggle} />
  );
}

/** A subject's values as check rows, with a search box for long lists. */
export default function FilterOptionList({
  subject,
  selected,
  onToggle,
  autoFocus,
}: FilterOptionListProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const hasRemote = Boolean(subject.useSearchOptions);
  const showSearch = hasRemote || subject.options.length > SEARCH_THRESHOLD;
  const needle = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? subject.options.filter((option) =>
            option.label.toLowerCase().includes(needle),
          )
        : subject.options,
    [needle, subject.options],
  );

  return (
    <div className="grid grid-cols-1 gap-0.5 p-1">
      {showSearch && (
        <div className="relative mb-1">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
          <input
            // biome-ignore lint/a11y/noAutofocus: the list opens for typing
            autoFocus={autoFocus}
            aria-label={t("tasks:filters.searchOptions")}
            className="h-7 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground/72 focus:border-ring"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder={t("tasks:filters.searchOptions")}
            value={search}
          />
        </div>
      )}
      <div className="grid max-h-72 grid-cols-1 gap-0.5 overflow-y-auto">
        <OptionRows options={visible} selected={selected} onToggle={onToggle} />
        {subject.useSearchOptions && (
          <RemoteOptions
            subject={{ ...subject, useSearchOptions: subject.useSearchOptions }}
            search={search}
            selected={selected}
            onToggle={onToggle}
          />
        )}
        {visible.length === 0 && !hasRemote && (
          <p className="px-2 py-1.5 text-muted-foreground text-xs">
            {subject.isLoading
              ? t("common:empty.loading")
              : t("tasks:filters.noOptions")}
          </p>
        )}
      </div>
    </div>
  );
}
