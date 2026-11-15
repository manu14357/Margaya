import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  archiveWhiteboard,
  type CreateWhiteboardInput,
  createWhiteboard,
  deleteWhiteboard,
  duplicateWhiteboard,
  lockWhiteboard,
  publishWhiteboard,
  type UpdateWhiteboardInput,
  unarchiveWhiteboard,
  unlockWhiteboard,
  unpublishWhiteboard,
  updateWhiteboard,
} from "@/fetchers/whiteboard/whiteboards";
import { whiteboardQueryKeys } from "@/hooks/queries/whiteboard/whiteboard-query-keys";
import type { Whiteboard } from "@/types/whiteboard";
import { invalidateWhiteboardQueries } from "./invalidate-whiteboard-queries";

// Whiteboard mutations. None of them change tasks, so they skip the global
// task-query refresh, and their variables name `whiteboardId` (never `id`)
// so the task cache's optimistic patch leaves them alone. The project socket
// only updates other tabs; this tab refreshes itself here.

const meta = { refreshTaskQueries: false };

type Target = { whiteboardId: string; projectId: string };

/** Creates a board (blank, or with a template's elements). */
export function useCreateWhiteboard() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: (input: CreateWhiteboardInput) => createWhiteboard(input),
    onSuccess: (board, { projectId }) => {
      queryClient.setQueryData(whiteboardQueryKeys.detail(board.id), board);
      invalidateWhiteboardQueries(queryClient, { projectId });
    },
  });
}

type UpdateVariables = Target & UpdateWhiteboardInput;

/** Renames a board or changes its icon; the header follows at once. */
export function useUpdateWhiteboard() {
  const queryClient = useQueryClient();
  return useMutation<
    Whiteboard,
    Error,
    UpdateVariables,
    { previous?: Whiteboard }
  >({
    meta,
    mutationFn: ({ whiteboardId, projectId: _projectId, ...json }) =>
      updateWhiteboard(whiteboardId, json),
    onMutate: async ({ whiteboardId, projectId: _projectId, ...json }) => {
      const key = whiteboardQueryKeys.detail(whiteboardId);
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      const previous = queryClient.getQueryData<Whiteboard>(key);
      queryClient.setQueryData<Whiteboard>(key, (board) =>
        board ? { ...board, ...json } : board,
      );
      return { previous };
    },
    onError: (_error, { whiteboardId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          whiteboardQueryKeys.detail(whiteboardId),
          context.previous,
        );
      }
    },
    onSettled: (_board, _error, { whiteboardId, projectId }) => {
      invalidateWhiteboardQueries(queryClient, {
        projectId,
        whiteboardId,
        taskBoards: true,
      });
    },
  });
}

/** Copies a board under the title the caller gives it. */
export function useDuplicateWhiteboard() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: ({ whiteboardId, title }: Target & { title: string }) =>
      duplicateWhiteboard(whiteboardId, title),
    onSuccess: (copy, { projectId }) => {
      queryClient.setQueryData(whiteboardQueryKeys.detail(copy.id), copy);
      invalidateWhiteboardQueries(queryClient, {
        projectId,
        taskBoards: true,
      });
    },
  });
}

/** Locks or unlocks a board. */
export function useSetWhiteboardLock() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: ({ whiteboardId, locked }: Target & { locked: boolean }) =>
      locked ? lockWhiteboard(whiteboardId) : unlockWhiteboard(whiteboardId),
    onSettled: (_board, _error, { whiteboardId, projectId }) => {
      invalidateWhiteboardQueries(queryClient, { projectId, whiteboardId });
    },
  });
}

/** Archives or restores a board; it moves between the list's tabs. */
export function useSetWhiteboardArchived() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: ({ whiteboardId, archived }: Target & { archived: boolean }) =>
      archived
        ? archiveWhiteboard(whiteboardId)
        : unarchiveWhiteboard(whiteboardId),
    onSettled: (_board, _error, { whiteboardId, projectId }) => {
      invalidateWhiteboardQueries(queryClient, {
        projectId,
        whiteboardId,
        taskBoards: true,
      });
    },
  });
}

/** Moves an archived board to the project's trash. */
export function useDeleteWhiteboard() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: ({ whiteboardId }: Target) => deleteWhiteboard(whiteboardId),
    onSuccess: (_deleted, { whiteboardId }) => {
      queryClient.removeQueries({
        queryKey: whiteboardQueryKeys.detail(whiteboardId),
      });
      queryClient.removeQueries({
        queryKey: whiteboardQueryKeys.content(whiteboardId),
      });
    },
    onSettled: (_deleted, _error, { projectId }) => {
      invalidateWhiteboardQueries(queryClient, {
        projectId,
        trash: true,
        taskBoards: true,
      });
    },
  });
}

/** Publishes a read-only link (a new one each time), or revokes it. */
export function useSetWhiteboardPublished() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: ({
      whiteboardId,
      published,
    }: Target & { published: boolean }) =>
      published
        ? publishWhiteboard(whiteboardId)
        : unpublishWhiteboard(whiteboardId),
    onSuccess: (publication, { whiteboardId }) => {
      queryClient.setQueryData<Whiteboard>(
        whiteboardQueryKeys.detail(whiteboardId),
        (board) =>
          board
            ? {
                ...board,
                publicToken: publication.publicToken,
                publishedAt: publication.publishedAt,
              }
            : board,
      );
    },
    onSettled: (_publication, _error, { whiteboardId, projectId }) => {
      invalidateWhiteboardQueries(queryClient, { projectId, whiteboardId });
    },
  });
}
