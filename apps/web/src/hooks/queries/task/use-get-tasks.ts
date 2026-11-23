import { useQuery } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import getTasks from "@/fetchers/task/get-tasks";
import { boardQueryKey, withLocalBoardEdits } from "@/lib/board-cache";
import { HttpError, isUnauthorizedError } from "@/lib/http-error";
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

/**
 * The project is gone or hidden from me (deleted, or restricted without me):
 * polling would ask again every 30 seconds forever. The board reloads when a
 * hint says my access changed (useUserWebSocket) or on Retry.
 */
export function isBoardOutOfReach(error: unknown): boolean {
  return (
    error instanceof HttpError && (error.status === 403 || error.status === 404)
  );
}

export function useGetTasks(
  projectId: string,
  /** false reads only what is cached: pickers load the board when opened. */
  { enabled = true }: { enabled?: boolean } = {},
) {
  const socketLive = useSyncExternalStore(
    subscribeToProjectSockets,
    useCallback(() => isProjectSocketLive(projectId), [projectId]),
  );

  return useQuery({
    queryKey: boardQueryKey(projectId),
    queryFn: async ({ signal }) => {
      const startedAt = Date.now();
      const board = await getTasks(projectId, signal);
      // A load takes many requests; edits this tab saved meanwhile may be
      // missing from it, and no realtime echo of them will come.
      return withLocalBoardEdits(projectId, board, startedAt);
    },
    refetchInterval: (query) => {
      if (
        isUnauthorizedError(query.state.error) ||
        isBoardOutOfReach(query.state.error)
      ) {
        return false;
      }
      return socketLive && !query.state.error
        ? BOARD_SAFETY_POLL_MS
        : BOARD_POLL_MS;
    },
    enabled: !!projectId && enabled,
  });
}
