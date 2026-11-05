import { useQuery } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import getTasks from "@/fetchers/task/get-tasks";
import { isUnauthorizedError } from "@/lib/http-error";
import {
  isProjectSocketLive,
  subscribeToProjectSockets,
} from "@/lib/project-realtime";

/** Without a connected project socket, polling is what keeps a board current. */
export const BOARD_POLL_MS = 30_000;
/**
 * With one, live messages do. This slow reload covers what they cannot: a
 * half-open connection that looks fine, and changes that send no message.
 */
export const BOARD_SAFETY_POLL_MS = 5 * 60_000;

export function useGetTasks(projectId: string) {
  const socketLive = useSyncExternalStore(
    subscribeToProjectSockets,
    useCallback(() => isProjectSocketLive(projectId), [projectId]),
  );

  return useQuery({
    queryKey: ["tasks", projectId],
    queryFn: ({ signal }) => getTasks(projectId, signal),
    refetchInterval: (query) => {
      if (isUnauthorizedError(query.state.error)) return false;
      return socketLive && !query.state.error
        ? BOARD_SAFETY_POLL_MS
        : BOARD_POLL_MS;
    },
    enabled: !!projectId,
  });
}
