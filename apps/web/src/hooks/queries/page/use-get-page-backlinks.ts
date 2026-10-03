import { useQuery } from "@tanstack/react-query";
import listPageBacklinks from "@/fetchers/page/list-page-backlinks";
import { pageQueryKeys } from "./page-query-keys";

/** Pages that link here; loaded while the Info tab is open. */
export function useGetPageBacklinks(pageId: string, enabled: boolean) {
  return useQuery({
    queryKey: pageQueryKeys.backlinks(pageId),
    queryFn: () => listPageBacklinks(pageId),
    enabled: Boolean(pageId) && enabled,
  });
}

export default useGetPageBacklinks;
