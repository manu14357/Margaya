import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { defaultTabStatuses, INTAKE_STATUS_META } from "@/lib/intake";
import { hasActiveIntakeFilters } from "@/lib/intake-search";
import type { IntakeCounts, IntakeFilters, IntakeTab } from "@/types/intake";
import IntakeFilterMenu from "./intake-filter-menu";
import IntakeSortMenu from "./intake-sort-menu";

function CountChip({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-sm border border-border/60 px-1 font-medium text-[11px] text-muted-foreground tabular-nums">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function FilterChip({
  subject,
  value,
  onRemove,
}: {
  subject: string;
  value: string;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex h-6 max-w-full items-center rounded-md border border-border bg-background text-xs shadow-xs">
      <span className="px-2 text-muted-foreground">{subject}</span>
      <span className="h-full w-px bg-border" />
      <span className="truncate px-2 font-medium text-foreground">{value}</span>
      <span className="h-full w-px bg-border" />
      <button
        type="button"
        aria-label={t("intake:filters.remove")}
        onClick={onRemove}
        className="inline-flex h-full w-6 items-center justify-center rounded-r-md text-foreground/70 hover:bg-accent/70 hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

type IntakeListToolbarProps = {
  workspaceId: string;
  filters: IntakeFilters;
  counts: IntakeCounts | undefined;
  canReadAll: boolean;
  submitterName: (id: string) => string;
  onTabChange: (tab: IntakeTab) => void;
  onChange: (patch: Partial<IntakeFilters>) => void;
  onClearFilters: () => void;
};

/** Tabs with counts, search, filter and sort, and the active filters. */
export default function IntakeListToolbar({
  workspaceId,
  filters,
  counts,
  canReadAll,
  submitterName,
  onTabChange,
  onChange,
  onClearFilters,
}: IntakeListToolbarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(filters.q ?? "");
  const lastSent = useRef(filters.q ?? "");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Follow outside changes (Clear filters, links) without echoing them back.
  useEffect(() => {
    const next = filters.q ?? "";
    if (next !== lastSent.current) {
      lastSent.current = next;
      setQuery(next);
    }
  }, [filters.q]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === lastSent.current) return;
    const timer = setTimeout(() => {
      lastSent.current = trimmed;
      onChangeRef.current({ q: trimmed || undefined });
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const closedCount = counts
    ? counts.accepted + counts.declined + counts.duplicate
    : undefined;
  const showStatusChip =
    filters.statuses.join() !== defaultTabStatuses(filters.tab).join();
  const active = hasActiveIntakeFilters(filters);

  return (
    <div className="flex shrink-0 flex-col border-border border-b">
      <div className="flex h-10 items-center px-2">
        <Tabs
          value={filters.tab}
          onValueChange={(value) => onTabChange(value as IntakeTab)}
          className="min-w-0 flex-1"
        >
          <TabsList variant="underline" className="h-9 gap-1 py-0">
            <TabsTab
              value="open"
              className="h-7 grow-0 gap-1.5 px-2 text-xs sm:h-7 sm:text-sm"
            >
              {t("intake:tabs.open")}
              <CountChip count={counts?.pending} />
            </TabsTab>
            <TabsTab
              value="closed"
              className="h-7 grow-0 gap-1.5 px-2 text-xs sm:h-7 sm:text-sm"
            >
              {t("intake:tabs.closed")}
              <CountChip count={closedCount} />
            </TabsTab>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex items-center gap-1.5 px-2 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("intake:list.searchPlaceholder")}
            aria-label={t("intake:list.searchPlaceholder")}
            className="h-7.5 [&_[data-slot=input]]:h-7 [&_[data-slot=input]]:pl-8 [&_[data-slot=input]]:text-xs"
          />
        </div>
        <IntakeFilterMenu
          workspaceId={workspaceId}
          filters={filters}
          onChange={onChange}
          canReadAll={canReadAll}
          active={active}
        />
        <IntakeSortMenu
          sortBy={filters.sortBy}
          sortOrder={filters.sortOrder}
          onChange={onChange}
        />
      </div>
      {active && (
        <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
          {showStatusChip && (
            <FilterChip
              subject={t("intake:filters.status")}
              value={filters.statuses
                .map((status) => t(INTAKE_STATUS_META[status].labelKey))
                .join(", ")}
              onRemove={() => onChange({ statuses: [] })}
            />
          )}
          {filters.priorities.length > 0 && (
            <FilterChip
              subject={t("intake:filters.priority")}
              value={filters.priorities.map(getPriorityLabel).join(", ")}
              onRemove={() => onChange({ priorities: [] })}
            />
          )}
          {filters.submittedBy && (
            <FilterChip
              subject={t("intake:filters.submittedBy")}
              value={submitterName(filters.submittedBy)}
              onRemove={() => onChange({ submittedBy: undefined })}
            />
          )}
          <Button
            variant="link"
            size="xs"
            className="h-auto px-1 text-muted-foreground text-xs"
            onClick={onClearFilters}
          >
            {t("intake:filters.clear")}
          </Button>
        </div>
      )}
    </div>
  );
}
