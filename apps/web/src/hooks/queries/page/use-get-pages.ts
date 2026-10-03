import { useQuery } from "@tanstack/react-query";
import listPages from "@/fetchers/page/list-pages";
import { pageQueryKeys } from "./page-query-keys";

/** Every page of the project the caller can see (archived included). */
export function useGetPages(
  projectId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: pageQueryKeys.list(projectId),
    queryFn: () => listPages(projectId),
    enabled: Boolean(projectId) && (options?.enabled ?? true),
    staleTime: 30_000,
  });
}

export default useGetPages;
