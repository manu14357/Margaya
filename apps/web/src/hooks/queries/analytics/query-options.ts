import { HttpError } from "@/lib/http-error";

// Analytics refresh on focus, when older than a minute, and from the
// Refresh button; they never follow WebSocket messages (K15).
export const ANALYTICS_STALE_TIME = 60_000;

/**
 * Client errors are final, and a 503 means the aggregate timed out, so
 * retrying would only repeat the wait. Anything else gets one more try.
 */
export function analyticsRetry(failureCount: number, error: unknown): boolean {
  if (
    error instanceof HttpError &&
    (error.status < 500 || error.status === 503)
  ) {
    return false;
  }
  return failureCount < 1;
}

export const analyticsQueryOptions = {
  staleTime: ANALYTICS_STALE_TIME,
  refetchOnWindowFocus: true,
  retry: analyticsRetry,
} as const;
