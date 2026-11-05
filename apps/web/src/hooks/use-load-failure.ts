import { useRef, useState } from "react";

type LoadableQuery = {
  data: unknown;
  error: unknown;
  errorUpdatedAt: number;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
};

/**
 * Whether a page with no data should show its failure state, and how to retry.
 *
 * A query with no data goes back to pending on every refetch, and a polled
 * one does so on a timer. Without this the failure state would blink into a
 * skeleton, Retry button included, each time a poll tried again; so it holds
 * through background attempts and only a person's retry shows loading. "No
 * data and not loading" also covers a query paused because the browser is
 * offline, which never reports an error.
 */
export function useLoadFailure(query: LoadableQuery) {
  const [retrying, setRetrying] = useState(false);
  const lastError = useRef<unknown>(null);
  if (query.error) lastError.current = query.error;

  const failed =
    query.data === undefined &&
    (!query.isLoading || (query.errorUpdatedAt > 0 && !retrying));
  if (!failed) return null;

  return {
    error: lastError.current,
    retry: () => {
      setRetrying(true);
      void query.refetch().finally(() => setRetrying(false));
    },
  };
}
