import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { moduleOptionGroups } from "@/lib/module/options";
import { MODULE_STATUS_META } from "@/lib/module/status";
import type { Module } from "@/types/module";
import { ModuleStatusIcon } from "./module-status";

/** Pickers with more modules than this get a search field. */
const SEARCH_THRESHOLD = 7;

type ModuleMultiSelectProps = {
  /** The project's active modules. */
  modules: readonly Module[];
  selectedIds: readonly string[];
  onToggle: (moduleId: string) => void;
};

/**
 * Active modules grouped by status, each with a check mark when selected.
 * Shared by the task sidebar, the create-task modal and bulk actions.
 */
export default function ModuleMultiSelect({
  modules,
  selectedIds,
  onToggle,
}: ModuleMultiSelectProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const groups = useMemo(
    () => moduleOptionGroups(modules, query),
    [modules, query],
  );
  const showSearch = modules.length > SEARCH_THRESHOLD;

  return (
    <div className="w-64 max-w-[calc(100vw-2rem)]">
      {showSearch && (
        <div className="flex items-center gap-2 border-border border-b p-2">
          <Search className="size-3 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("modules:picker.searchPlaceholder")}
            aria-label={t("modules:picker.searchPlaceholder")}
            className="h-auto border-none p-0 shadow-none focus-visible:ring-0 !bg-transparent"
          />
        </div>
      )}
      <div className="max-h-80 overflow-y-auto py-1">
        {modules.length === 0 && (
          <p className="px-2 py-2 text-muted-foreground text-xs">
            {t("modules:picker.empty")}
          </p>
        )}
        {groups.map((group) => (
          <div key={group.status} className="pt-1">
            <p className="px-2 py-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              {t(MODULE_STATUS_META[group.status].labelKey)}
            </p>
            {group.modules.map((module) => {
              const selected = selectedIds.includes(module.id);
              return (
                <button
                  key={module.id}
                  type="button"
                  aria-pressed={selected}
                  className="flex h-8 w-full items-center gap-2 px-2 text-left text-sm transition-colors hover:bg-accent/50"
                  onClick={() => onToggle(module.id)}
                >
                  <span className="flex w-4 shrink-0 justify-center">
                    {selected && <Check className="size-3.5" />}
                  </span>
                  <ModuleStatusIcon status={module.status} />
                  <span className="truncate">{module.name}</span>
                </button>
              );
            })}
          </div>
        ))}
        {query && groups.length === 0 && (
          <p className="px-2 py-2 text-muted-foreground text-xs">
            {t("modules:picker.noResults")}
          </p>
        )}
      </div>
    </div>
  );
}
