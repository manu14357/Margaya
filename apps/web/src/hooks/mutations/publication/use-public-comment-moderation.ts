import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  blockPublicBoardParticipant,
  moderatorDeleteComment,
  setCommentVisibility,
  unblockPublicBoardParticipant,
} from "@/fetchers/publication/public-comment-moderation";
import { publicationKeys } from "@/hooks/queries/publication/use-publication";
import type { CommentVisibility } from "@/types/publication";

const meta = { refreshTaskQueries: false };

type CommentTarget = { commentId: string; taskId: string };

/**
 * Public comment actions in the app: the author's Make public / Make
 * internal, a moderator's Hide from board and Delete, and per-board blocks.
 */
export function usePublicCommentModeration(projectId: string) {
  const queryClient = useQueryClient();
  const refreshTask = (taskId?: string) => {
    void queryClient.invalidateQueries({
      queryKey: publicationKeys.publicComments(projectId),
    });
    if (!taskId) {
      // Hiding someone's comments touches tasks we don't know here.
      void queryClient.invalidateQueries({ queryKey: ["activities"] });
      void queryClient.invalidateQueries({ queryKey: ["comments"] });
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
    void queryClient.invalidateQueries({
      queryKey: publicationKeys.taskComments(taskId),
    });
    void queryClient.invalidateQueries({ queryKey: ["reactions", taskId] });
  };

  const setVisibility = useMutation({
    mutationFn: ({
      commentId,
      visibility,
    }: CommentTarget & { visibility: CommentVisibility }) =>
      setCommentVisibility(commentId, visibility),
    onSuccess: (_data, { taskId }) => refreshTask(taskId),
    meta,
  });

  const remove = useMutation({
    mutationFn: ({ commentId }: CommentTarget) =>
      moderatorDeleteComment(commentId),
    onSuccess: (_data, { taskId }) => refreshTask(taskId),
    meta,
  });

  const block = useMutation({
    mutationFn: ({
      userId,
      hideComments,
    }: {
      userId: string;
      hideComments: boolean;
    }) => blockPublicBoardParticipant(projectId, userId, hideComments),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: publicationKeys.blocks(projectId),
      });
      if (result.hiddenComments > 0) refreshTask();
    },
    meta,
  });

  const unblock = useMutation({
    mutationFn: (userId: string) =>
      unblockPublicBoardParticipant(projectId, userId),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: publicationKeys.blocks(projectId),
      }),
    meta,
  });

  return { setVisibility, remove, block, unblock };
}
