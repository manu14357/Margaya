import { useQuery } from "@tanstack/react-query";
import getPage from "@/fetchers/page/get-page";
import { HttpError } from "@/lib/http-error";
import { pageQueryKeys } from "./page-query-keys";

export function isTerminalPageError(error: unknown) {
  return (
    error instanceof HttpError && error.status >= 400 && error.status < 500
  );
}

/** One page with its markdown, ancestors and capabilities. */
export function useGetPage(pageId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: pageQueryKeys.detail(pageId),
    queryFn: () => getPage(pageId),
    enabled: Boolean(pageId) && (options?.enabled ?? true),
    refetchOnWindowFocus: true,
    // A deleted, private or foreign page stays missing; don't retry it.
    retry: (failureCount, error) =>
      !isTerminalPageError(error) && failureCount < 2,
  });
}

export default useGetPage;
