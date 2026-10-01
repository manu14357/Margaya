import type { QueryClient } from "@tanstack/react-query";
import { estimateQueryKeys } from "@/hooks/queries/estimate/estimate-query-keys";
import type { Estimate, EstimateList } from "@/types/estimate";

/** A copy of the list with one system replaced by its fresh version. */
export function withEstimate(list: EstimateList, estimate: Estimate) {
  return {
    ...list,
    estimates: list.estimates.map((candidate) =>
      candidate.id === estimate.id ? estimate : candidate,
    ),
  };
}

/** Writes a system returned by a point route into the cached list. */
export function storeEstimate(
  queryClient: QueryClient,
  projectId: string,
  estimate: Estimate,
) {
  queryClient.setQueryData<EstimateList>(
    estimateQueryKeys.all(projectId),
    (list) => (list ? withEstimate(list, estimate) : list),
  );
}

/** The system with its points put in the given order, positions 1..n. */
export function withPointOrder(
  estimate: Estimate,
  pointIds: readonly string[],
): Estimate {
  const byId = new Map(estimate.points.map((point) => [point.id, point]));
  const ordered = pointIds.flatMap((id) => {
    const point = byId.get(id);
    return point ? [point] : [];
  });
  if (ordered.length !== estimate.points.length) return estimate;
  return {
    ...estimate,
    points: ordered.map((point, index) => ({ ...point, position: index + 1 })),
  };
}
