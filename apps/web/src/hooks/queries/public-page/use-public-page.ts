import { useQuery } from "@tanstack/react-query";
import getPublicPage from "@/fetchers/public-page/get-public-page";
import { HttpError } from "@/lib/http-error";

/** A published page; a revoked or unknown link is a 404 (no retries). */
export function usePublicPage(token: string) {
  return useQuery({
    queryKey: ["public-page", token],
    queryFn: ({ signal }) => getPublicPage(token, signal),
    retry: (count, error) =>
      !(error instanceof HttpError && error.status === 404) && count < 2,
    staleTime: 60_000,
  });
}
