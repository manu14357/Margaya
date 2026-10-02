import { useInfiniteQuery } from "@tanstack/react-query";
import getIntakeItems from "@/fetchers/intake/get-intake-items";
import type { IntakeFilters } from "@/types/intake";
import { intakeQueryKeys } from "./intake-query-keys";

/** A project's requests under the list's filters, one page of 50 at a time. */
export function useGetIntakeItems(
  projectId: string,
  filters: IntakeFilters,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: intakeQueryKeys.list(projectId, filters),
    queryFn: ({ pageParam }) => getIntakeItems(projectId, filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: Boolean(projectId) && enabled,
    staleTime: 15_000,
  });
}

export default useGetIntakeItems;
