import { useQuery } from "@tanstack/react-query";
import getPageVersion from "@/fetchers/page/get-page-version";
import { pageQueryKeys } from "./page-query-keys";
import { isTerminalPageError } from "./use-get-page";

/** One version's content, for the read-only preview. */
export function useGetPageVersion(
  pageId: string,
  versionId: string | undefined,
) {
  return useQuery({
    queryKey: pageQueryKeys.version(pageId, versionId ?? ""),
    queryFn: () => getPageVersion(pageId, versionId ?? ""),
    enabled: Boolean(pageId && versionId),
    // The newest version can still absorb edits for a few minutes.
    staleTime: 30_000,
    retry: (failureCount, error) =>
      !isTerminalPageError(error) && failureCount < 2,
  });
}

export default useGetPageVersion;
