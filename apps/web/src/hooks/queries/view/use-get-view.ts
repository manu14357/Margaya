import { useQuery } from "@tanstack/react-query";
import getView from "@/fetchers/view/get-view";
import { HttpError } from "@/lib/http-error";
import { viewQueryKeys } from "./view-query-keys";

/** One view; 404 (unknown, or another user's private view) isn't retried. */
export function useGetView(workspaceId: string, viewId: string) {
  return useQuery({
    queryKey: viewQueryKeys.detail(workspaceId, viewId),
    queryFn: () => getView(viewId),
    enabled: Boolean(workspaceId && viewId),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) =>
      !(error instanceof HttpError && [403, 404].includes(error.status)) &&
      failureCount < 2,
  });
}

export default useGetView;
