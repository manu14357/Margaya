import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import getTaskComments from "@/fetchers/comment/get-task-comments";
import { getProjectPublication } from "@/fetchers/publication/project-publication";
import {
  getTaskVotes,
  listProjectPublicComments,
  listPublicBoardBlocks,
} from "@/fetchers/publication/public-comment-moderation";

// In-app publishing state (B12 §4.2). The project socket's
// PUBLICATION_UPDATED, VOTES_UPDATED and COMMENT_UPDATED hints refresh these.

export const publicationKeys = {
  publication: (projectId: string) => ["publication", projectId] as const,
  publicComments: (projectId: string) =>
    ["public-comments", projectId] as const,
  blocks: (projectId: string) => ["publication-blocks", projectId] as const,
  taskVotes: (taskId: string) => ["task-votes", taskId] as const,
  /** The comment list with author flags (an existing socket-refreshed key). */
  taskComments: (taskId: string) => ["comments", taskId] as const,
};

/** The project's public board: state, link, settings and what I may do. */
export function usePublication(projectId: string | undefined) {
  return useQuery({
    queryKey: publicationKeys.publication(projectId ?? ""),
    queryFn: ({ signal }) => getProjectPublication(projectId ?? "", signal),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
}

/** Recent public comments of the project, newest first. */
export function usePublicComments(projectId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: publicationKeys.publicComments(projectId),
    queryFn: ({ pageParam, signal }) =>
      listProjectPublicComments(projectId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && Boolean(projectId),
  });
}

/** People blocked from the board (moderators only). */
export function usePublicationBlocks(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: publicationKeys.blocks(projectId),
    queryFn: ({ signal }) => listPublicBoardBlocks(projectId, signal),
    enabled: enabled && Boolean(projectId),
  });
}

/** The task's public board votes, read-only in the app. */
export function useTaskVotes(taskId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: publicationKeys.taskVotes(taskId ?? ""),
    queryFn: ({ signal }) => getTaskVotes(taskId ?? "", signal),
    enabled: enabled && Boolean(taskId),
    staleTime: 30_000,
  });
}

/**
 * Comment authors with their membership flags. Public board authors are
 * usually not workspace members, so the member list can't name them.
 */
export function useTaskCommentAuthors(
  taskId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: publicationKeys.taskComments(taskId ?? ""),
    queryFn: ({ signal }) => getTaskComments(taskId ?? "", signal),
    enabled: enabled && Boolean(taskId),
    staleTime: 30_000,
    select: (comments) =>
      new Map(comments.map((comment) => [comment.id, comment.user])),
  });
}
