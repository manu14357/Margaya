/** A point's place in its system, keyed by point id. */
export type EstimatePointLookup = ReadonlyMap<string, { position: number }>;

/**
 * Orders tasks by their estimate's position in the active system. Tasks
 * without an estimate, or on a point the lookup doesn't know, come last in
 * both directions.
 */
export function compareTasksByEstimate(
  a: { estimatePointId?: string | null },
  b: { estimatePointId?: string | null },
  pointsById: EstimatePointLookup,
  direction: "asc" | "desc",
): number {
  const positionA = a.estimatePointId
    ? pointsById.get(a.estimatePointId)?.position
    : undefined;
  const positionB = b.estimatePointId
    ? pointsById.get(b.estimatePointId)?.position
    : undefined;
  if (positionA === undefined && positionB === undefined) return 0;
  if (positionA === undefined) return 1;
  if (positionB === undefined) return -1;
  return direction === "asc" ? positionA - positionB : positionB - positionA;
}
