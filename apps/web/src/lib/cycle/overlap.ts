type DatedCycle = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
};

/**
 * The first dated cycle whose inclusive range overlaps the given one, the
 * server's rule: ranges a and b overlap when a.start ≤ b.end and b.start ≤
 * a.end. The edited cycle itself is skipped. Returns null when nothing
 * overlaps or the range has no dates.
 */
export function findOverlappingCycle<T extends DatedCycle>(
  range: { startDate: string | null; endDate: string | null },
  cycles: readonly T[],
  excludeId?: string,
): T | null {
  const { startDate, endDate } = range;
  if (!startDate || !endDate) return null;
  return (
    cycles.find(
      (cycle) =>
        cycle.id !== excludeId &&
        cycle.startDate !== null &&
        cycle.endDate !== null &&
        startDate <= cycle.endDate &&
        cycle.startDate <= endDate,
    ) ?? null
  );
}
