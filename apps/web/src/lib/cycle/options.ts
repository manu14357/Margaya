import type { CycleStatus } from "@/types/cycle";
import { isAssignableCycle } from "./status";

type OptionCycle = {
  id: string;
  name: string;
  status: CycleStatus;
  archivedAt: string | null;
};

export type CycleOptionGroup<T extends OptionCycle> = {
  status: "current" | "upcoming" | "draft";
  cycles: T[];
};

const GROUP_ORDER = ["current", "upcoming", "draft"] as const;

/**
 * What a cycle picker offers: current, upcoming and draft cycles, grouped in
 * that order, filtered by name. Completed and archived cycles are never
 * targets.
 */
export function cycleOptionGroups<T extends OptionCycle>(
  cycles: readonly T[],
  query = "",
): CycleOptionGroup<T>[] {
  const needle = query.trim().toLowerCase();
  const assignable = cycles.filter(
    (cycle) =>
      isAssignableCycle(cycle) &&
      (!needle || cycle.name.toLowerCase().includes(needle)),
  );
  return GROUP_ORDER.map((status) => ({
    status,
    cycles: assignable.filter((cycle) => cycle.status === status),
  })).filter((group) => group.cycles.length > 0);
}

/** How many choices a picker has, "No cycle" included. */
export function countCycleOptions(cycles: readonly OptionCycle[]): number {
  return cycles.filter(isAssignableCycle).length + 1;
}
