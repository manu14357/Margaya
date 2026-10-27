import { useInfiniteQuery } from "@tanstack/react-query";
import { listApiKeyRequests } from "@/fetchers/api-key/api-keys";

/** One key's request log, newest first, 50 at a time. */
function useApiKeyRequests(keyId: string) {
  return useInfiniteQuery({
    queryKey: ["api-keys", keyId, "requests"],
    queryFn: ({ pageParam }) =>
      listApiKeyRequests(keyId, { cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
  });
}

export default useApiKeyRequests;
