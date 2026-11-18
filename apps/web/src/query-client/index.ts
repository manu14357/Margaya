import * as Sentry from "@sentry/react";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { handleUnauthorized, isUnauthorizedError } from "@/lib/http-error";
import {
  invalidateTaskQueries,
  isTaskInQueryCache,
  patchTaskInQueryCache,
  taskPatchFromVariables,
} from "@/lib/task-query/cache";
import {
  handleTwoFactorRequired,
  isTwoFactorRequired,
} from "@/lib/two-factor-required";

// TanStack raises these before any fetcher-level message exists; CORS rejections
// from the browser also surface here. Used both to skip auto-retry and to tag
// the captured event so offline-tab reloads don't drown the queue.
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("Failed to fetch") ||
    error.message.includes("NetworkError") ||
    error.message.includes("Load failed") ||
    error.message.includes("CORS")
  );
}

// Cancellation surfaces as AbortError from the fetch signal and from TanStack's
// own query cancellation. Treat both as expected control flow, not a failure.
function isCancellationError(error: Error): boolean {
  return (
    error.name === "AbortError" ||
    error.message.toLowerCase().includes("aborted")
  );
}

// In-module cooldown so an offline tab doesn't fire one Sentry event per cache
// entry on every retry tick. Network-class only; API errors are not rate-limited.
const NETWORK_REPORT_COOLDOWN_MS = 60_000;
const networkErrorCooldowns = new Map<string, number>();

function captureCacheError(error: unknown, context: "query" | "mutation") {
  if (!(error instanceof Error)) return;
  if (isCancellationError(error)) return;

  const isNetwork = isNetworkError(error);
  const area = `${isNetwork ? "network" : "api"}.${context}`;

  if (isNetwork) {
    const dedupeKey = `${context}:${error.message}`;
    const lastSent = networkErrorCooldowns.get(dedupeKey);
    const now = Date.now();
    if (lastSent !== undefined && now - lastSent < NETWORK_REPORT_COOLDOWN_MS) {
      return;
    }
    networkErrorCooldowns.set(dedupeKey, now);
    // ponytail: hard cap with full clear; entries older than the cooldown are
    // useless to keep, and `error.message` can vary across fetchers/CORS
    // failures so the keyspace is unbounded in practice.
    if (networkErrorCooldowns.size > 50) networkErrorCooldowns.clear();
  }

  Sentry.captureException(error, { tags: { area } });
}

// A board drop settles one mutation per moved task; they share one refresh.
const TASK_QUERY_REFRESH_DELAY_MS = 100;
let taskQueryRefresh: ReturnType<typeof setTimeout> | null = null;

function scheduleTaskQueryRefresh() {
  if (taskQueryRefresh) return;
  taskQueryRefresh = setTimeout(() => {
    taskQueryRefresh = null;
    void invalidateTaskQueries(queryClient);
  }, TASK_QUERY_REFRESH_DELAY_MS);
}

// Variables of mutations whose optimistic patch changed a cached task row:
// they refresh task lists whether or not they opted in, so a failed edit
// does not stay on screen.
const patchedTaskEdits = new WeakSet<object>();

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        handleUnauthorized();
        return;
      }
      if (isTwoFactorRequired(error)) {
        handleTwoFactorRequired();
        return;
      }
      captureCacheError(error, "query");
    },
  }),
  mutationCache: new MutationCache({
    // Task edits show at once in every cached task query result (lists,
    // spreadsheets, views); the refetch after the mutation settles is the
    // source of truth.
    onMutate: (variables) => {
      const edit = taskPatchFromVariables(variables);
      if (edit && isTaskInQueryCache(queryClient, edit.taskId)) {
        patchTaskInQueryCache(queryClient, edit.taskId, edit.patch);
        patchedTaskEdits.add(variables as object);
      }
    },
    // Task lists refresh only after mutations that can change tasks: those
    // that opt in with `meta: { refreshTaskQueries: true }`, and any whose
    // optimistic patch above changed a row (it may need undoing). Comments,
    // reactions, favorites and settings leave them alone.
    onSettled: (_data, _error, variables, _result, mutation) => {
      const patched =
        typeof variables === "object" &&
        variables !== null &&
        patchedTaskEdits.has(variables);
      if (mutation.meta?.refreshTaskQueries === true || patched) {
        scheduleTaskQueryRefresh();
      }
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        handleUnauthorized();
        return;
      }
      if (isTwoFactorRequired(error)) {
        handleTwoFactorRequired();
        return;
      }
      captureCacheError(error, "mutation");
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Cached data is reused on mount, unless a mutation or a realtime hint
      // invalidated it while it was off screen: then it refetches, or a
      // change made elsewhere (a renamed member, project or label) would
      // stay stale until a reload.
      refetchOnMount: (query) => query.state.isInvalidated,
      retry: (failureCount, error) =>
        isNetworkError(error) ||
        isUnauthorizedError(error) ||
        isTwoFactorRequired(error)
          ? false
          : failureCount < 2,
    },
    mutations: {
      retry: false,
    },
  },
});

export default queryClient;
