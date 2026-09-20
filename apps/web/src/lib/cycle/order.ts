import type { CycleStatus } from "@/types/cycle";

type SectionableCycle = {
  status: CycleStatus;
  archivedAt: string | null;
};

/**
 * Splits the API-ordered list into the page sections: the running cycle,
 * upcoming cycles followed by drafts, and completed cycles. Archived cycles
 * belong to the archived view only.
 */
export function sectionCycles<T extends SectionableCycle>(
  cycles: readonly T[],
) {
  const live = cycles.filter((cycle) => !cycle.archivedAt);
  return {
    active: live.find((cycle) => cycle.status === "current") ?? null,
    upcoming: [
      ...live.filter((cycle) => cycle.status === "upcoming"),
      ...live.filter((cycle) => cycle.status === "draft"),
    ],
    completed: live.filter((cycle) => cycle.status === "completed"),
  };
}

/** Case-insensitive name search; an empty query keeps every cycle. */
export function searchCycles<T extends { name: string }>(
  cycles: readonly T[],
  query: string | undefined,
): T[] {
  const needle = query?.trim().toLowerCase();
  if (!needle) return [...cycles];
  return cycles.filter((cycle) => cycle.name.toLowerCase().includes(needle));
}
