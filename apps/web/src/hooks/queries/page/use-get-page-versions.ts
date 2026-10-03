import { useQuery } from "@tanstack/react-query";
import listPageVersions from "@/fetchers/page/list-page-versions";
import { pageQueryKeys } from "./page-query-keys";

/** Saved versions, newest first; loaded while the History tab is open. */
export function useGetPageVersions(pageId: string, enabled: boolean) {
  return useQuery({
    queryKey: pageQueryKeys.versions(pageId),
    queryFn: () => listPageVersions(pageId),
    enabled: Boolean(pageId) && enabled,
  });
}

export default useGetPageVersions;
