import { Check, IterationCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ShortcutNumber } from "@/components/ui/shortcut-number";
import { useNumberedShortcuts } from "@/hooks/use-numbered-shortcuts";
import { cn } from "@/lib/cn";
import { formatCycleRange } from "@/lib/cycle/dates";
import { countCycleOptions, cycleOptionGroups } from "@/lib/cycle/options";
import { CYCLE_STATUS_META } from "@/lib/cycle/status";
import type { Cycle } from "@/types/cycle";
import { CycleStatusIcon } from "./cycle-status";

/** Pickers with more choices than this get a search field. */
const SEARCH_THRESHOLD = 7;

type CycleOptionListProps = {
  cycles: readonly Cycle[];
  /** The chosen cycle id; null means "No cycle", undefined means none. */
  selectedId: string | null | undefined;
  /** The task's current cycle when it can't take tasks: listed, disabled. */
  lockedCycle?: Cycle | null;
  onSelect: (cycleId: string | null) => void;
  /** Number keys 1–9 pick options while the list is open. */
  shortcutsEnabled?: boolean;
};

const optionClassName =
  "flex h-8 w-full items-center gap-2 px-2 text-left text-sm transition-colors hover:bg-accent/50 disabled:pointer-events-none disabled:opacity-64";

/**
 * "No cycle", then current, upcoming and draft cycles. Shared by the task
 * sidebar, the create-task modal and the bulk-actions bar.
 */
export default function CycleOptionList({
  cycles,
  selectedId,
  lockedCycle,
  onSelect,
  shortcutsEnabled = false,
}: CycleOptionListProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const showSearch = countCycleOptions(cycles) > SEARCH_THRESHOLD;
  const groups = useMemo(
    () => cycleOptionGroups(cycles, query),
    [cycles, query],
  );

  const ordered = useMemo(
    () => [null, ...groups.flatMap((group) => group.cycles)],
    [groups],
  );
  const shortcutOptions = useMemo(
    () =>
      ordered.map((cycle) => ({ onSelect: () => onSelect(cycle?.id ?? null) })),
    [ordered, onSelect],
  );
  useNumberedShortcuts(shortcutsEnabled, shortcutOptions);

  const shortcutFor = (cycleId: string | null) => {
    const index = ordered.findIndex((cycle) => (cycle?.id ?? null) === cycleId);
    return index >= 0 && index < 9 ? index + 1 : null;
  };

  const renderMarker = (cycleId: string | null) => {
    // undefined: nothing is selected (bulk actions); null: "No cycle".
    const isSelected = selectedId !== undefined && selectedId === cycleId;
    if (isSelected) return <Check className="ml-auto size-4 shrink-0" />;
    const number = shortcutsEnabled ? shortcutFor(cycleId) : null;
    return number ? <ShortcutNumber number={number} /> : null;
  };

  const lockedBadge = lockedCycle?.archivedAt
    ? t("cycles:picker.archivedBadge")
    : t("cycles:picker.completedBadge");

  return (
    <div className="w-64 max-w-[calc(100vw-2rem)]">
      {showSearch && (
        <div className="flex items-center gap-2 border-border border-b p-2">
          <Search className="size-3 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("cycles:picker.searchPlaceholder")}
            aria-label={t("cycles:picker.searchPlaceholder")}
            className="h-auto border-none p-0 shadow-none focus-visible:ring-0 !bg-transparent"
          />
        </div>
      )}
      <div className="max-h-80 overflow-y-auto py-1">
        <button
          type="button"
          className={optionClassName}
          onClick={() => onSelect(null)}
        >
          <IterationCw className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-muted-foreground">
            {t("cycles:picker.none")}
          </span>
          {renderMarker(null)}
        </button>

        {lockedCycle && (
          <button type="button" className={optionClassName} disabled>
            <CycleStatusIcon cycle={lockedCycle} />
            <span className="min-w-0 flex-1 truncate">{lockedCycle.name}</span>
            <Badge variant="secondary" size="sm">
              {lockedBadge}
            </Badge>
            <Check className="size-4 shrink-0" />
          </button>
        )}

        {groups.map((group) => (
          <div key={group.status} className="pt-1">
            <p className="px-2 py-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              {t(CYCLE_STATUS_META[group.status].labelKey)}
            </p>
            {group.cycles.map((cycle) => {
              const range = formatCycleRange(cycle.startDate, cycle.endDate);
              return (
                <button
                  key={cycle.id}
                  type="button"
                  className={cn(optionClassName, "h-auto min-h-8 py-1")}
                  onClick={() => onSelect(cycle.id)}
                >
                  <CycleStatusIcon cycle={cycle} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{cycle.name}</span>
                    {range && (
                      <span className="truncate text-muted-foreground text-xs">
                        {range}
                      </span>
                    )}
                  </span>
                  {renderMarker(cycle.id)}
                </button>
              );
            })}
          </div>
        ))}

        {query && groups.length === 0 && (
          <p className="px-2 py-2 text-muted-foreground text-xs">
            {t("cycles:picker.noResults")}
          </p>
        )}
      </div>
    </div>
  );
}
