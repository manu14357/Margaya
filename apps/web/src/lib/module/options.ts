import type { ModuleStatus } from "@/types/module";
import { MODULE_STATUS_ORDER } from "./status";

type OptionModule = {
  name: string;
  status: ModuleStatus;
  archivedAt: string | null;
};

export type ModuleOptionGroup<T extends OptionModule> = {
  status: ModuleStatus;
  modules: T[];
};

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * What a module picker offers: active modules matching the query, grouped
 * by status in the list's order and sorted by name. Archived modules are
 * never targets.
 */
export function moduleOptionGroups<T extends OptionModule>(
  modules: readonly T[],
  query = "",
): ModuleOptionGroup<T>[] {
  const needle = query.trim().toLowerCase();
  const matching = modules
    .filter(
      (module) =>
        !module.archivedAt &&
        (!needle || module.name.toLowerCase().includes(needle)),
    )
    .sort((a, b) => nameCollator.compare(a.name, b.name));
  return MODULE_STATUS_ORDER.map((status) => ({
    status,
    modules: matching.filter((module) => module.status === status),
  })).filter((group) => group.modules.length > 0);
}
