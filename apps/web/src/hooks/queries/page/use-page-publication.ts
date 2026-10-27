import { useQuery } from "@tanstack/react-query";
import { getPagePublication } from "@/fetchers/page/page-publication";
import { pageQueryKeys } from "./page-query-keys";

// Under the page's detail key, so any page refresh (access, archive) reads
// the link again: both can revoke it.
export const pagePublicationKey = (pageId: string) =>
  [...pageQueryKeys.detail(pageId), "publication"] as const;

/** The page's public link, and whether it can be published. */
export function usePagePublication(pageId: string, enabled = true) {
  return useQuery({
    queryKey: pagePublicationKey(pageId),
    queryFn: () => getPagePublication(pageId),
    enabled: enabled && Boolean(pageId),
  });
}
