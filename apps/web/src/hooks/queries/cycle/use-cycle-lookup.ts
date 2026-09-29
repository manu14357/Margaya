import { useGetCycle } from "./use-get-cycle";
import { useGetCycles } from "./use-get-cycles";

/**
 * The project's live cycles plus one cycle by id. Archived cycles are not in
 * the list, so a missing one is fetched on its own.
 */
export function useCycleLookup(
  projectId: string,
  cycleId: string | null | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const list = useGetCycles(projectId, "all", { enabled });
  const cycles = list.data ?? [];
  const listed = cycleId
    ? cycles.find((candidate) => candidate.id === cycleId)
    : undefined;
  const needsDetail = Boolean(enabled && cycleId && list.isSuccess && !listed);
  const detail = useGetCycle(projectId, needsDetail ? (cycleId ?? "") : "");

  return {
    cycles,
    cycle: listed ?? (needsDetail ? detail.data : undefined) ?? null,
    isLoading: list.isLoading,
  };
}

export default useCycleLookup;
