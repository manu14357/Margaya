import { useMemo } from "react";
import type { SortConfig, SortContext } from "@/lib/sort-tasks";
import { useActiveEstimate } from "./use-active-estimate";

const POSITION_SORT: SortConfig = { field: "position", direction: "asc" };

/**
 * The board sort as it applies right now. A stored estimate sort falls back
 * to position order while estimates aren't active (the stored choice is
 * kept, so it returns with them), and `context` carries the active system's
 * points for `sortTasks`.
 */
export function useEstimateSort({
  projectId,
  workspaceId,
  sort,
}: {
  projectId: string;
  workspaceId: string;
  sort: SortConfig;
}) {
  const { isActive, pointsById } = useActiveEstimate({
    projectId,
    workspaceId,
  });

  return useMemo(() => {
    const context: SortContext = isActive
      ? { estimatePointsById: pointsById }
      : {};
    return {
      sort: sort.field === "estimate" && !isActive ? POSITION_SORT : sort,
      context,
      showEstimate: isActive,
    };
  }, [isActive, pointsById, sort]);
}

export default useEstimateSort;
